import { getCurrentEpoch, getSyncState } from '../repositories/network-status-repository'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'
import {
  planCatchUpInitialization,
  type CatchUpBaseIdentity,
  type CatchUpInitializationEvidence,
  type CatchUpInitializationPlan,
} from './catch-up-initialization-plan'

interface CountRow {
  count: number
}

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

export interface CatchUpInitializationResult {
  status: 'ready' | 'initialized' | 'replayed'
  plan: CatchUpInitializationPlan
  evidence: CatchUpInitializationEvidence
}

function mapOverlay(row: OverlayStateRow): CurrentStateOverlayState {
  if (row.network !== 'devnet') throw new Error('Overlay state network is invalid')
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

export async function inspectCatchUpInitialization(options: {
  db: D1Database
  base: CatchUpBaseIdentity
}): Promise<CatchUpInitializationEvidence> {
  const [sync, currentEpoch, baseEpoch, overlayResult, historyCount] = await Promise.all([
    getSyncState(options.db),
    getCurrentEpoch(options.db),
    options.db.prepare(
      'SELECT COUNT(*) AS count FROM network_epochs WHERE id = ?1',
    ).bind(options.base.epochId).first<CountRow>(),
    options.db.prepare(
      `SELECT network, epoch_id, base_snapshot_id, base_ledger_index,
              base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       FROM current_state_overlay_state
       WHERE network = 'devnet'
       ORDER BY updated_at DESC
       LIMIT 2`,
    ).all<OverlayStateRow>(),
    options.db.prepare(
      "SELECT COUNT(*) AS count FROM processed_ledgers WHERE network = 'devnet'",
    ).first<CountRow>(),
  ])

  return {
    sync,
    currentEpochId: currentEpoch?.id ?? null,
    baseEpochExists: Number(baseEpoch?.count ?? 0) > 0,
    overlayStates: (overlayResult.results ?? []).map(mapOverlay),
    processedLedgerCount: Number(historyCount?.count ?? 0),
  }
}

function syncGuardStatement(options: {
  db: D1Database
  token: string
  expectedEpochId: string | null
  expectedLedger: number | null
  expectedHash: string | null
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
    options.expectedEpochId,
    options.expectedLedger,
    options.expectedHash,
    options.latestObservedLedger,
    options.latestObservedHash,
    options.checkedAt,
  )
}

function overlayGuardStatement(options: {
  db: D1Database
  token: string
  expectedEpochId: string | null
  expectedSnapshotId: string | null
  expectedLedger: number | null
  expectedHash: string | null
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
       ?2, (SELECT epoch_id FROM current_state_overlay_state WHERE network = 'devnet' ORDER BY updated_at DESC LIMIT 1),
       ?3, (SELECT base_snapshot_id FROM current_state_overlay_state WHERE network = 'devnet' ORDER BY updated_at DESC LIMIT 1),
       ?4, (SELECT overlay_ledger_index FROM current_state_overlay_state WHERE network = 'devnet' ORDER BY updated_at DESC LIMIT 1),
       ?5, (SELECT overlay_ledger_hash FROM current_state_overlay_state WHERE network = 'devnet' ORDER BY updated_at DESC LIMIT 1),
       ?6
     )`,
  ).bind(
    options.token,
    options.expectedEpochId,
    options.expectedSnapshotId,
    options.expectedLedger,
    options.expectedHash,
    options.checkedAt,
  )
}

function historyGuardStatement(options: {
  db: D1Database
  token: string
  expectedCount: number
  checkedAt: string
}): D1PreparedStatement {
  return options.db.prepare(
    `INSERT INTO catch_up_history_guards (
       token, network, expected_processed_ledger_count,
       observed_processed_ledger_count, checked_at
     ) VALUES (
       ?1, 'devnet', ?2,
       (SELECT COUNT(*) FROM processed_ledgers WHERE network = 'devnet'),
       ?3
     )`,
  ).bind(options.token, options.expectedCount, options.checkedAt)
}

function epochGuardStatement(options: {
  db: D1Database
  token: string
  expectedCurrentEpochId: string | null
  baseEpochId: string
  expectedBaseEpochCount: number
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
       ?3, (SELECT COUNT(*) FROM network_epochs WHERE id = ?4),
       ?5
     )`,
  ).bind(
    options.token,
    options.expectedCurrentEpochId,
    options.expectedBaseEpochCount,
    options.baseEpochId,
    options.checkedAt,
  )
}

