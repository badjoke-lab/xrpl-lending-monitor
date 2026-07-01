import type { CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'

export interface CurrentSnapshotIdentity {
  id: string
  network: 'devnet'
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  endpoint: string
  objectPrefix: string
  startedAt: string
}

export interface CurrentSnapshotManifestSummary {
  manifestKey: string
  shardCount: number
  compressedBytes: number
  vaultCount: number
  loanBrokerCount: number
  loanCount: number
}

export async function beginCurrentSnapshot(
  db: D1Database,
  snapshot: CurrentSnapshotIdentity,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO current_state_snapshots (
        id, network, epoch_id, status, ledger_index, ledger_hash, endpoint,
        storage_backend, object_prefix, started_at, created_at, updated_at
      ) VALUES (
        ?1, ?2, ?3, 'building', ?4, ?5, ?6,
        'r2_shards', ?7, ?8, ?8, ?8
      )`,
    )
    .bind(
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      snapshot.ledgerIndex,
      snapshot.ledgerHash,
      snapshot.endpoint,
      snapshot.objectPrefix,
      snapshot.startedAt,
    )
    .run()
}

export async function activateCurrentSnapshot(options: {
  db: D1Database
  snapshot: CurrentSnapshotIdentity
  metrics: CurrentStateScanMetrics
  manifest: CurrentSnapshotManifestSummary
  completedAt: string
}): Promise<void> {
  await options.db.batch([
    options.db
      .prepare(
        `UPDATE current_state_snapshots
         SET status = 'superseded', updated_at = ?1
         WHERE network = ?2 AND epoch_id = ?3 AND status = 'active'`,
      )
      .bind(options.completedAt, options.snapshot.network, options.snapshot.epochId),
    options.db
      .prepare(
        `UPDATE current_state_snapshots
         SET status = 'active', manifest_key = ?1, page_count = ?2,
             request_count = ?3, decoded_object_count = ?4, object_count = ?5,
             vault_count = ?6, loan_broker_count = ?7, loan_count = ?8,
             shard_count = ?9, compressed_bytes = ?10, duration_ms = ?11,
             completed_at = ?12, updated_at = ?12
         WHERE id = ?13 AND status = 'building'`,
      )
      .bind(
        options.manifest.manifestKey,
        options.metrics.pages,
        options.metrics.requests,
        options.metrics.decodedObjects,
        options.metrics.objects,
        options.manifest.vaultCount,
        options.manifest.loanBrokerCount,
        options.manifest.loanCount,
        options.manifest.shardCount,
        options.manifest.compressedBytes,
        options.metrics.elapsedMs,
        options.completedAt,
        options.snapshot.id,
      ),
    options.db
      .prepare(
        `UPDATE sync_state
         SET last_processed_ledger = ?1, last_processed_hash = ?2,
             updated_at = ?3
         WHERE network = ?4 AND epoch_id = ?5`,
      )
      .bind(
        options.snapshot.ledgerIndex,
        options.snapshot.ledgerHash,
        options.completedAt,
        options.snapshot.network,
        options.snapshot.epochId,
      ),
  ])
}

export async function failCurrentSnapshot(options: {
  db: D1Database
  snapshotId: string
  failedAt: string
  code: string
  message: string
}): Promise<void> {
  await options.db
    .prepare(
      `UPDATE current_state_snapshots
       SET status = 'failed', error_code = ?1, error_message = ?2,
           completed_at = ?3, updated_at = ?3
       WHERE id = ?4 AND status = 'building'`,
    )
    .bind(options.code, options.message, options.failedAt, options.snapshotId)
    .run()
}
