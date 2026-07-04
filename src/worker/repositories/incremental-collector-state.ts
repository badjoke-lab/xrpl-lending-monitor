export type IncrementalCollectorStatus =
  | 'uninitialized'
  | 'awaiting_initialization'
  | 'healthy'
  | 'behind'
  | 'stale'
  | 'error'
  | 'reset_suspected'

export interface IncrementalCollectorState {
  network: 'devnet'
  status: IncrementalCollectorStatus
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  consecutiveFailures: number
  lagLedgers: number | null
  endpoint: string | null
  lastRunDurationMs: number | null
  lastRpcRequests: number
  lastEndpointAttempts: number
  lastLedgersProcessed: number
  lastInspectedTransactions: number
  lastLendingTransactions: number
  lastEstimatedRows: number
  lastEstimatedStatements: number
  lastOverlayMutations: number
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

interface CollectorStateRow {
  network: string
  status: string
  last_attempt_at: string | null
  last_success_at: string | null
  consecutive_failures: number
  lag_ledgers: number | null
  endpoint: string | null
  last_run_duration_ms: number | null
  last_rpc_requests: number
  last_endpoint_attempts: number
  last_ledgers_processed: number
  last_inspected_transactions: number
  last_lending_transactions: number
  last_estimated_rows: number
  last_estimated_statements: number
  last_overlay_mutations: number
  error_code: string | null
  error_message: string | null
  created_at: string
  updated_at: string
}

function mapState(row: CollectorStateRow): IncrementalCollectorState {
  if (row.network !== 'devnet') throw new Error('Incremental collector network is invalid')
  return {
    network: 'devnet',
    status: row.status as IncrementalCollectorStatus,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    consecutiveFailures: row.consecutive_failures,
    lagLedgers: row.lag_ledgers,
    endpoint: row.endpoint,
    lastRunDurationMs: row.last_run_duration_ms,
    lastRpcRequests: row.last_rpc_requests,
    lastEndpointAttempts: row.last_endpoint_attempts,
    lastLedgersProcessed: row.last_ledgers_processed,
    lastInspectedTransactions: row.last_inspected_transactions,
    lastLendingTransactions: row.last_lending_transactions,
    lastEstimatedRows: row.last_estimated_rows,
    lastEstimatedStatements: row.last_estimated_statements,
    lastOverlayMutations: row.last_overlay_mutations,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function getIncrementalCollectorState(db: D1Database): Promise<IncrementalCollectorState | null> {
  const row = await db.prepare("SELECT * FROM incremental_collector_state WHERE network = 'devnet'").first<CollectorStateRow>()
  return row ? mapState(row) : null
}

export async function saveIncrementalCollectorState(
  db: D1Database,
  state: IncrementalCollectorState,
): Promise<void> {
  await db.prepare(
    `INSERT INTO incremental_collector_state (
       network, status, last_attempt_at, last_success_at, consecutive_failures,
       lag_ledgers, endpoint, last_run_duration_ms, last_rpc_requests,
       last_endpoint_attempts, last_ledgers_processed, last_inspected_transactions,
       last_lending_transactions, last_estimated_rows, last_estimated_statements,
       last_overlay_mutations, error_code, error_message, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
     ON CONFLICT(network) DO UPDATE SET
       status = excluded.status,
       last_attempt_at = excluded.last_attempt_at,
       last_success_at = excluded.last_success_at,
       consecutive_failures = excluded.consecutive_failures,
       lag_ledgers = excluded.lag_ledgers,
       endpoint = excluded.endpoint,
       last_run_duration_ms = excluded.last_run_duration_ms,
       last_rpc_requests = excluded.last_rpc_requests,
       last_endpoint_attempts = excluded.last_endpoint_attempts,
       last_ledgers_processed = excluded.last_ledgers_processed,
       last_inspected_transactions = excluded.last_inspected_transactions,
       last_lending_transactions = excluded.last_lending_transactions,
       last_estimated_rows = excluded.last_estimated_rows,
       last_estimated_statements = excluded.last_estimated_statements,
       last_overlay_mutations = excluded.last_overlay_mutations,
       error_code = excluded.error_code,
       error_message = excluded.error_message,
       updated_at = excluded.updated_at`,
  ).bind(
    state.network,
    state.status,
    state.lastAttemptAt,
    state.lastSuccessAt,
    state.consecutiveFailures,
    state.lagLedgers,
    state.endpoint,
    state.lastRunDurationMs,
    state.lastRpcRequests,
    state.lastEndpointAttempts,
    state.lastLedgersProcessed,
    state.lastInspectedTransactions,
    state.lastLendingTransactions,
    state.lastEstimatedRows,
    state.lastEstimatedStatements,
    state.lastOverlayMutations,
    state.errorCode,
    state.errorMessage,
    state.createdAt,
    state.updatedAt,
  ).run()
}
