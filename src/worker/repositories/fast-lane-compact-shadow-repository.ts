import type { FastLaneShadowWindowPlan } from '../../collector/incremental/fast-lane-shadow-plan'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'
import {
  readFastLaneShadowState,
  type FastLaneShadowPersistenceUsage,
} from './fast-lane-shadow-repository'

function finiteMetric(meta: unknown, key: 'rows_read' | 'rows_written'): number {
  if (!meta || typeof meta !== 'object') return 0
  const value = (meta as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
}

function commitToken(options: {
  epochId: string
  previousLedger: number
  previousHash: string
  finalLedger: number
  finalHash: string
}): string {
  return [
    'fast-lane-compact-shadow',
    options.epochId,
    options.previousLedger,
    options.previousHash,
    options.finalLedger,
    options.finalHash,
  ].join(':')
}

export interface EncodedFastLaneHistoryWindow {
  historyBundle: FastLaneHistoryBundle
  encodedHistoryBundle: string
}

function validateHistoryWindows(
  plan: FastLaneShadowWindowPlan,
  historyWindows: readonly EncodedFastLaneHistoryWindow[],
): void {
  if (historyWindows.length === 0) {
    throw new Error('Fast-lane compact shadow commit requires history windows')
  }
  let expectedStart = plan.startLedgerIndex
  for (const window of historyWindows) {
    const { historyBundle, encodedHistoryBundle } = window
    if (encodedHistoryBundle.length === 0) {
      throw new Error('Fast-lane encoded history bundle is empty')
    }
    if (historyBundle.startLedgerIndex !== expectedStart) {
      throw new Error('Fast-lane history windows are not contiguous with the compact shadow plan')
    }
    if (historyBundle.endLedgerIndex < historyBundle.startLedgerIndex) {
      throw new Error('Fast-lane history bundle ledger range is invalid')
    }
    expectedStart = historyBundle.endLedgerIndex + 1
  }
  const final = historyWindows.at(-1)?.historyBundle
  if (
    !final
    || historyWindows[0]?.historyBundle.startLedgerIndex !== plan.startLedgerIndex
    || final.endLedgerIndex !== plan.endLedgerIndex
    || final.endLedgerHash !== plan.endLedgerHash
  ) {
    throw new Error('Fast-lane history windows do not cover the compact shadow window')
  }
}

export async function commitFastLaneCompactShadowWindows(options: {
  db: D1Database
  plan: FastLaneShadowWindowPlan
  historyWindows: readonly EncodedFastLaneHistoryWindow[]
  expectedPreviousLedger: number
  expectedPreviousHash: string
  processedAt: string
}): Promise<FastLaneShadowPersistenceUsage> {
  const { db, plan } = options
  if (plan.startLedgerIndex !== options.expectedPreviousLedger + 1) {
    throw new Error('Fast-lane compact shadow window does not begin after the expected cursor')
  }
  if (plan.endLedgerIndex < plan.startLedgerIndex) {
    throw new Error('Fast-lane compact shadow window ledger range is invalid')
  }
  validateHistoryWindows(plan, options.historyWindows)

  const token = commitToken({
    epochId: plan.epochId,
    previousLedger: options.expectedPreviousLedger,
    previousHash: options.expectedPreviousHash,
    finalLedger: plan.endLedgerIndex,
    finalHash: plan.endLedgerHash,
  })
  const statements: D1PreparedStatement[] = []

  statements.push(
    db.prepare(
      `INSERT INTO fast_lane_shadow_state (
         network, epoch_id, last_processed_ledger, last_processed_hash,
         latest_observed_ledger, latest_observed_hash, status, updated_at
       ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(network) DO NOTHING`,
    ).bind(
      plan.epochId,
      options.expectedPreviousLedger,
      options.expectedPreviousHash,
      plan.latestObservedLedger,
      plan.latestObservedHash,
      plan.latestObservedLedger === options.expectedPreviousLedger ? 'healthy' : 'behind',
      options.processedAt,
    ),
  )

  statements.push(
    db.prepare(
      `INSERT INTO fast_lane_shadow_commit_guards (
         commit_token, network, expected_ledger, expected_hash,
         observed_ledger, observed_hash, checked_at
       ) VALUES (
         ?1, 'devnet', ?2, ?3,
         (SELECT last_processed_ledger FROM fast_lane_shadow_state WHERE network = 'devnet'),
         (SELECT last_processed_hash FROM fast_lane_shadow_state WHERE network = 'devnet'),
         ?4
       )`,
    ).bind(token, options.expectedPreviousLedger, options.expectedPreviousHash, options.processedAt),
  )

  for (const entry of plan.mutations) {
    const projection = entry.mutation.operation === 'upsert' ? entry.mutation.projectionJson : null
    const relationships = entry.mutation.relationships ?? {}
    statements.push(
      db.prepare(
        `INSERT INTO fast_lane_shadow_objects_compact (
           network, epoch_id, object_type, object_id, operation, projection_json,
           owner, account, borrower, vault_id, loan_broker_id, asset_key,
           on_ledger_status, source_ledger_index, source_ledger_hash,
           source_transaction_hash, source_transaction_index, updated_at
         ) VALUES (
           'devnet', ?1, ?2, ?3, ?4, ?5,
           ?6, ?7, ?8, ?9, ?10, ?11,
           ?12, ?13, ?14, ?15, ?16, ?17
         )
         ON CONFLICT(network, epoch_id, object_type, object_id)
         DO UPDATE SET
           operation = excluded.operation,
           projection_json = excluded.projection_json,
           owner = excluded.owner,
           account = excluded.account,
           borrower = excluded.borrower,
           vault_id = excluded.vault_id,
           loan_broker_id = excluded.loan_broker_id,
           asset_key = excluded.asset_key,
           on_ledger_status = excluded.on_ledger_status,
           source_ledger_index = excluded.source_ledger_index,
           source_ledger_hash = excluded.source_ledger_hash,
           source_transaction_hash = excluded.source_transaction_hash,
           source_transaction_index = excluded.source_transaction_index,
           updated_at = excluded.updated_at
         WHERE excluded.source_ledger_index > fast_lane_shadow_objects_compact.source_ledger_index
            OR (
              excluded.source_ledger_index = fast_lane_shadow_objects_compact.source_ledger_index
              AND excluded.source_transaction_index > fast_lane_shadow_objects_compact.source_transaction_index
            )`,
      ).bind(
        plan.epochId,
        entry.mutation.objectType,
        entry.mutation.objectId,
        entry.mutation.operation,
        projection,
        relationships.owner ?? null,
        relationships.account ?? null,
        relationships.borrower ?? null,
        relationships.vaultId ?? null,
        relationships.loanBrokerId ?? null,
        relationships.assetKey ?? null,
        relationships.onLedgerStatus ?? null,
        entry.ledgerIndex,
        entry.ledgerHash,
        entry.transactionHash,
        entry.transactionIndex,
        entry.updatedAt,
      ),
    )
  }

  for (const window of options.historyWindows) {
    const { historyBundle, encodedHistoryBundle } = window
    statements.push(
      db.prepare(
        `INSERT INTO fast_lane_history_windows (
           network, epoch_id, start_ledger_index, end_ledger_index,
           end_ledger_hash, bundle_json, created_at
         ) VALUES ('devnet', ?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(network, epoch_id, start_ledger_index)
         DO UPDATE SET
           end_ledger_index = excluded.end_ledger_index,
           end_ledger_hash = excluded.end_ledger_hash,
           bundle_json = excluded.bundle_json,
           created_at = excluded.created_at
         WHERE excluded.end_ledger_index >= fast_lane_history_windows.end_ledger_index`,
      ).bind(
        historyBundle.epochId,
        historyBundle.startLedgerIndex,
        historyBundle.endLedgerIndex,
        historyBundle.endLedgerHash,
        encodedHistoryBundle,
        historyBundle.createdAt,
      ),
    )
  }

  statements.push(
    db.prepare(
      `INSERT INTO fast_lane_shadow_windows (
         network, epoch_id, window_start_close_time, window_end_close_time,
         start_ledger_index, end_ledger_index, end_ledger_hash,
         inspected_transaction_count, lending_transaction_count,
         successful_lending_transaction_count, affected_object_count,
         activity_bundle_json, created_at
       ) VALUES (
         'devnet', ?1, ?2, ?3,
         ?4, ?5, ?6,
         ?7, ?8,
         ?9, ?10,
         ?11, ?12
       )
       ON CONFLICT(network, epoch_id, window_start_close_time) DO NOTHING`,
    ).bind(
      plan.epochId,
      plan.windowStartCloseTime,
      plan.windowEndCloseTime,
      plan.startLedgerIndex,
      plan.endLedgerIndex,
      plan.endLedgerHash,
      plan.inspectedTransactions,
      plan.lendingTransactions,
      plan.successfulLendingTransactions,
      plan.mutations.length,
      JSON.stringify(plan.activity),
      options.processedAt,
    ),
  )

  statements.push(
    db.prepare(
      `UPDATE fast_lane_shadow_state
       SET epoch_id = ?1,
           last_processed_ledger = ?2,
           last_processed_hash = ?3,
           latest_observed_ledger = ?4,
           latest_observed_hash = ?5,
           status = ?6,
           updated_at = ?7
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND last_processed_ledger = ?8
         AND last_processed_hash = ?9`,
    ).bind(
      plan.epochId,
      plan.endLedgerIndex,
      plan.endLedgerHash,
      plan.latestObservedLedger,
      plan.latestObservedHash,
      plan.endLedgerIndex === plan.latestObservedLedger ? 'healthy' : 'behind',
      options.processedAt,
      options.expectedPreviousLedger,
      options.expectedPreviousHash,
    ),
  )

  statements.push(
    db.prepare('DELETE FROM fast_lane_shadow_commit_guards WHERE commit_token = ?1').bind(token),
  )

  const results = await db.batch(statements)
  const usage = results.reduce<FastLaneShadowPersistenceUsage>(
    (total, result) => ({
      statements: total.statements,
      rowsRead: total.rowsRead + finiteMetric(result.meta, 'rows_read'),
      rowsWritten: total.rowsWritten + finiteMetric(result.meta, 'rows_written'),
    }),
    { statements: statements.length, rowsRead: 0, rowsWritten: 0 },
  )

  const committed = await readFastLaneShadowState(db)
  if (
    !committed
    || committed.epochId !== plan.epochId
    || committed.lastProcessedLedger !== plan.endLedgerIndex
    || committed.lastProcessedHash !== plan.endLedgerHash
  ) {
    throw new Error('Fast-lane compact shadow commit did not advance its isolated cursor')
  }

  return usage
}

export async function commitFastLaneCompactShadowWindow(options: {
  db: D1Database
  plan: FastLaneShadowWindowPlan
  historyBundle: FastLaneHistoryBundle
  encodedHistoryBundle: string
  expectedPreviousLedger: number
  expectedPreviousHash: string
  processedAt: string
}): Promise<FastLaneShadowPersistenceUsage> {
  return commitFastLaneCompactShadowWindows({
    db: options.db,
    plan: options.plan,
    historyWindows: [{
      historyBundle: options.historyBundle,
      encodedHistoryBundle: options.encodedHistoryBundle,
    }],
    expectedPreviousLedger: options.expectedPreviousLedger,
    expectedPreviousHash: options.expectedPreviousHash,
    processedAt: options.processedAt,
  })
}
