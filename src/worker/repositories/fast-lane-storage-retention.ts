const MAX_HISTORY_WINDOWS = 256
const MAX_SHADOW_WINDOWS = 256
const MAX_RUN_METRICS = 1_000
const MAX_HISTORY_BUNDLE_BYTES = 131_072

// The compact table is transient and should normally return to zero after every
// completed five-minute cycle. These limits retain a fail-closed escape hatch
// if promotion stops working.
const MAX_COMPACT_ROWS = 45_000
const MAX_COMPACT_PAYLOAD_BYTES = 60 * 1024 * 1024

// The canonical overlay is allowed to retain the current live lending object
// population, but must stop well before the D1 500 MB free-plan database cap.
// The 2026-07-15 production baseline was 25,342 rows / 29.8 MB of projection
// payload at a 265.9 MB physical database size. These limits preserve material
// headroom for indexes, retained windows, SQLite page reuse, and intervention.
const MAX_OVERLAY_ROWS = 50_000
const MAX_OVERLAY_PAYLOAD_BYTES = 64 * 1024 * 1024

interface StorageUsageRow {
  row_count: number
  payload_bytes: number
}

export interface FastLaneStorageCapacityOptions {
  includeOverlay?: boolean
}

async function storageUsage(
  db: D1Database,
  table: 'fast_lane_shadow_objects_compact' | 'current_state_overlay_objects',
): Promise<StorageUsageRow> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS row_count,
            COALESCE(SUM(LENGTH(projection_json)), 0) AS payload_bytes
     FROM ${table}
     WHERE network = 'devnet'`,
  ).first<StorageUsageRow>()
  return {
    row_count: row?.row_count ?? 0,
    payload_bytes: row?.payload_bytes ?? 0,
  }
}

export async function assertFastLaneStorageCapacity(
  db: D1Database,
  options: FastLaneStorageCapacityOptions = {},
): Promise<void> {
  const compact = await storageUsage(db, 'fast_lane_shadow_objects_compact')

  if (
    compact.row_count >= MAX_COMPACT_ROWS
    || compact.payload_bytes >= MAX_COMPACT_PAYLOAD_BYTES
  ) {
    throw new Error(
      `fast-lane compact capacity guard reached: rows=${compact.row_count}, payload_bytes=${compact.payload_bytes}`,
    )
  }

  if (options.includeOverlay === false) return

  const overlay = await storageUsage(db, 'current_state_overlay_objects')
  if (
    overlay.row_count >= MAX_OVERLAY_ROWS
    || overlay.payload_bytes >= MAX_OVERLAY_PAYLOAD_BYTES
  ) {
    throw new Error(
      `canonical overlay capacity guard reached: rows=${overlay.row_count}, payload_bytes=${overlay.payload_bytes}`,
    )
  }
}

export async function pruneFastLaneStorage(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(
      `DELETE FROM fast_lane_shadow_objects_compact
       WHERE network = 'devnet'
         AND EXISTS (
           SELECT 1
           FROM fast_lane_shadow_base_binding AS binding
           JOIN current_state_overlay_objects AS overlay
             ON overlay.network = 'devnet'
            AND overlay.epoch_id = binding.base_epoch_id
            AND overlay.base_snapshot_id = binding.base_snapshot_id
            AND overlay.object_type = fast_lane_shadow_objects_compact.object_type
            AND overlay.object_id = fast_lane_shadow_objects_compact.object_id
           WHERE binding.network = 'devnet'
             AND binding.shadow_epoch_id = fast_lane_shadow_objects_compact.epoch_id
             AND (
               overlay.source_ledger_index > fast_lane_shadow_objects_compact.source_ledger_index
               OR (
                 overlay.source_ledger_index = fast_lane_shadow_objects_compact.source_ledger_index
                 AND overlay.source_transaction_index >= fast_lane_shadow_objects_compact.source_transaction_index
               )
             )
         )`,
    ),
    db.prepare(
      `DELETE FROM fast_lane_history_windows
       WHERE network = 'devnet'
         AND LENGTH(bundle_json) > ?1`,
    ).bind(MAX_HISTORY_BUNDLE_BYTES),
    db.prepare(
      `DELETE FROM fast_lane_history_windows
       WHERE network = 'devnet'
         AND (epoch_id, start_ledger_index) NOT IN (
           SELECT epoch_id, start_ledger_index
           FROM fast_lane_history_windows
           WHERE network = 'devnet'
           ORDER BY end_ledger_index DESC
           LIMIT ?1
         )`,
    ).bind(MAX_HISTORY_WINDOWS),
    db.prepare(
      `DELETE FROM fast_lane_shadow_windows
       WHERE network = 'devnet'
         AND (epoch_id, window_start_close_time) NOT IN (
           SELECT epoch_id, window_start_close_time
           FROM fast_lane_shadow_windows
           WHERE network = 'devnet'
           ORDER BY end_ledger_index DESC
           LIMIT ?1
         )`,
    ).bind(MAX_SHADOW_WINDOWS),
    db.prepare(
      `DELETE FROM fast_lane_shadow_run_metrics
       WHERE network = 'devnet'
         AND run_at NOT IN (
           SELECT run_at
           FROM fast_lane_shadow_run_metrics
           WHERE network = 'devnet'
           ORDER BY run_at DESC
           LIMIT ?1
         )`,
    ).bind(MAX_RUN_METRICS),
  ])
}
