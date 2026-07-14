import { runIncrementalCollectorCycle } from '../../collector/incremental/collector-cycle'
import { refreshNetworkStatus } from '../../collector/network/refresh-network-status'
import { resolveCatchUpRuntimeConfig } from '../../shared/catch-up-runtime-config'
import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import { resolveReplacementBaseRuntimeConfig } from '../../shared/replacement-base-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { Bindings } from '../env'
import { initializeCatchUpFromVerifiedBase } from './catch-up-initialization'
import { rebaseToReplacementBase } from './replacement-base-rebase'
import { readFastLaneShadowBaseBinding } from '../repositories/fast-lane-shadow-base-binding'
import { readFastLaneShadowState } from '../repositories/fast-lane-shadow-repository'

const FAST_LANE_COMPACT_COVERAGE_START_LEDGER = 3_626_457
const CANONICAL_BRIDGE_TARGET_LEDGER = FAST_LANE_COMPACT_COVERAGE_START_LEDGER - 1

interface OverlayStateRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
}

interface PromotionCountRow {
  row_count: number
}

export interface CanonicalBridgeResult {
  passes: number
  beforeLedger: number
  afterLedger: number
  fastLedger: number
  bridgeReady: boolean
}

export interface FastLanePromotionResult {
  promotedThroughLedger: number
  canonicalLedgerAfter: number
  rowsBefore: number
  rowsAfter: number
  promotedRows: number
}

async function readOverlayState(db: D1Database): Promise<OverlayStateRow> {
  const row = await db.prepare(
    `SELECT epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash,
            overlay_ledger_index, overlay_ledger_hash
     FROM current_state_overlay_state
     WHERE network = 'devnet'
     LIMIT 1`,
  ).first<OverlayStateRow>()
  if (!row) throw new Error('canonical bridge requires current_state_overlay_state')
  return row
}