export async function initializeCatchUpFromVerifiedBase(options: {
  db: D1Database
  base: CatchUpBaseIdentity
  initializedAt: string
  dryRun?: boolean
}): Promise<CatchUpInitializationResult> {
  const evidence = await inspectCatchUpInitialization({ db: options.db, base: options.base })
  const plan = planCatchUpInitialization({ base: options.base, evidence })

  if (plan.action === 'replay') {
    return { status: 'replayed', plan, evidence }
  }
  if (options.dryRun) {
    return { status: 'ready', plan, evidence }
  }

  const token = `${options.base.snapshotId}:${options.initializedAt}`
  const before = `${token}:before`
  const after = `${token}:after`
  const statements: D1PreparedStatement[] = [
    syncGuardStatement({
      db: options.db,
      token: before,
      expectedEpochId: plan.previousEpochId,
      expectedLedger: null,
      expectedHash: null,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      checkedAt: options.initializedAt,
    }),
    overlayGuardStatement({
      db: options.db,
      token: before,
      expectedEpochId: null,
      expectedSnapshotId: null,
      expectedLedger: null,
      expectedHash: null,
      checkedAt: options.initializedAt,
    }),
    historyGuardStatement({
      db: options.db,
      token: before,
      expectedCount: 0,
      checkedAt: options.initializedAt,
    }),
    epochGuardStatement({
      db: options.db,
      token: before,
      expectedCurrentEpochId: plan.previousEpochId,
      baseEpochId: options.base.epochId,
      expectedBaseEpochCount: 0,
      checkedAt: options.initializedAt,
    }),
    options.db.prepare(
      `UPDATE network_epochs
       SET status = 'archived', ended_at = ?1, updated_at = ?1
       WHERE id = ?2 AND network = 'devnet' AND status = 'current'`,
    ).bind(options.initializedAt, plan.previousEpochId),
    options.db.prepare(
      `INSERT INTO network_epochs (
         id, network, status, first_ledger_index, first_ledger_hash,
         last_ledger_index, last_ledger_hash, started_at, ended_at,
         reset_reason, created_at, updated_at
       ) VALUES (?1, 'devnet', 'current', ?2, ?3, ?4, ?5, ?6, NULL, NULL, ?6, ?6)`,
    ).bind(
      options.base.epochId,
      options.base.ledgerIndex,
      options.base.ledgerHash,
      plan.latestObservedLedger,
      plan.latestObservedHash,
      options.initializedAt,
    ),
    options.db.prepare(
      `UPDATE sync_state
       SET epoch_id = ?1,
           last_processed_ledger = ?2,
           last_processed_hash = ?3,
           updated_at = ?4
       WHERE network = 'devnet'
         AND epoch_id = ?5
         AND last_processed_ledger IS NULL
         AND last_processed_hash IS NULL
         AND latest_observed_ledger = ?6
         AND latest_observed_hash = ?7`,
    ).bind(
      options.base.epochId,
      options.base.ledgerIndex,
      options.base.ledgerHash,
      options.initializedAt,
      plan.previousEpochId,
      plan.latestObservedLedger,
      plan.latestObservedHash,
    ),
    options.db.prepare(
      `INSERT INTO current_state_overlay_state (
         network, epoch_id, base_snapshot_id, base_ledger_index,
         base_ledger_hash, overlay_ledger_index, overlay_ledger_hash, updated_at
       ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?3, ?4, ?5)`,
    ).bind(
      options.base.epochId,
      options.base.snapshotId,
      options.base.ledgerIndex,
      options.base.ledgerHash,
      options.initializedAt,
    ),
    syncGuardStatement({
      db: options.db,
      token: after,
      expectedEpochId: options.base.epochId,
      expectedLedger: options.base.ledgerIndex,
      expectedHash: options.base.ledgerHash,
      latestObservedLedger: plan.latestObservedLedger,
      latestObservedHash: plan.latestObservedHash,
      checkedAt: options.initializedAt,
    }),
    overlayGuardStatement({
      db: options.db,
      token: after,
      expectedEpochId: options.base.epochId,
      expectedSnapshotId: options.base.snapshotId,
      expectedLedger: options.base.ledgerIndex,
      expectedHash: options.base.ledgerHash,
      checkedAt: options.initializedAt,
    }),
    historyGuardStatement({
      db: options.db,
      token: after,
      expectedCount: 0,
      checkedAt: options.initializedAt,
    }),
    epochGuardStatement({
      db: options.db,
      token: after,
      expectedCurrentEpochId: options.base.epochId,
      baseEpochId: options.base.epochId,
      expectedBaseEpochCount: 1,
      checkedAt: options.initializedAt,
    }),
    options.db.prepare(
      'DELETE FROM catch_up_initialization_guards WHERE token IN (?1, ?2)',
    ).bind(before, after),
    options.db.prepare(
      'DELETE FROM catch_up_overlay_guards WHERE token IN (?1, ?2)',
    ).bind(before, after),
    options.db.prepare(
      'DELETE FROM catch_up_history_guards WHERE token IN (?1, ?2)',
    ).bind(before, after),
    options.db.prepare(
      'DELETE FROM catch_up_epoch_guards WHERE token IN (?1, ?2)',
    ).bind(before, after),
  ]

  await options.db.batch(statements)

  const postEvidence = await inspectCatchUpInitialization({ db: options.db, base: options.base })
  const postPlan = planCatchUpInitialization({ base: options.base, evidence: postEvidence })
  if (postPlan.action !== 'replay') {
    throw new Error('Catch-up initialization post-condition failed')
  }

  return {
    status: 'initialized',
    plan,
    evidence: postEvidence,
  }
}
