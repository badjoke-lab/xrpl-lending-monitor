import { loadD1DatabaseSizeBytes } from './d1-database-size'
import { buildD1CapacityReport, type D1CapacityReport } from './d1-capacity'

export interface D1CapacityCheckInput {
  action: 'capacity'
  snapshotId: string
  historyReserveBytes: number
  retainedSnapshots?: number
  includedSnapshots?: number
  enforce?: boolean
}

interface SnapshotRow {
  status: string
  normalized_bytes: number
}

interface ManifestRow {
  manifest_bytes: number
}

interface CountRow {
  count: number
  maximum_row_bytes: number | null
}

interface BatchRow {
  count: number
  maximum_object_count: number | null
  maximum_batch_bytes: number | null
}

async function objectTableStats(
  db: D1Database,
  table: 'current_state_d1_vaults' | 'current_state_d1_loan_brokers' | 'current_state_d1_loans',
  snapshotId: string,
): Promise<CountRow> {
  return (
    (await db
      .prepare(
        `SELECT COUNT(*) AS count,
                MAX(LENGTH(raw_json) + LENGTH(projection_json)) AS maximum_row_bytes
         FROM ${table}
         WHERE snapshot_id = ?1`,
      )
      .bind(snapshotId)
      .first<CountRow>()) ?? { count: 0, maximum_row_bytes: 0 }
  )
}

export async function executeD1CapacityCheck(options: {
  db: D1Database
  input: D1CapacityCheckInput
  now?: () => string
}): Promise<{
  schemaVersion: 1
  action: 'capacity'
  generatedAt: string
  result: D1CapacityReport & Record<string, unknown>
}> {
  if (!options.input.snapshotId.trim()) throw new Error('snapshotId is required')

  const [snapshot, manifest, vaults, brokers, loans, batches, currentDatabaseBytes] =
    await Promise.all([
      options.db
        .prepare(
          `SELECT status, normalized_bytes
           FROM current_state_d1_snapshots
           WHERE id = ?1`,
        )
        .bind(options.input.snapshotId)
        .first<SnapshotRow>(),
      options.db
        .prepare(
          `SELECT LENGTH(manifest_json) AS manifest_bytes
           FROM current_state_d1_snapshot_manifests
           WHERE snapshot_id = ?1`,
        )
        .bind(options.input.snapshotId)
        .first<ManifestRow>(),
      objectTableStats(options.db, 'current_state_d1_vaults', options.input.snapshotId),
      objectTableStats(options.db, 'current_state_d1_loan_brokers', options.input.snapshotId),
      objectTableStats(options.db, 'current_state_d1_loans', options.input.snapshotId),
      options.db
        .prepare(
          `SELECT COUNT(*) AS count,
                  MAX(object_count) AS maximum_object_count,
                  MAX(normalized_bytes) AS maximum_batch_bytes
           FROM current_state_d1_batches
           WHERE snapshot_id = ?1`,
        )
        .bind(options.input.snapshotId)
        .first<BatchRow>(),
      loadD1DatabaseSizeBytes(options.db),
    ])

  if (!snapshot) throw new Error('D1 snapshot does not exist')
  if (snapshot.status !== 'verified') {
    throw new Error('D1 capacity check requires a verified snapshot')
  }
  if (!manifest) throw new Error('Verified D1 snapshot manifest is missing')

  const objectRows = Number(vaults.count) + Number(brokers.count) + Number(loans.count)
  const maximumRowBytes = Math.max(
    Number(vaults.maximum_row_bytes ?? 0),
    Number(brokers.maximum_row_bytes ?? 0),
    Number(loans.maximum_row_bytes ?? 0),
  )
  const report = buildD1CapacityReport({
    currentDatabaseBytes,
    normalizedSnapshotBytes: Number(snapshot.normalized_bytes),
    manifestBytes: Number(manifest.manifest_bytes),
    objectRows,
    batchRows: Number(batches?.count ?? 0),
    maximumRowBytes,
    maximumObjectsPerBatch: Number(batches?.maximum_object_count ?? 0),
    historyReserveBytes: options.input.historyReserveBytes,
    retainedSnapshots: options.input.retainedSnapshots,
    includedSnapshots: options.input.includedSnapshots,
  })

  return {
    schemaVersion: 1,
    action: 'capacity',
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    result: {
      snapshotId: options.input.snapshotId,
      snapshotStatus: snapshot.status,
      objectRows,
      batchRows: Number(batches?.count ?? 0),
      normalizedSnapshotBytes: Number(snapshot.normalized_bytes),
      manifestBytes: Number(manifest.manifest_bytes),
      maximumRowBytes,
      maximumObjectsPerBatch: Number(batches?.maximum_object_count ?? 0),
      maximumBatchBytes: Number(batches?.maximum_batch_bytes ?? 0),
      ...report,
    },
  }
}
