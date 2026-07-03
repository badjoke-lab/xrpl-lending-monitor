import { loadSnapshot } from './d1-snapshot'

interface ActivePointerRow {
  epoch_id: string
  snapshot_id: string
  rollback_snapshot_id: string | null
}

async function loadActivePointer(db: D1Database): Promise<ActivePointerRow | null> {
  return db
    .prepare(
      `SELECT epoch_id, snapshot_id, rollback_snapshot_id
       FROM current_state_d1_active_snapshots
       WHERE network = 'devnet'`,
    )
    .first<ActivePointerRow>()
}

export async function restorePreviousSnapshot(options: {
  db: D1Database
  restoredAt: string
}): Promise<{ snapshotId: string; rollbackSnapshotId: string }> {
  const active = await loadActivePointer(options.db)
  if (!active?.rollback_snapshot_id) {
    throw new Error('No verified previous D1 snapshot is available')
  }

  const previous = await loadSnapshot(options.db, active.rollback_snapshot_id)
  if (!previous || previous.status !== 'verified' || previous.epoch_id !== active.epoch_id) {
    throw new Error('Previous D1 snapshot is not verified in the active epoch')
  }

  await options.db.batch([
    options.db
      .prepare(
        `UPDATE current_state_d1_active_snapshots
         SET snapshot_id = ?1, rollback_snapshot_id = ?2,
             activated_at = ?3, updated_at = ?3
         WHERE network = 'devnet'
           AND epoch_id = ?4
           AND snapshot_id = ?2
           AND rollback_snapshot_id = ?1`,
      )
      .bind(previous.id, active.snapshot_id, options.restoredAt, active.epoch_id),
    options.db
      .prepare(
        `UPDATE sync_state
         SET epoch_id = ?1, last_processed_ledger = ?2,
             last_processed_hash = ?3, updated_at = ?4
         WHERE network = 'devnet'`,
      )
      .bind(
        previous.epoch_id,
        previous.ledger_index,
        previous.ledger_hash,
        options.restoredAt,
      ),
  ])

  return {
    snapshotId: previous.id,
    rollbackSnapshotId: active.snapshot_id,
  }
}

export async function markSnapshotCleanupEligible(options: {
  db: D1Database
  snapshotId: string
  eligibleAt: string
  reason: string
}): Promise<void> {
  const snapshot = await loadSnapshot(options.db, options.snapshotId)
  if (!snapshot || (snapshot.status !== 'failed' && snapshot.status !== 'superseded')) {
    throw new Error('Only failed or superseded D1 snapshots can become cleanup eligible')
  }

  const protectedPointer = await options.db
    .prepare(
      `SELECT snapshot_id
       FROM current_state_d1_active_snapshots
       WHERE snapshot_id = ?1 OR rollback_snapshot_id = ?1
       LIMIT 1`,
    )
    .bind(options.snapshotId)
    .first<{ snapshot_id: string }>()
  if (protectedPointer) {
    throw new Error('Active or previous D1 snapshots cannot become cleanup eligible')
  }

  await options.db
    .prepare(
      `INSERT INTO current_state_d1_cleanup_eligibility (
         snapshot_id, eligible_at, reason, created_at
       ) VALUES (?1, ?2, ?3, ?2)
       ON CONFLICT(snapshot_id) DO UPDATE SET
         eligible_at = excluded.eligible_at,
         reason = excluded.reason`,
    )
    .bind(options.snapshotId, options.eligibleAt, options.reason)
    .run()
}

export async function removeEligibleSnapshot(options: {
  db: D1Database
  snapshotId: string
  removeAt: string
}): Promise<boolean> {
  const result = await options.db
    .prepare(
      `DELETE FROM current_state_d1_snapshots
       WHERE id = ?1
         AND status IN ('failed', 'superseded')
         AND EXISTS (
           SELECT 1
           FROM current_state_d1_cleanup_eligibility eligibility
           WHERE eligibility.snapshot_id = current_state_d1_snapshots.id
             AND eligibility.eligible_at <= ?2
         )
         AND NOT EXISTS (
           SELECT 1
           FROM current_state_d1_active_snapshots active
           WHERE active.snapshot_id = current_state_d1_snapshots.id
              OR active.rollback_snapshot_id = current_state_d1_snapshots.id
         )`,
    )
    .bind(options.snapshotId, options.removeAt)
    .run()

  return Number(result.meta.changes ?? 0) > 0
}
