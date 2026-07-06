import { getCurrentEpoch, getSyncState } from '../repositories/network-status-repository'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'
import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'
import {
  planReplacementBaseRebase,
  type ReplacementBaseRebaseEvidence,
  type ReplacementBaseRebasePlan,
} from './replacement-base-rebase-plan'

interface OverlayStateRow {
  network: string
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
  updated_at: string
}

export interface ReplacementBaseRebaseResult {
  status: 'ready' | 'rebased' | 'replayed'
  plan: ReplacementBaseRebasePlan
  evidence: ReplacementBaseRebaseEvidence
}

function mapOverlay(row: OverlayStateRow): CurrentStateOverlayState {
  if (row.network !== 'devnet') throw new Error('Replacement-base overlay network is invalid')
  return {
    network: 'devnet',
    epochId: row.epoch_id,
    baseSnapshotId: row.base_snapshot_id,
    baseLedgerIndex: row.base_ledger_index,
    baseLedgerHash: row.base_ledger_hash,
    overlayLedgerIndex: row.overlay_ledger_index,
    overlayLedgerHash: row.overlay_ledger_hash,
    updatedAt: row.updated_at,
  }
}

export async function inspectReplacementBaseRebase(options: {
  db: D1Database
  target: CatchUpBaseIdentity
}): Promise<ReplacementBaseRebaseEvidence> {
  const [sync, currentEpoch, overlays] = await Promise.all([
    getSyncState(options.db),
    getCurrentEpoch(options.db),
    options.db.prepare(
      `SELECT network, epoch_id, base_snapshot_id, base_ledger_index,
              base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       FROM current_state_overlay_state
       WHERE network = 'devnet' AND epoch_id = ?1
       ORDER BY updated_at DESC, base_snapshot_id ASC`,
    ).bind(options.target.epochId).all<OverlayStateRow>(),
  ])

  return {
    sync,
    currentEpochId: currentEpoch?.id ?? null,
    overlayStates: (overlays.results ?? []).map(mapOverlay),
  }
}

function syncGuardStatement(options: {
  db: D1Database
  token: string
  epochId: string
  cursorLedgerIndex: number
  cursorLedgerHash: string
  latestObservedLedger: number
  latestObservedHash: string
  checkedAt: string
}): D1PreparedStatement {
  return options.db.prepare(
    `INSERT INTO catch_up_initialization_guards (
       token, network,
       expected_sync_epoch_id, observed_sync_epoch_id,
       expected_last_processed_ledger, observed_last_processed_ledger,
       expected_last_processed_hash, observed_last_processed_hash,
       expected_latest_observed_ledger, observed_latest_observed_ledger,
       expected_latest_observed_hash, observed_latest_observed_hash,
       checked_at
     ) VALUES (
       ?1, 'devnet',
       ?2, (SELECT epoch_id FROM sync_state WHERE network = 'devnet'),
       ?3, (SELECT last_processed_ledger FROM sync_state WHERE network = 'devnet'),
       ?4, (SELECT last_processed_hash FROM sync_state WHERE network = 'devnet'),
       ?5, (SELECT latest_observed_ledger FROM sync_state WHERE network = 'devnet'),
       ?6, (SELECT latest_observed_hash FROM sync_state WHERE network = 'devnet'),
       ?7
     )`,
  ).bind(
    options.token,
    options.epochId,
    options.cursorLedgerIndex,
    options.cursorLedgerHash,
    options.latestObservedLedger,
    options.latestObservedHash,
    options.checkedAt,
  )
}

function overlayGuardStatement(options: {
  db: D1Database
  token: string
  epochId: string
  snapshotId: string
  overlayLedgerIndex: number
  overlayLedgerHash: string
  checkedAt: string
}): D1PreparedStatement {
  return options.db.prepare(
    `INSERT INTO catch_up_overlay_guards (
       token, network,
       expected_epoch_id, observed_epoch_id,
       expected_base_snapshot_id, observed_base_snapshot_id,
       expected_overlay_ledger_index, observed_overlay_ledger_index,
       expected_overlay_ledger_hash, observed_overlay_ledger_hash,
       checked_at
     ) VALUES (
       ?1, 'devnet',
       ?2, (SELECT epoch_id FROM current_state_overlay_state
             WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3 LIMIT 1),
       ?3, (SELECT base_snapshot_id FROM current_state_overlay_state
             WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3 LIMIT 1),
       ?4, (SELECT overlay_ledger_index FROM current_state_overlay_state
             WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3 LIMIT 1),
       ?5, (SELECT overlay_ledger_hash FROM current_state_overlay_state
             WHERE network = 'devnet' AND epoch_id = ?2 AND base_snapshot_id = ?3 LIMIT 1),
       ?6
     )`,
  ).bind(
    options.token,
    options.epochId,
    options.snapshotId,
    options.overlayLedgerIndex,
    options.overlayLedgerHash,
    options.checkedAt,
  )
}

