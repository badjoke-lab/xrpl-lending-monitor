import type { FastLaneShadowCycleResult } from '../../collector/incremental/fast-lane-shadow-cycle'

export interface FastLaneShadowRunMetric extends FastLaneShadowCycleResult {
  runAt: string
}

interface MetricRow {
  run_at: string
  status: FastLaneShadowCycleResult['status'] | 'error'
  start_ledger_index: number | null
  end_ledger_index: number | null
  latest_observed_ledger: number
  lag_ledgers: number
  ledgers_processed: number
  lending_transactions: number
  coalesced_object_rows: number
  persistence_rows_read: number
  persistence_rows_written: number
}

export async function saveFastLaneShadowRunMetric(options: {
  db: D1Database
  runAt: string
  result: FastLaneShadowCycleResult
}): Promise<void> {
  await options.db
    .prepare(
      `INSERT INTO fast_lane_shadow_run_metrics (
         network, run_at, status, start_ledger_index, end_ledger_index,
         latest_observed_ledger, lag_ledgers, ledgers_processed,
         lending_transactions, coalesced_object_rows,
         persistence_rows_read, persistence_rows_written
       ) VALUES (
         'devnet', ?1, ?2, ?3, ?4,
         ?5, ?6, ?7,
         ?8, ?9,
         ?10, ?11
       )
       ON CONFLICT(network, run_at) DO NOTHING`,
    )
    .bind(
      options.runAt,
      options.result.status,
      options.result.startLedgerIndex,
      options.result.endLedgerIndex,
      options.result.latestObservedLedger,
      options.result.lagLedgers,
      options.result.ledgersProcessed,
      options.result.lendingTransactions,
      options.result.coalescedObjectRows,
      options.result.persistenceRowsRead,
      options.result.persistenceRowsWritten,
    )
    .run()
}

export async function readRecentFastLaneShadowRunMetrics(options: {
  db: D1Database
  limit?: number
}): Promise<FastLaneShadowRunMetric[]> {
  const limit = options.limit ?? 24
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 288) {
    throw new Error('fast-lane metrics limit must be from 1 to 288')
  }

  const response = await options.db
    .prepare(
      `SELECT run_at, status, start_ledger_index, end_ledger_index,
              latest_observed_ledger, lag_ledgers, ledgers_processed,
              lending_transactions, coalesced_object_rows,
              persistence_rows_read, persistence_rows_written
       FROM fast_lane_shadow_run_metrics
       WHERE network = 'devnet'
       ORDER BY run_at DESC
       LIMIT ?1`,
    )
    .bind(limit)
    .all<MetricRow>()

  return (response.results ?? []).map((row) => ({
    runAt: row.run_at,
    status: row.status === 'error' ? 'caught_up' : row.status,
    startLedgerIndex: row.start_ledger_index,
    endLedgerIndex: row.end_ledger_index,
    latestObservedLedger: row.latest_observed_ledger,
    lagLedgers: row.lag_ledgers,
    ledgersProcessed: row.ledgers_processed,
    lendingTransactions: row.lending_transactions,
    coalescedObjectRows: row.coalesced_object_rows,
    persistenceRowsRead: row.persistence_rows_read,
    persistenceRowsWritten: row.persistence_rows_written,
  }))
}
