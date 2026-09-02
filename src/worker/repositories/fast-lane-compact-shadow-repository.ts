import type { FastLaneShadowWindowPlan } from '../../collector/incremental/fast-lane-shadow-plan'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'
import {
  readFastLaneShadowState,
  type FastLaneShadowPersistenceUsage,
} from './fast-lane-shadow-repository'

// One-minute operation has at most 69.4 D1 rows/day-slot before Queue/metric
// overhead. Keep persistence itself materially below that boundary. A seven-query
// commit can contain the four state/guard statements, one mutation statement with
// at most 24 rows, and two history statements with at most 8 rows each. That caps
// persistence at roughly the mid-40s while preserving normal history partitioning.
const HISTORY_WINDOWS_PER_D1_QUERY = 8
const MUTATIONS_PER_D1_QUERY = 24
export const FAST_LANE_MAX_PERSISTENCE_D1_QUERIES = 7

export class FastLaneD1QueryBudgetError extends Error {
  readonly queries: number
  readonly limit: number

  constructor(queries: number, limit = FAST_LANE_MAX_PERSISTENCE_D1_QUERIES) {
    super(`Fast-lane persistence D1 query budget exceeded: queries=${queries}, limit=${limit}`)
    this.name = 'FastLaneD1QueryBudgetError'
    this.queries = queries
    this.limit = limit
  }
}

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
  activityPlan?: FastLaneShadowWindowPlan
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
    const { historyBundle, encodedHistoryBundle, activityPlan } = window
    if (encodedHistoryBundle.length === 0) {
      throw new Error('Fast-lane encoded history bundle is empty')
    }
    if (historyBundle.startLedgerIndex !== expectedStart) {
      throw new Error('Fast-lane history windows are not contiguous with the compact shadow plan')
    }
    if (historyBundle.endLedgerIndex < historyBundle.startLedgerIndex) {
      throw new Error('Fast-lane history bundle ledger range is invalid')
    }
    if (
      activityPlan
      && (
        activityPlan.startLedgerIndex !== historyBundle.startLedgerIndex
        || activityPlan.endLedgerIndex !== historyBundle.endLedgerIndex
        || activityPlan.endLedgerHash !== historyBundle.endLedgerHash
      )
    ) {
      throw new Error('Fast-lane activity partition does not match its history partition')
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

function objectLookupJson(historyBundle: FastLaneHistoryBundle): string {
  const objects = new Map<string, { objectType: string; objectId: string }>()
  for (const change of historyBundle.objectChanges) {
    const key = `${change.objectType}:${change.objectId}`
    objects.set(key, { objectType: change.objectType, objectId: change.objectId })
  }
  return JSON.stringify([...objects.values()])
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size))
  }
  return output
}

function appendMutationStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  plan: FastLaneShadowWindowPlan,
): void {
  const serialized = plan.mutations.map((entry) => {
    const relationships = entry.mutation.relationships ?? {}
    return {
      objectType: entry.mutation.objectType,
      objectId: entry.mutation.objectId,
      operation: entry.mutation.operation,
      projectionJson: entry.mutation.operation === 'upsert' ? entry.mutation.projectionJson : null,
      owner: relationships.owner ?? null,
      account: relationships.account ?? null,
      borrower: relationships.borrower ?? null,
      vaultId: relationships.vaultId ?? null,
      loanBrokerId: relationships.loanBrokerId ?? null,
      assetKey: relationships.assetKey ?? null,
      onLedgerStatus: relationships.onLedgerStatus ?? null,
      sourceLedgerIndex: entry.ledgerIndex,
      sourceLedgerHash: entry.ledgerHash,
      sourceTransactionHash: entry.transactionHash,
      sourceTransactionIndex: entry.transactionIndex,
      updatedAt: entry.updatedAt,
    }
  })

  for (const group of chunks(serialized, MUTATIONS_PER_D1_QUERY)) {
    statements.push(
      db.prepare(
        `INSERT INTO fast_lane_shadow_objects_compact (
           network, epoch_id, object_type, object_id, operation, projection_json,
           owner, account, borrower, vault_id, loan_broker_id, asset_key,
           on_ledger_status, source_ledger_index, source_ledger_hash,
           source_transaction_hash, source_transaction_index, updated_at
         )
         SELECT
           'devnet', ?1,
           json_extract(item.value, '$.objectType'),
           json_extract(item.value, '$.objectId'),
           json_extract(item.value, '$.operation'),
           json_extract(item.value, '$.projectionJson'),
           json_extract(item.value, '$.owner'),
           json_extract(item.value, '$.account'),
           json_extract(item.value, '$.borrower'),
           json_extract(item.value, '$.vaultId'),
           json_extract(item.value, '$.loanBrokerId'),
           json_extract(item.value, '$.assetKey'),
           json_extract(item.value, '$.onLedgerStatus'),
           CAST(json_extract(item.value, '$.sourceLedgerIndex') AS INTEGER),
           json_extract(item.value, '$.sourceLedgerHash'),
           json_extract(item.value, '$.sourceTransactionHash'),
           CAST(json_extract(item.value, '$.sourceTransactionIndex') AS INTEGER),
           json_extract(item.value, '$.updatedAt')
         FROM json_each(?2) AS item
         WHERE true
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
      ).bind(plan.epochId, JSON.stringify(group)),
    )
  }
}

function appendHistoryStatements(
  db: D1Database,
  statements: D1PreparedStatement[],
  plan: FastLaneShadowWindowPlan,
  historyWindows: readonly EncodedFastLaneHistoryWindow[],
): void {
  for (const group of chunks(historyWindows, HISTORY_WINDOWS_PER_D1_QUERY)) {
    const historyRows = group.map(({ historyBundle, encodedHistoryBundle }) => ({
      epochId: historyBundle.epochId,
      startLedgerIndex: historyBundle.startLedgerIndex,
      endLedgerIndex: historyBundle.endLedgerIndex,
      endLedgerHash: historyBundle.endLedgerHash,
      encodedHistoryBundle,
      createdAt: historyBundle.createdAt,
    }))
    statements.push(
      db.prepare(
        `INSERT INTO fast_lane_history_windows (
           network, epoch_id, start_ledger_index, end_ledger_index,
           end_ledger_hash, bundle_json, created_at
         )
         SELECT
           'devnet',
           json_extract(item.value, '$.epochId'),
           CAST(json_extract(item.value, '$.startLedgerIndex') AS INTEGER),
           CAST(json_extract(item.value, '$.endLedgerIndex') AS INTEGER),
           json_extract(item.value, '$.endLedgerHash'),
           json_extract(item.value, '$.encodedHistoryBundle'),
           json_extract(item.value, '$.createdAt')
         FROM json_each(?1) AS item
         WHERE true
         ON CONFLICT(network, epoch_id, start_ledger_index)
         DO UPDATE SET
           end_ledger_index = excluded.end_ledger_index,
           end_ledger_hash = excluded.end_ledger_hash,
           bundle_json = excluded.bundle_json,
           created_at = excluded.created_at
         WHERE excluded.end_ledger_index >= fast_lane_history_windows.end_ledger_index`,
      ).bind(JSON.stringify(historyRows)),
    )

    const activityRows = group.map(({ historyBundle, activityPlan }) => {
      const resolvedPlan = activityPlan ?? plan
      return {
        epochId: resolvedPlan.epochId,
        windowStartCloseTime: resolvedPlan.windowStartCloseTime,
        windowEndCloseTime: resolvedPlan.windowEndCloseTime,
        startLedgerIndex: resolvedPlan.startLedgerIndex,
        endLedgerIndex: resolvedPlan.endLedgerIndex,
        endLedgerHash: resolvedPlan.endLedgerHash,
        inspectedTransactions: resolvedPlan.inspectedTransactions,
        lendingTransactions: resolvedPlan.lendingTransactions,
        successfulLendingTransactions: resolvedPlan.successfulLendingTransactions,
        affectedObjectCount: resolvedPlan.mutations.length,
        activityBundleJson: JSON.stringify(resolvedPlan.activity),
        objectLookupJson: objectLookupJson(historyBundle),
        createdAt: historyBundle.createdAt,
      }
    })
    statements.push(
      db.prepare(
        `INSERT INTO fast_lane_shadow_windows (
           network, epoch_id, window_start_close_time, window_end_close_time,
           start_ledger_index, end_ledger_index, end_ledger_hash,
           inspected_transaction_count, lending_transaction_count,
           successful_lending_transaction_count, affected_object_count,
           activity_bundle_json, object_lookup_json, created_at
         )
         SELECT
           'devnet',
           json_extract(item.value, '$.epochId'),
           CAST(json_extract(item.value, '$.windowStartCloseTime') AS INTEGER),
           CAST(json_extract(item.value, '$.windowEndCloseTime') AS INTEGER),
           CAST(json_extract(item.value, '$.startLedgerIndex') AS INTEGER),
           CAST(json_extract(item.value, '$.endLedgerIndex') AS INTEGER),
           json_extract(item.value, '$.endLedgerHash'),
           CAST(json_extract(item.value, '$.inspectedTransactions') AS INTEGER),
           CAST(json_extract(item.value, '$.lendingTransactions') AS INTEGER),
           CAST(json_extract(item.value, '$.successfulLendingTransactions') AS INTEGER),
           CAST(json_extract(item.value, '$.affectedObjectCount') AS INTEGER),
           json_extract(item.value, '$.activityBundleJson'),
           json_extract(item.value, '$.objectLookupJson'),
           json_extract(item.value, '$.createdAt')
         FROM json_each(?1) AS item
         WHERE true
         ON CONFLICT(network, epoch_id, window_start_close_time) DO NOTHING`,
      ).bind(JSON.stringify(activityRows)),
    )
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
      plan.latestObservedLedger === options.expectedPreviousLedger ? 'healthy' : 'stale',
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

  appendMutationStatements(db, statements, plan)
  appendHistoryStatements(db, statements, plan, options.historyWindows)

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
      plan.endLedgerIndex === plan.latestObservedLedger ? 'healthy' : 'stale',
      options.processedAt,
      options.expectedPreviousLedger,
      options.expectedPreviousHash,
    ),
  )

  statements.push(
    db.prepare('DELETE FROM fast_lane_shadow_commit_guards WHERE commit_token = ?1').bind(token),
  )

  if (statements.length > FAST_LANE_MAX_PERSISTENCE_D1_QUERIES) {
    throw new FastLaneD1QueryBudgetError(statements.length)
  }

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
      activityPlan: options.plan,
    }],
    expectedPreviousLedger: options.expectedPreviousLedger,
    expectedPreviousHash: options.expectedPreviousHash,
    processedAt: options.processedAt,
  })
}
