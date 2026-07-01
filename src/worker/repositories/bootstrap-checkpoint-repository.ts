import type {
  BootstrapCheckpoint,
  BootstrapCheckpointStore,
} from '../../collector/current-state/bootstrap-runner'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseCheckpoint(json: string): BootstrapCheckpoint {
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch (error) {
    throw new Error(
      `Bootstrap checkpoint JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Bootstrap checkpoint must use schema version 1')
  }
  if (typeof value.snapshotId !== 'string' || value.snapshotId.length === 0) {
    throw new Error('Bootstrap checkpoint snapshotId is invalid')
  }
  if (!Number.isSafeInteger(value.nextPageNumber) || Number(value.nextPageNumber) <= 0) {
    throw new Error('Bootstrap checkpoint nextPageNumber is invalid')
  }
  if (typeof value.scanComplete !== 'boolean') {
    throw new Error('Bootstrap checkpoint scanComplete is invalid')
  }
  if (!Array.isArray(value.shards) || !isRecord(value.metrics)) {
    throw new Error('Bootstrap checkpoint metrics or shards are invalid')
  }
  return value as unknown as BootstrapCheckpoint
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
