import type { StoredSyncState } from '../../domain/network/status'
import type { IncrementalCollectorState } from '../repositories/incremental-collector-state'

export function serializeCollectorStatus(options: {
  collector: IncrementalCollectorState | null
  sync: StoredSyncState | null
  staleAfterSeconds: number
  nowMs?: number
}) {
  const collector = options.collector
  const sync = options.sync
  let status = collector?.status ?? 'uninitialized'

  if (status === 'behind' && collector?.lastSuccessAt) {
    const lastSuccessMs = Date.parse(collector.lastSuccessAt)
    const nowMs = options.nowMs ?? Date.now()
    if (
      Number.isFinite(lastSuccessMs)
      && nowMs - lastSuccessMs > options.staleAfterSeconds * 1000
    ) status = 'stale'
  }

  const lagLedgers = collector?.lagLedgers ?? (
    sync?.latestObservedLedger !== null
    && sync?.latestObservedLedger !== undefined
    && sync.lastProcessedLedger !== null
      ? Math.max(0, sync.latestObservedLedger - sync.lastProcessedLedger)
      : null
  )

  return {
    network: 'devnet',
    status,
    cursor: {
      epoch_id: sync?.epochId ?? null,
      last_processed_ledger: sync?.lastProcessedLedger ?? null,
      last_processed_hash: sync?.lastProcessedHash ?? null,
      latest_observed_ledger: sync?.latestObservedLedger ?? null,
      latest_observed_hash: sync?.latestObservedHash ?? null,
      lag_ledgers: lagLedgers,
    },
    timing: {
      last_attempt_at: collector?.lastAttemptAt ?? null,
      last_success_at: collector?.lastSuccessAt ?? null,
      run_duration_ms: collector?.lastRunDurationMs ?? null,
    },
    usage: {
      rpc_requests: collector?.lastRpcRequests ?? 0,
      endpoint_attempts: collector?.lastEndpointAttempts ?? 0,
      ledgers_processed: collector?.lastLedgersProcessed ?? 0,
      inspected_transactions: collector?.lastInspectedTransactions ?? 0,
      lending_transactions: collector?.lastLendingTransactions ?? 0,
      estimated_rows: collector?.lastEstimatedRows ?? 0,
      estimated_statements: collector?.lastEstimatedStatements ?? 0,
      overlay_mutations: collector?.lastOverlayMutations ?? 0,
    },
    endpoint: collector?.endpoint ?? sync?.endpoint ?? null,
    consecutive_failures: collector?.consecutiveFailures ?? 0,
    error: collector?.errorCode && collector.errorMessage
      ? { code: collector.errorCode, message: collector.errorMessage }
      : null,
  }
}
