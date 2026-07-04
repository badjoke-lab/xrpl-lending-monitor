export interface IncrementalRuntimeEnvironment {
  INCREMENTAL_MAX_LEDGERS_PER_RUN?: string
  INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN?: string
  INCREMENTAL_MAX_TRANSACTIONS_PER_LEDGER?: string
  INCREMENTAL_MAX_INSPECTED_TRANSACTIONS_PER_RUN?: string
  INCREMENTAL_MAX_LENDING_TRANSACTIONS_PER_RUN?: string
  INCREMENTAL_MAX_STATEMENTS_PER_RUN?: string
  INCREMENTAL_MAX_ROWS_PER_RUN?: string
  INCREMENTAL_MAX_OVERLAY_MUTATIONS_PER_RUN?: string
  INCREMENTAL_MAX_RETRIES_PER_ENDPOINT?: string
  INCREMENTAL_EXECUTION_BUDGET_MS?: string
  INCREMENTAL_DEADLINE_MARGIN_MS?: string
  INCREMENTAL_RETAIN_PAYLOADS?: string
}

export interface IncrementalRuntimeConfig {
  maxLedgersPerRun: number
  maxLedgerRpcRequestsPerRun: number
  maxTransactionsPerLedger: number
  maxInspectedTransactionsPerRun: number
  maxLendingTransactionsPerRun: number
  maxStatementsPerRun: number
  maxRowsPerRun: number
  maxOverlayMutationsPerRun: number
  maxRetriesPerEndpoint: number
  executionBudgetMs: number
  deadlineMarginMs: number
  retainPayloads: boolean
}

function positive(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`)
  return parsed
}

function nonNegative(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`)
  return parsed
}

function boolean(value: string | undefined, fallback: boolean, name: string): boolean {
  if (value === undefined || value === '') return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function resolveIncrementalRuntimeConfig(env: IncrementalRuntimeEnvironment): IncrementalRuntimeConfig {
  const config: IncrementalRuntimeConfig = {
    maxLedgersPerRun: positive(env.INCREMENTAL_MAX_LEDGERS_PER_RUN, 12, 'INCREMENTAL_MAX_LEDGERS_PER_RUN'),
    maxLedgerRpcRequestsPerRun: positive(env.INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN, 16, 'INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN'),
    maxTransactionsPerLedger: positive(env.INCREMENTAL_MAX_TRANSACTIONS_PER_LEDGER, 5_000, 'INCREMENTAL_MAX_TRANSACTIONS_PER_LEDGER'),
    maxInspectedTransactionsPerRun: positive(env.INCREMENTAL_MAX_INSPECTED_TRANSACTIONS_PER_RUN, 12_000, 'INCREMENTAL_MAX_INSPECTED_TRANSACTIONS_PER_RUN'),
    maxLendingTransactionsPerRun: positive(env.INCREMENTAL_MAX_LENDING_TRANSACTIONS_PER_RUN, 500, 'INCREMENTAL_MAX_LENDING_TRANSACTIONS_PER_RUN'),
    maxStatementsPerRun: positive(env.INCREMENTAL_MAX_STATEMENTS_PER_RUN, 28, 'INCREMENTAL_MAX_STATEMENTS_PER_RUN'),
    maxRowsPerRun: positive(env.INCREMENTAL_MAX_ROWS_PER_RUN, 24, 'INCREMENTAL_MAX_ROWS_PER_RUN'),
    maxOverlayMutationsPerRun: positive(env.INCREMENTAL_MAX_OVERLAY_MUTATIONS_PER_RUN, 16, 'INCREMENTAL_MAX_OVERLAY_MUTATIONS_PER_RUN'),
    maxRetriesPerEndpoint: nonNegative(env.INCREMENTAL_MAX_RETRIES_PER_ENDPOINT, 1, 'INCREMENTAL_MAX_RETRIES_PER_ENDPOINT'),
    executionBudgetMs: positive(env.INCREMENTAL_EXECUTION_BUDGET_MS, 45_000, 'INCREMENTAL_EXECUTION_BUDGET_MS'),
    deadlineMarginMs: positive(env.INCREMENTAL_DEADLINE_MARGIN_MS, 5_000, 'INCREMENTAL_DEADLINE_MARGIN_MS'),
    retainPayloads: boolean(env.INCREMENTAL_RETAIN_PAYLOADS, false, 'INCREMENTAL_RETAIN_PAYLOADS'),
  }

  if (config.maxLedgerRpcRequestsPerRun < config.maxLedgersPerRun) {
    throw new Error('INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN must be at least INCREMENTAL_MAX_LEDGERS_PER_RUN')
  }
  if (config.maxStatementsPerRun < 8) {
    throw new Error('INCREMENTAL_MAX_STATEMENTS_PER_RUN must be at least 8')
  }
  if (config.deadlineMarginMs >= config.executionBudgetMs) {
    throw new Error('INCREMENTAL_DEADLINE_MARGIN_MS must be less than INCREMENTAL_EXECUTION_BUDGET_MS')
  }
  return config
}