function epochGuardStatement(options: {
  db: D1Database
  token: string
  epochId: string
  checkedAt: string
}): D1PreparedStatement {
  return options.db.prepare(
    `INSERT INTO catch_up_epoch_guards (
       token, network,
       expected_current_epoch_id, observed_current_epoch_id,
       expected_base_epoch_count, observed_base_epoch_count,
       checked_at
     ) VALUES (
       ?1, 'devnet',
       ?2, (SELECT id FROM network_epochs WHERE network = 'devnet' AND status = 'current' LIMIT 1),
       1, (SELECT COUNT(*) FROM network_epochs WHERE id = ?2),
       ?3
     )`,
  ).bind(options.token, options.epochId, options.checkedAt)
}

export async function rebaseToReplacementBase(options: {
  db: D1Database
  target: CatchUpBaseIdentity
  rebasedAt: string
  dryRun?: boolean
}): Promise<ReplacementBaseRebaseResult> {
  const evidence = await inspectReplacementBaseRebase({ db: options.db, target: options.target })
  const plan = planReplacementBaseRebase({ target: options.target, evidence })

  if (plan.action === 'replay') {
    return { status: 'replayed', plan, evidence }
  }
  if (options.dryRun) {
    return { status: 'ready', plan, evidence }
  }

  const token = `${options.target.snapshotId}:${options.rebasedAt}`
  const beforeSync = `${token}:before-sync`
  const beforeOverlay = `${token}:before-overlay`
  const beforeEpoch = `${token}:before-epoch`
  const afterSync = `${token}:after-sync`
  const afterOverlay = `${token}:after-overlay`
  const afterEpoch = `${token}:after-epoch`

  const statements: D1PreparedStatement[] = [
    syncGuardStatement({
      db: options.db,
      token: beforeSync,
      epochId: options.target.epochId,
      cursorLedgerIndex: plan.previousCursorLedgerIndex,
      cursorLedgerHash: plan.previousCursorLedgerHash,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      checkedAt: options.rebasedAt,
    }),
    overlayGuardStatement({
      db: options.db,
      token: beforeOverlay,
      epochId: options.target.epochId,
      snapshotId: plan.previousSnapshotId,
      overlayLedgerIndex: plan.previousCursorLedgerIndex,
      overlayLedgerHash: plan.previousCursorLedgerHash,
      checkedAt: options.rebasedAt,
    }),
    epochGuardStatement({
      db: options.db,
      token: beforeEpoch,
      epochId: options.target.epochId,
      checkedAt: options.rebasedAt,
    }),
    options.db.prepare(
      `INSERT INTO current_state_overlay_state (
         network, epoch_id, base_snapshot_id, base_ledger_index,
         base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?3, ?4, ?5)`,
    ).bind(
      options.target.epochId,
      options.target.snapshotId,
      options.target.ledgerIndex,
      options.target.ledgerHash,
      options.rebasedAt,
    ),
    options.db.prepare(
      `UPDATE sync_state
       SET last_processed_ledger = ?1,
           last_processed_hash = ?2,
           updated_at = ?3
       WHERE network = 'devnet'
         AND epoch_id = ?4
         AND last_processed_ledger = ?5
         AND last_processed_hash = ?6
         AND latest_observed_ledger = ?7
         AND latest_observed_hash = ?8`,
    ).bind(
      options.target.ledgerIndex,
      options.target.ledgerHash,
      options.rebasedAt,
      options.target.epochId,
      plan.previousCursorLedgerIndex,
      plan.previousCursorLedgerHash,
      plan.latestObservedLedger,
      plan.latestObservedHash,
    ),
    syncGuardStatement({
      db: options.db,
      token: afterSync,
      epochId: options.target.epochId,
      cursorLedgerIndex: options.target.ledgerIndex,
      cursorLedgerHash: options.target.ledgerHash,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      checkedAt: options.rebasedAt,
    }),
    overlayGuardStatement({
      db: options.db,
      token: afterOverlay,
      epochId: options.target.epochId,
      snapshotId: options.target.snapshotId,
      overlayLedgerIndex: options.target.ledgerIndex,
      overlayLedgerHash: options.target.ledgerHash,
      checkedAt: options.rebasedAt,
    }),
    epochGuardStatement({
      db: options.db,
      token: afterEpoch,
      epochId: options.target.epochId,
      checkedAt: options.rebasedAt,
    }),
    options.db.prepare(
      `DELETE FROM catch_up_initialization_guards
       WHERE token IN (?1, ?2)`,
    ).bind(beforeSync, afterSync),
    options.db.prepare(
      `DELETE FROM catch_up_overlay_guards
       WHERE token IN (?1, ?2)`,
    ).bind(beforeOverlay, afterOverlay),
    options.db.prepare(
      `DELETE FROM catch_up_epoch_guards
       WHERE token IN (?1, ?2)`,
    ).bind(beforeEpoch, afterEpoch),
  ]

  await options.db.batch(statements)

  const postEvidence = await inspectReplacementBaseRebase({ db: options.db, target: options.target })
  const postPlan = planReplacementBaseRebase({ target: options.target, evidence: postEvidence })
  if (postPlan.action !== 'replay') throw new Error('Replacement-base rebase post-condition failed')

  return { status: 'rebased', plan, evidence: postEvidence }
}
