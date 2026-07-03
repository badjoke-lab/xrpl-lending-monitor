import { loadSnapshot, type SnapshotRow } from './d1-snapshot'

interface ActivePointerRow {
  epoch_id: string
  snapshot_id: string
  rollback_snapshot_id: string | null
}

interface SyncStateRow {
  epoch_id: string | null
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

async function loadVerifiedSnapshot(
  db: D1Database,
  snapshotId: string,
  epochId: string,
): Promise<SnapshotRow | null> {
  return db
    .prepare(
      `SELECT snapshot.id, snapshot.network, snapshot.epoch_id, snapshot.status,
              snapshot.ledger_index, snapshot.ledger_hash, snapshot.manifest_hash
       FROM current_state_d1_snapshots snapshot
       JOIN current_state_d1_snapshot_manifests manifest
         ON manifest.snapshot_id = snapshot.id
        AND manifest.manifest_hash = snapshot.manifest_hash
       WHERE snapshot.id = ?1
         AND snapshot.network = 'devnet'
         AND snapshot.epoch_id = ?2
         AND snapshot.status = 'verified'
       LIMIT 1`,
    )
    .bind(snapshotId, epochId)
    .first<SnapshotRow>()
}

async function loadSyncState(db: D1Database): Promise<SyncStateRow | null> {
  return db
    .prepare(`SELECT epoch_id FROM sync_state WHERE network = 'devnet'`)
    .first<SyncStateRow>()
}

function changed(result: D1Result<unknown> | undefined): number {
  return Number(result?.meta.changes ?? 0)
}

export async function restorePreviousSnapshot(options: {
  db: D1Database
  restoredAt: string
}): Promise<{ snapshotId: string; rollbackSnapshotId: string }> {
  const active = await loadActivePointer(options.db)
  if (!active?.rollback_snapshot_id) {
    throw new Error('No verified previous D1 snapshot is available')
  }

  const [previous, syncState] = await Promise.all([
    loadVerifiedSnapshot(options.db, active.rollback_snapshot_id, active.epoch_id),
    loadSyncState(options.db),
  ])
  if (!previous) {
    throw new Error('Previous D1 snapshot is not verified with a matching manifest in the active epoch')
  }
  if (!syncState || syncState.epoch_id !== active.epoch_id) {
    throw new Error('Devnet sync state is not aligned with the active snapshot epoch')
  }

  const results = await options.db.batch([
    options.db
      .prepare(
        `UPDATE current_state_d1_active_snapshots
         SET snapshot_id = ?1, rollback_snapshot_id = ?2,
             activated_at = ?3, updated_at = ?3
         WHERE network = 'devnet'
           AND epoch_id = ?4
           AND snapshot_id = ?2
           AND rollback_snapshot_id = ?1
           AND EXISTS (
             SELECT 1 FROM sync_state
             WHERE network = 'devnet' AND epoch_id = ?4
           )`,
      )
      .bind(previous.id, active.snapshot_id, options.restoredAt, active.epoch_id),
    options.db
      .prepare(
        `UPDATE sync_state
         SET epoch_id = ?1, last_processed_ledger = ?2,
             last_processed_hash = ?3, updated_at = ?4
         WHERE network = 'devnet'
           AND epoch_id = ?1
           AND EXISTS (
             SELECT 1
             FROM current_state_d1_active_snapshots active
             WHERE active.network = 'devnet'
               AND active.epoch_id = ?1
               AND active.snapshot_id = ?5
               AND active.rollback_snapshot_id = ?6
           )`,
      )
      .bind(
        previous.epoch_id,
        previous.ledger_index,
        previous.ledger_hash,
        options.restoredAt,
        previous.id,
        active.snapshot_id,
      ),
  ])

  if (changed(results[0]) !== 1 || changed(results[1]) !== 1) {
    throw new Error('D1 snapshot restore guards did not update exactly one active pointer and sync row')
  }

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
  if (options.reason.trim().length === 0) {
    throw new Error('Cleanup eligibility requires a reason')
  }

  const snapshot = await loadSnapshot(options.db, options.snapshotId)
  if (!snapshot || (snapshot.status !== 'failed' && snapshot.status !== 'superseded')) {
    throw new Error('Only failed or superseded D1 snapshots can become cleanup eligible')
  }

  const [protectedPointer, checkpoint] = await Promise.all([
    options.db
      .prepare(
        `SELECT snapshot_id
         FROM current_state_d1_active_snapshots
         WHERE snapshot_id = ?1 OR rollback_snapshot_id = ?1
         LIMIT 1`,
      )
      .bind(options.snapshotId)
      .first<{ snapshot_id: string }>(),
    options.db
      .prepare(
        `SELECT snapshot_id
         FROM current_state_d1_bootstrap_checkpoints
         WHERE snapshot_id = ?1
         LIMIT 1`,
      )
      .bind(options.snapshotId)
      .first<{ snapshot_id: string }>(),
  ])
  if (protectedPointer) {
    throw new Error('Active or rollback D1 snapshots cannot become cleanup eligible')
  }
  if (checkpoint) {
    throw new Error('A resumable D1 snapshot cannot become cleanup eligible')
  }

  const result = await options.db
    .prepare(
      `INSERT INTO current_state_d1_cleanup_eligibility (
         snapshot_id, eligible_at, reason, created_at
       ) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(snapshot_id) DO UPDATE SET
         eligible_at = excluded.eligible_at,
         reason = excluded.reason`,
    )
    .bind(options.snapshotId, options.eligibleAt, options.reason.trim(), options.eligibleAt)
    .run()

  if (!result.success) {
    throw new Error('Failed to record D1 snapshot cleanup eligibility')
  }
}

export async function removeEligibleSnapshot(options: {
  db: D1Database
  snapshotId: string
  removeAt: string
}): Promise<boolean> {
  await options.db
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
         )
         AND NOT EXISTS (
           SELECT 1
           FROM current_state_d1_bootstrap_checkpoints checkpoint
           WHERE checkpoint.snapshot_id = current_state_d1_snapshots.id
         )`,
    )
    .bind(options.snapshotId, options.removeAt)
    .run()

  const remaining = await options.db
    .prepare(`SELECT id FROM current_state_d1_snapshots WHERE id = ?1`)
    .bind(options.snapshotId)
    .first<{ id: string }>()

  return remaining === null
}
