const MAX_HISTORY_WINDOWS = 256
const MAX_SHADOW_WINDOWS = 256
const MAX_RUN_METRICS = 1_000
const MAX_HISTORY_BUNDLE_BYTES = 131_072

export async function pruneFastLaneStorage(db: D1Database): Promise<void> {
  await db.batch([
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
