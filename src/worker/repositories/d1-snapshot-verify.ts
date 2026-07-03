import { canonicalJson, digestHex, loadSnapshot } from './d1-snapshot'

interface CountRow {
  count: number
  bytes: number
}

interface BatchRow {
  batch_sequence: number
  batch_hash: string
  decoded_object_count: number
  object_count: number
  vault_count: number
  loan_broker_count: number
  loan_count: number
  normalized_bytes: number
}

interface CheckpointRow {
  marker_json: string | null
  next_batch_sequence: number
  scan_complete: number
}

interface ActivePointerRow {
  epoch_id: string
  snapshot_id: string
  rollback_snapshot_id: string | null
}

export interface SnapshotManifest {
  schemaVersion: 1
  network: 'devnet'
  snapshotId: string
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  generatedAt: string
  counts: {
    objects: number
    vaults: number
    loanBrokers: number
    loans: number
  }
  batchCount: number
  normalizedBytes: number
  batches: Array<{
    sequence: number
    hash: string
    decodedObjects: number
    objects: number
    vaults: number
    loanBrokers: number
    loans: number
    normalizedBytes: number
  }>
}

async function tableCount(db: D1Database, table: string, snapshotId: string): Promise<CountRow> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(normalized_bytes), 0) AS bytes
       FROM ${table}
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshotId)
    .first<CountRow>()
  return { count: Number(row?.count ?? 0), bytes: Number(row?.bytes ?? 0) }
}

async function missingRelationshipCount(
  db: D1Database,
  sql: string,
  snapshotId: string,
): Promise<number> {
  const row = await db.prepare(sql).bind(snapshotId).first<{ count: number }>()
  return Number(row?.count ?? 0)
}