async function compactRowCount(db: D1Database): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS row_count
     FROM fast_lane_shadow_objects_compact
     WHERE network = 'devnet'`,
  ).first<PromotionCountRow>()
  return row?.row_count ?? 0
}

async function runCanonicalCycle(env: Bindings): Promise<void> {
  const runtimeConfig = resolveRuntimeConfig(env)
  await refreshNetworkStatus({ db: env.DB, config: runtimeConfig })

  const catchUpConfig = resolveCatchUpRuntimeConfig(env)
  if (catchUpConfig.initializationEnabled && catchUpConfig.base) {
    await initializeCatchUpFromVerifiedBase({
      db: env.DB,
      base: catchUpConfig.base,
      initializedAt: new Date().toISOString(),
    })
  }

  const replacementBaseConfig = resolveReplacementBaseRuntimeConfig(env)
  if (replacementBaseConfig.rebaseEnabled && replacementBaseConfig.target) {
    await rebaseToReplacementBase({
      db: env.DB,
      target: replacementBaseConfig.target,
      rebasedAt: new Date().toISOString(),
    })
  }

  await runIncrementalCollectorCycle({
    db: env.DB,
    runtimeConfig,
    incrementalConfig: resolveIncrementalRuntimeConfig(env),
  })
}

export async function runCanonicalBridgePasses(options: {
  env: Bindings
  maxPasses: number
}): Promise<CanonicalBridgeResult> {
  const fast = await readFastLaneShadowState(options.env.DB)
  if (!fast) throw new Error('canonical bridge requires fast-lane state')
  let overlay = await readOverlayState(options.env.DB)
  const beforeLedger = overlay.overlay_ledger_index
  let passes = 0

  while (passes < options.maxPasses && overlay.overlay_ledger_index < fast.lastProcessedLedger) {
    await runCanonicalCycle(options.env)
    passes += 1
    overlay = await readOverlayState(options.env.DB)
  }

  return {
    passes,
    beforeLedger,
    afterLedger: overlay.overlay_ledger_index,
    fastLedger: fast.lastProcessedLedger,
    bridgeReady: overlay.overlay_ledger_index >= CANONICAL_BRIDGE_TARGET_LEDGER,
  }
}

export async function promoteFastLaneCompactToCanonicalOverlay(
  db: D1Database,
): Promise<FastLanePromotionResult | null> {
  const [overlay, binding, fast] = await Promise.all([
    readOverlayState(db),
    readFastLaneShadowBaseBinding(db),
    readFastLaneShadowState(db),
  ])
  if (!binding || !fast) return null
  if (overlay.overlay_ledger_index < CANONICAL_BRIDGE_TARGET_LEDGER) return null
  if (
    binding.base.epochId !== overlay.epoch_id
    || binding.base.snapshotId !== overlay.base_snapshot_id
    || binding.base.ledgerIndex !== overlay.base_ledger_index
    || binding.base.ledgerHash.toUpperCase() !== overlay.base_ledger_hash.toUpperCase()
  ) {
    throw new Error('fast-lane promotion base identity mismatch')
  }

  const promotedThroughLedger = fast.lastProcessedLedger
  const promotedThroughHash = fast.lastProcessedHash
  const promotedAt = new Date().toISOString()
  const lagLedgers = Math.max(0, fast.latestObservedLedger - fast.lastProcessedLedger)
  const canonicalStatus = lagLedgers === 0 ? 'healthy' : 'behind'
  const rowsBefore = await compactRowCount(db)

  await db.batch([
    db.prepare(
      `INSERT OR REPLACE INTO current_state_overlay_objects (
         network, epoch_id, base_snapshot_id, object_type, object_id, operation,
         projection_json, owner, account, borrower, vault_id, loan_broker_id,
         asset_key, on_ledger_status, source_ledger_index, source_ledger_hash,
         source_transaction_hash, source_transaction_index, updated_at
       )
       SELECT
         'devnet', ?1, ?2, fast.object_type, fast.object_id, fast.operation,
         fast.projection_json, fast.owner, fast.account, fast.borrower,
         fast.vault_id, fast.loan_broker_id, fast.asset_key, fast.on_ledger_status,
         fast.source_ledger_index, fast.source_ledger_hash,
         fast.source_transaction_hash, fast.source_transaction_index, fast.updated_at
       FROM fast_lane_shadow_objects_compact AS fast
       WHERE fast.network = 'devnet'
         AND fast.epoch_id = ?3
         AND fast.source_ledger_index <= ?4
         AND NOT EXISTS (
           SELECT 1
           FROM current_state_overlay_objects AS existing
           WHERE existing.network = 'devnet'
             AND existing.epoch_id = ?1
             AND existing.base_snapshot_id = ?2
             AND existing.object_type = fast.object_type
             AND existing.object_id = fast.object_id
             AND (
               existing.source_ledger_index > fast.source_ledger_index
               OR (
                 existing.source_ledger_index = fast.source_ledger_index
                 AND existing.source_transaction_index >= fast.source_transaction_index
               )
             )
         )`,
    ).bind(
      overlay.epoch_id,
      overlay.base_snapshot_id,
      fast.epochId,
      promotedThroughLedger,
    ),
    db.prepare(
      `UPDATE current_state_overlay_state
       SET overlay_ledger_index = ?1,
           overlay_ledger_hash = ?2,
           updated_at = ?3
       WHERE network = 'devnet'
         AND epoch_id = ?4
         AND base_snapshot_id = ?5
         AND base_ledger_index = ?6
         AND base_ledger_hash = ?7
         AND overlay_ledger_index <= ?1`,
    ).bind(
      promotedThroughLedger,
      promotedThroughHash,
      promotedAt,
      overlay.epoch_id,
      overlay.base_snapshot_id,
      overlay.base_ledger_index,
      overlay.base_ledger_hash,
    ),
    db.prepare(
      `UPDATE sync_state
       SET last_processed_ledger = ?1,
           last_processed_hash = ?2,
           latest_observed_ledger = CASE
             WHEN latest_observed_ledger IS NULL OR latest_observed_ledger < ?3 THEN ?3
             ELSE latest_observed_ledger
           END,
           latest_observed_hash = CASE
             WHEN latest_observed_ledger IS NULL OR latest_observed_ledger < ?3 THEN ?4
             ELSE latest_observed_hash
           END,
           last_attempt_at = ?5,
           last_success_at = ?5,
           status = ?6,
           consecutive_failures = 0,
           reset_reason = NULL,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?5
       WHERE network = 'devnet'
         AND epoch_id = ?7
         AND (last_processed_ledger IS NULL OR last_processed_ledger <= ?1)`,
    ).bind(
      promotedThroughLedger,
      promotedThroughHash,
      fast.latestObservedLedger,
      fast.latestObservedHash,
      promotedAt,
      canonicalStatus,
      overlay.epoch_id,
    ),
    db.prepare(
      `UPDATE incremental_collector_state
       SET status = ?1,
           last_attempt_at = ?2,
           last_success_at = ?2,
           consecutive_failures = 0,
           lag_ledgers = ?3,
           last_run_duration_ms = 0,
           last_rpc_requests = 0,
           last_endpoint_attempts = 0,
           last_ledgers_processed = 0,
           last_inspected_transactions = 0,
           last_lending_transactions = 0,
           last_estimated_rows = 0,
           last_estimated_statements = 0,
           last_overlay_mutations = 0,
           last_persistence_batch_results = 0,
           last_persistence_statements = 0,
           last_persistence_rows_read = 0,
           last_persistence_rows_written = 0,
           error_code = NULL,
           error_message = NULL,
           updated_at = ?2
       WHERE network = 'devnet'`,
    ).bind(canonicalStatus, promotedAt, lagLedgers),
    db.prepare(
      `UPDATE network_epochs
       SET last_ledger_index = ?1,
           last_ledger_hash = ?2,
           updated_at = ?3
       WHERE id = ?4
         AND network = 'devnet'
         AND status = 'current'
         AND (last_ledger_index IS NULL OR last_ledger_index < ?1)`,
    ).bind(
      fast.latestObservedLedger,
      fast.latestObservedHash,
      promotedAt,
      overlay.epoch_id,
    ),
    db.prepare(
      `DELETE FROM fast_lane_shadow_objects_compact
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND source_ledger_index <= ?2
         AND EXISTS (
           SELECT 1
           FROM current_state_overlay_objects AS existing
           WHERE existing.network = 'devnet'
             AND existing.epoch_id = ?3
             AND existing.base_snapshot_id = ?4
             AND existing.object_type = fast_lane_shadow_objects_compact.object_type
             AND existing.object_id = fast_lane_shadow_objects_compact.object_id
             AND (
               existing.source_ledger_index > fast_lane_shadow_objects_compact.source_ledger_index
               OR (
                 existing.source_ledger_index = fast_lane_shadow_objects_compact.source_ledger_index
                 AND existing.source_transaction_index >= fast_lane_shadow_objects_compact.source_transaction_index
               )
             )
         )`,
    ).bind(
      fast.epochId,
      promotedThroughLedger,
      overlay.epoch_id,
      overlay.base_snapshot_id,
    ),
  ])

  const [rowsAfter, overlayAfter] = await Promise.all([
    compactRowCount(db),
    readOverlayState(db),
  ])
  if (overlayAfter.overlay_ledger_index < promotedThroughLedger) {
    throw new Error('fast-lane promotion did not advance the canonical overlay cursor')
  }

  return {
    promotedThroughLedger,
    canonicalLedgerAfter: overlayAfter.overlay_ledger_index,
    rowsBefore,
    rowsAfter,
    promotedRows: Math.max(0, rowsBefore - rowsAfter),
  }
}
