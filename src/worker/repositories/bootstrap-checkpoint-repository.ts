import type {
  BootstrapCheckpoint,
  BootstrapCheckpointStore,
} from '../../collector/current-state/bootstrap-runner'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function isTypeMetrics(value: unknown): value is { objects: number } {
  return isRecord(value) && isNonNegativeInteger(value.objects)
}

function isMetrics(value: unknown): value is BootstrapCheckpoint['metrics'] {
  if (!isRecord(value) || !isRecord(value.byType)) return false
  return (
    isNonNegativeInteger(value.pages) &&
    isNonNegativeInteger(value.requests) &&
    isNonNegativeInteger(value.decodedObjects) &&
    isNonNegativeInteger(value.objects) &&
    isNonNegativeInteger(value.elapsedMs) &&
    isPositiveInteger(value.requestedObjectsPerPage) &&
    value.responseMode === 'binary' &&
    isTypeMetrics(value.byType.vault) &&
    isTypeMetrics(value.byType.loan_broker) &&
    isTypeMetrics(value.byType.loan)
  )
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isShard(value: unknown): value is BootstrapCheckpoint['shards'][number] {
  return (
    isRecord(value) &&
    typeof value.key === 'string' &&
    isPositiveInteger(value.pageNumber) &&
    isNullableString(value.firstLedgerIndex) &&
    isNullableString(value.lastLedgerIndex) &&
    isNonNegativeInteger(value.decodedObjects) &&
    isNonNegativeInteger(value.vaultCount) &&
    isNonNegativeInteger(value.loanBrokerCount) &&
    isNonNegativeInteger(value.loanCount) &&
    isNonNegativeInteger(value.compressedBytes) &&
    typeof value.sha256 === 'string' &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  )
}

function isCheckpoint(value: unknown): value is BootstrapCheckpoint {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.snapshotId === 'string' &&
    value.snapshotId.length > 0 &&
    typeof value.epochId === 'string' &&
    value.epochId.length > 0 &&
    typeof value.endpoint === 'string' &&
    value.endpoint.length > 0 &&
    isNonNegativeInteger(value.ledgerIndex) &&
    typeof value.ledgerHash === 'string' &&
    value.ledgerHash.length > 0 &&
    typeof value.objectPrefix === 'string' &&
    value.objectPrefix.length > 0 &&
    isPositiveInteger(value.nextPageNumber) &&
    typeof value.scanComplete === 'boolean' &&
    isMetrics(value.metrics) &&
    Array.isArray(value.shards) &&
    value.shards.every(isShard)
  )
}

function parseCheckpoint(json: string): BootstrapCheckpoint {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Bootstrap checkpoint JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  if (!isCheckpoint(value)) {
    throw new Error('Bootstrap checkpoint does not match schema version 1')
  }
  return value
}

export function createD1BootstrapCheckpointStore(
  db: D1Database,
  now: () => string = () => new Date().toISOString(),
): BootstrapCheckpointStore {
  return {
    async load(snapshotId) {
      const row = await db
        .prepare(
          `SELECT checkpoint_json
           FROM current_state_bootstrap_checkpoints
           WHERE snapshot_id = ?1`,
        )
        .bind(snapshotId)
        .first<{ checkpoint_json: string }>()
      if (!row) return null
      if (typeof row.checkpoint_json !== 'string') {
        throw new Error('Bootstrap checkpoint row is missing checkpoint_json')
      }
      const checkpoint = parseCheckpoint(row.checkpoint_json)
      if (checkpoint.snapshotId !== snapshotId) {
        throw new Error('Bootstrap checkpoint row does not match its snapshot key')
      }
      return checkpoint
    },

    async save(checkpoint) {
      const checkpointJson = JSON.stringify(checkpoint)
      await db
        .prepare(
          `INSERT INTO current_state_bootstrap_checkpoints (
             snapshot_id, checkpoint_json, next_page_number, scan_complete, updated_at
           ) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT(snapshot_id) DO UPDATE SET
             checkpoint_json = excluded.checkpoint_json,
             next_page_number = excluded.next_page_number,
             scan_complete = excluded.scan_complete,
             updated_at = excluded.updated_at`,
        )
        .bind(
          checkpoint.snapshotId,
          checkpointJson,
          checkpoint.nextPageNumber,
          checkpoint.scanComplete ? 1 : 0,
          now(),
        )
        .run()
    },

    async clear(snapshotId) {
      await db
        .prepare(
          `DELETE FROM current_state_bootstrap_checkpoints
           WHERE snapshot_id = ?1`,
        )
        .bind(snapshotId)
        .run()
    },
  }
}