export async function verifySnapshot(options: {
  db: D1Database
  snapshotId: string
  pageCount: number
  requestCount: number
  decodedObjectCount: number
  durationMs: number
  verifiedAt: string
}): Promise<{ manifest: SnapshotManifest; manifestHash: string }> {
  const snapshot = await loadSnapshot(options.db, options.snapshotId)
  if (!snapshot || (snapshot.status !== 'building' && snapshot.status !== 'verified')) {
    throw new Error('Snapshot verification requires a building or verified snapshot')
  }

  const checkpoint = await options.db
    .prepare(
      `SELECT marker_json, next_batch_sequence, scan_complete
       FROM current_state_d1_bootstrap_checkpoints
       WHERE snapshot_id = ?1`,
    )
    .bind(options.snapshotId)
    .first<CheckpointRow>()
  if (!checkpoint || checkpoint.scan_complete !== 1 || checkpoint.marker_json !== null) {
    throw new Error('Snapshot traversal is not complete')
  }

  const [vaults, brokers, loans, batchResult] = await Promise.all([
    tableCount(options.db, 'current_state_d1_vaults', options.snapshotId),
    tableCount(options.db, 'current_state_d1_loan_brokers', options.snapshotId),
    tableCount(options.db, 'current_state_d1_loans', options.snapshotId),
    options.db
      .prepare(
        `SELECT batch_sequence, batch_hash, decoded_object_count, object_count,
                vault_count, loan_broker_count, loan_count, normalized_bytes
         FROM current_state_d1_batches
         WHERE snapshot_id = ?1
         ORDER BY batch_sequence ASC`,
      )
      .bind(options.snapshotId)
      .all<BatchRow>(),
  ])

  const batches = batchResult.results ?? []
  for (let index = 0; index < batches.length; index += 1) {
    if (Number(batches[index]?.batch_sequence) !== index + 1) {
      throw new Error(`Snapshot batch sequence is incomplete at ${index + 1}`)
    }
  }

  const objectCount = vaults.count + brokers.count + loans.count
  const normalizedBytes = vaults.bytes + brokers.bytes + loans.bytes
  const batchObjects = batches.reduce((total, batch) => total + Number(batch.object_count), 0)
  const batchBytes = batches.reduce((total, batch) => total + Number(batch.normalized_bytes), 0)
  if (batchObjects !== objectCount || batchBytes !== normalizedBytes) {
    throw new Error('Snapshot batch totals do not match stored object rows')
  }

  const missingVaults = await missingRelationshipCount(
    options.db,
    `SELECT COUNT(*) AS count
     FROM current_state_d1_loan_brokers broker
     LEFT JOIN current_state_d1_vaults vault
       ON vault.snapshot_id = broker.snapshot_id AND vault.object_id = broker.vault_id
     WHERE broker.snapshot_id = ?1 AND vault.object_id IS NULL`,
    options.snapshotId,
  )
  const missingBrokers = await missingRelationshipCount(
    options.db,
    `SELECT COUNT(*) AS count
     FROM current_state_d1_loans loan
     LEFT JOIN current_state_d1_loan_brokers broker
       ON broker.snapshot_id = loan.snapshot_id AND broker.object_id = loan.loan_broker_id
     WHERE loan.snapshot_id = ?1 AND broker.object_id IS NULL`,
    options.snapshotId,
  )
  if (missingVaults > 0 || missingBrokers > 0) {
    throw new Error('Snapshot same-snapshot relationship verification failed')
  }

  const manifest: SnapshotManifest = {
    schemaVersion: 1,
    network: 'devnet',
    snapshotId: snapshot.id,
    epochId: snapshot.epoch_id,
    ledgerIndex: snapshot.ledger_index,
    ledgerHash: snapshot.ledger_hash,
    generatedAt: options.verifiedAt,
    counts: {
      objects: objectCount,
      vaults: vaults.count,
      loanBrokers: brokers.count,
      loans: loans.count,
    },
    batchCount: batches.length,
    normalizedBytes,
    batches: batches.map((batch) => ({
      sequence: Number(batch.batch_sequence),
      hash: batch.batch_hash,
      decodedObjects: Number(batch.decoded_object_count),
      objects: Number(batch.object_count),
      vaults: Number(batch.vault_count),
      loanBrokers: Number(batch.loan_broker_count),
      loans: Number(batch.loan_count),
      normalizedBytes: Number(batch.normalized_bytes),
    })),
  }
  const manifestJson = canonicalJson(manifest)
  const manifestHash = await digestHex(manifestJson)

  if (snapshot.status === 'verified') {
    if (snapshot.manifest_hash !== manifestHash) {
      throw new Error('Verified snapshot manifest hash does not match recomputed content')
    }
    return { manifest, manifestHash }
  }

  await options.db.batch([
    options.db.prepare(
      `INSERT INTO current_state_d1_snapshot_manifests (
         snapshot_id, schema_version, manifest_json, manifest_hash, batch_count,
         object_count, vault_count, loan_broker_count, loan_count,
         normalized_bytes, verified_at, created_at
       ) VALUES (?1, 1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
    ).bind(
      snapshot.id,
      manifestJson,
      manifestHash,
      batches.length,
      objectCount,
      vaults.count,
      brokers.count,
      loans.count,
      normalizedBytes,
      options.verifiedAt,
    ),
    options.db.prepare(
      `UPDATE current_state_d1_snapshots
       SET status = 'verified', page_count = ?1, request_count = ?2,
           decoded_object_count = ?3, object_count = ?4, vault_count = ?5,
           loan_broker_count = ?6, loan_count = ?7, batch_count = ?8,
           normalized_bytes = ?9, manifest_hash = ?10, duration_ms = ?11,
           completed_at = ?12, verified_at = ?12, updated_at = ?12
       WHERE id = ?13 AND status = 'building'`,
    ).bind(
      options.pageCount,
      options.requestCount,
      options.decodedObjectCount,
      objectCount,
      vaults.count,
      brokers.count,
      loans.count,
      batches.length,
      normalizedBytes,
      manifestHash,
      options.durationMs,
      options.verifiedAt,
      snapshot.id,
    ),
  ])

  return { manifest, manifestHash }
}

export async function activateSnapshot(options: {
  db: D1Database
  snapshotId: string
  activatedAt: string
}): Promise<{ snapshotId: string; rollbackSnapshotId: string | null }> {
  const snapshot = await loadSnapshot(options.db, options.snapshotId)
  if (!snapshot || snapshot.status !== 'verified' || !snapshot.manifest_hash) {
    throw new Error('Only a verified snapshot can be activated')
  }
  const manifest = await options.db
    .prepare(
      `SELECT manifest_hash FROM current_state_d1_snapshot_manifests
       WHERE snapshot_id = ?1`,
    )
    .bind(snapshot.id)
    .first<{ manifest_hash: string }>()
  if (!manifest || manifest.manifest_hash !== snapshot.manifest_hash) {
    throw new Error('Snapshot manifest metadata is incomplete or inconsistent')
  }

  const active = await options.db
    .prepare(
      `SELECT epoch_id, snapshot_id, rollback_snapshot_id
       FROM current_state_d1_active_snapshots
       WHERE network = 'devnet'`,
    )
    .first<ActivePointerRow>()
  if (active?.snapshot_id === snapshot.id) {
    return { snapshotId: snapshot.id, rollbackSnapshotId: active.rollback_snapshot_id }
  }

  const rollbackSnapshotId = active?.epoch_id === snapshot.epoch_id ? active.snapshot_id : null
  await options.db.batch([
    options.db.prepare(
      `INSERT INTO current_state_d1_active_snapshots (
         network, epoch_id, snapshot_id, rollback_snapshot_id, activated_at, updated_at
       ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?4)
       ON CONFLICT(network) DO UPDATE SET
         epoch_id = excluded.epoch_id,
         snapshot_id = excluded.snapshot_id,
         rollback_snapshot_id = excluded.rollback_snapshot_id,
         activated_at = excluded.activated_at,
         updated_at = excluded.updated_at`,
    ).bind(snapshot.epoch_id, snapshot.id, rollbackSnapshotId, options.activatedAt),
    options.db.prepare(
      `UPDATE sync_state
       SET epoch_id = ?1, last_processed_ledger = ?2, last_processed_hash = ?3,
           updated_at = ?4
       WHERE network = 'devnet'`,
    ).bind(snapshot.epoch_id, snapshot.ledger_index, snapshot.ledger_hash, options.activatedAt),
  ])

  return { snapshotId: snapshot.id, rollbackSnapshotId }
}
