import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import {
  MAX_BATCH_OBJECTS,
  canonicalJson,
  digestHex,
  loadSnapshot,
  serializeMarker,
} from './d1-snapshot'
import { hasNonZeroAmount, prepareSnapshotObject } from './d1-snapshot-object'

export interface SnapshotBatchInput {
  snapshotId: string
  sequence: number
  markerBefore: unknown
  markerAfter: unknown
  decodedObjectCount: number
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
  cumulativeMetrics: Record<string, unknown>
  writtenAt: string
}

export interface SnapshotBatchResult {
  status: 'stored' | 'already_stored'
  batchHash: string
  objectCount: number
  normalizedBytes: number
}

function validateInput(input: SnapshotBatchInput): void {
  if (!Number.isSafeInteger(input.sequence) || input.sequence <= 0) {
    throw new Error('Snapshot batch sequence must be a positive safe integer')
  }
  if (!Number.isSafeInteger(input.decodedObjectCount) || input.decodedObjectCount < 0) {
    throw new Error('Snapshot decoded object count must be a non-negative safe integer')
  }
  const objectCount = input.vaults.length + input.loanBrokers.length + input.loans.length
  if (objectCount > MAX_BATCH_OBJECTS) {
    throw new Error(`Snapshot batch has ${objectCount} objects; maximum is ${MAX_BATCH_OBJECTS}`)
  }
}

export async function writeSnapshotBatch(
  db: D1Database,
  input: SnapshotBatchInput,
): Promise<SnapshotBatchResult> {
  validateInput(input)
  const snapshot = await loadSnapshot(db, input.snapshotId)
  if (!snapshot || snapshot.status !== 'building') {
    throw new Error('Snapshot batch requires a building D1 snapshot')
  }

  const objects = await Promise.all([
    ...input.vaults.map(prepareSnapshotObject),
    ...input.loanBrokers.map(prepareSnapshotObject),
    ...input.loans.map(prepareSnapshotObject),
  ])
  objects.sort((left, right) => `${left.kind}:${left.objectId}`.localeCompare(`${right.kind}:${right.objectId}`))

  const markerBefore = serializeMarker(input.markerBefore)
  const markerAfter = serializeMarker(input.markerAfter)
  const normalizedBytes = objects.reduce((total, object) => total + object.normalizedBytes, 0)
  const counts = {
    vaults: input.vaults.length,
    loanBrokers: input.loanBrokers.length,
    loans: input.loans.length,
  }
  const batchHash = await digestHex(canonicalJson({
    snapshotId: input.snapshotId,
    sequence: input.sequence,
    markerBefore,
    markerAfter,
    decodedObjectCount: input.decodedObjectCount,
    counts,
    objects: objects.map((object) => ({
      kind: object.kind,
      id: object.objectId,
      hash: object.objectHash,
      bytes: object.normalizedBytes,
    })),
  }))

  const existing = await db
    .prepare(
      `SELECT batch_hash FROM current_state_d1_batches
       WHERE snapshot_id = ?1 AND batch_sequence = ?2`,
    )
    .bind(input.snapshotId, input.sequence)
    .first<{ batch_hash: string }>()
  if (existing) {
    if (existing.batch_hash !== batchHash) {
      throw new Error('Replayed snapshot batch does not match the stored batch hash')
    }
    return { status: 'already_stored', batchHash, objectCount: objects.length, normalizedBytes }
  }

  const objectIds = objects.map((object) => object.objectId).sort()
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO current_state_d1_batches (
         snapshot_id, batch_sequence, marker_before_json, marker_after_json,
         first_object_id, last_object_id, decoded_object_count, object_count,
         vault_count, loan_broker_count, loan_count, normalized_bytes,
         batch_hash, created_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
    ).bind(
      input.snapshotId,
      input.sequence,
      markerBefore,
      markerAfter,
      objectIds[0] ?? null,
      objectIds.at(-1) ?? null,
      input.decodedObjectCount,
      objects.length,
      counts.vaults,
      counts.loanBrokers,
      counts.loans,
      normalizedBytes,
      batchHash,
      input.writtenAt,
    ),
  ]

  for (const object of objects) {
    if (object.kind === 'vault') {
      const projection = object.projection as VaultCurrentProjection
      statements.push(db.prepare(
        `INSERT INTO current_state_d1_vaults (
           snapshot_id, object_id, batch_sequence, object_hash, owner, account,
           asset_key, has_unrealized_loss, projection_json, raw_json,
           normalized_bytes, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
      ).bind(
        input.snapshotId,
        object.objectId,
        input.sequence,
        object.objectHash,
        projection.owner,
        projection.account,
        projection.asset.key,
        hasNonZeroAmount(projection.lossUnrealized) ? 1 : 0,
        object.projectionJson,
        object.rawJson,
        object.normalizedBytes,
        input.writtenAt,
      ))
    } else if (object.kind === 'loan_broker') {
      const projection = object.projection as LoanBrokerCurrentProjection
      statements.push(db.prepare(
        `INSERT INTO current_state_d1_loan_brokers (
           snapshot_id, object_id, batch_sequence, object_hash, vault_id,
           owner, account, projection_json, raw_json, normalized_bytes, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(
        input.snapshotId,
        object.objectId,
        input.sequence,
        object.objectHash,
        projection.vaultId.toUpperCase(),
        projection.owner,
        projection.account,
        object.projectionJson,
        object.rawJson,
        object.normalizedBytes,
        input.writtenAt,
      ))
    } else {
      const projection = object.projection as LoanCurrentProjection
      statements.push(db.prepare(
        `INSERT INTO current_state_d1_loans (
           snapshot_id, object_id, batch_sequence, object_hash, loan_broker_id,
           borrower, on_ledger_status, projection_json, raw_json,
           normalized_bytes, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`,
      ).bind(
        input.snapshotId,
        object.objectId,
        input.sequence,
        object.objectHash,
        projection.loanBrokerId.toUpperCase(),
        projection.borrower,
        projection.onLedgerStatus,
        object.projectionJson,
        object.rawJson,
        object.normalizedBytes,
        input.writtenAt,
      ))
    }
  }

  statements.push(db.prepare(
    `INSERT INTO current_state_d1_bootstrap_checkpoints (
       snapshot_id, marker_json, next_batch_sequence, scan_complete, metrics_json, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(snapshot_id) DO UPDATE SET
       marker_json = excluded.marker_json,
       next_batch_sequence = excluded.next_batch_sequence,
       scan_complete = excluded.scan_complete,
       metrics_json = excluded.metrics_json,
       updated_at = excluded.updated_at`,
  ).bind(
    input.snapshotId,
    markerAfter,
    input.sequence + 1,
    markerAfter === null ? 1 : 0,
    canonicalJson(input.cumulativeMetrics),
    input.writtenAt,
  ))

  await db.batch(statements)
  return { status: 'stored', batchHash, objectCount: objects.length, normalizedBytes }
}
