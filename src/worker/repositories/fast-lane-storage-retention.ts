const MAX_HISTORY_WINDOWS = 256
const MAX_SHADOW_WINDOWS = 256
const MAX_RUN_METRICS = 1_000
const MAX_HISTORY_BUNDLE_BYTES = 131_072
const MAX_COMPACT_ROWS = 30_000
const MAX_COMPACT_PAYLOAD_BYTES = 40 * 1024 * 1024

interface CompactStorageUsageRow {
  row_count: number
  payload_bytes: number
}

export async function assertFastLaneStorageCapacity(db: D1Database): Promise<void> {
  const usage = await db.prepare(
    `SELECT COUNT(*) AS row_count,
            COALESCE(SUM(LENGTH(projection_json)), 0) AS payload_bytes
     FROM fast_lane_shadow_objects_compact
     WHERE network = 'devnet'`,
  ).first<CompactStorageUsageRow>()

  const rowCount = usage?.row_count ?? 0
  const payloadBytes = usage?.payload_bytes ?? 0
  if (rowCount >= MAX_COMPACT_ROWS || payloadBytes >= MAX_COMPACT_PAYLOAD_BYTES) {
    throw new Error(
      `fast-lane compact capacity guard reached: rows=${rowCount}, payload_bytes=${payloadBytes}`,
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
