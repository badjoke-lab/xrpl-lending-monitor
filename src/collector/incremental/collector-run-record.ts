import type {
  IncrementalCollectorState,
  IncrementalCollectorStatus,
} from '../../worker/repositories/incremental-collector-state'

export function buildCollectorRunState(options: {
  previous: IncrementalCollectorState | null
  status: IncrementalCollectorStatus
  now: string
  lag: number | null
  endpoint: string | null
  durationMs: number
  rpcRequests?: number
  ledgers?: number
  inspected?: number
  lending?: number
  rows?: number
  statements?: number
  overlays?: number
  persistenceBatchResults?: number
  persistenceStatements?: number
  persistenceRowsRead?: number
  persistenceRowsWritten?: number
  success?: boolean
  error?: Error
}): IncrementalCollectorState {
  return {
    network: 'devnet',
    status: options.status,
    lastAttemptAt: options.now,
    lastSuccessAt: options.success ? options.now : options.previous?.lastSuccessAt ?? null,
    consecutiveFailures: options.status === 'error'
      ? (options.previous?.consecutiveFailures ?? 0) + 1
      : 0,
    lagLedgers: options.lag,
    endpoint: options.endpoint,
    lastRunDurationMs: Math.max(0, options.durationMs),
    lastRpcRequests: options.rpcRequests ?? 0,
    lastEndpointAttempts: options.rpcRequests ?? 0,
    lastLedgersProcessed: options.ledgers ?? 0,
    lastInspectedTransactions: options.inspected ?? 0,
    lastLendingTransactions: options.lending ?? 0,
    lastEstimatedRows: options.rows ?? 0,
    lastEstimatedStatements: options.statements ?? 0,
    lastOverlayMutations: options.overlays ?? 0,
    lastPersistenceBatchResults: options.persistenceBatchResults ?? 0,
    lastPersistenceStatements: options.persistenceStatements ?? 0,
    lastPersistenceRowsRead: options.persistenceRowsRead ?? 0,
    lastPersistenceRowsWritten: options.persistenceRowsWritten ?? 0,
    errorCode: options.error ? 'incremental_collector_failed' : null,
    errorMessage: options.error?.message.slice(0, 500) ?? null,
    createdAt: options.previous?.createdAt ?? options.now,
    updatedAt: options.now,
  }
}
