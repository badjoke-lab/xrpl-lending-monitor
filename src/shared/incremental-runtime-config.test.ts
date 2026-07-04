import { describe, expect, it } from 'vitest'
import { resolveIncrementalRuntimeConfig } from './incremental-runtime-config'

describe('incremental runtime config', () => {
  it('uses bounded defaults', () => {
    const config = resolveIncrementalRuntimeConfig({})
    expect(config.maxLedgersPerRun).toBe(12)
    expect(config.maxLedgerRpcRequestsPerRun).toBe(16)
    expect(config.maxStatementsPerRun).toBe(28)
    expect(config.maxRowsPerRun).toBe(24)
    expect(config.maxOverlayMutationsPerRun).toBe(16)
    expect(config.maxRetriesPerEndpoint).toBe(1)
    expect(config.executionBudgetMs).toBe(45000)
    expect(config.deadlineMarginMs).toBe(5000)
    expect(config.retainPayloads).toBe(false)
  })

  it('accepts explicit overrides', () => {
    const config = resolveIncrementalRuntimeConfig({
      INCREMENTAL_MAX_LEDGERS_PER_RUN: '4',
      INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN: '6',
      INCREMENTAL_MAX_RETRIES_PER_ENDPOINT: '0',
      INCREMENTAL_RETAIN_PAYLOADS: 'true',
    })
    expect(config.maxLedgersPerRun).toBe(4)
    expect(config.maxLedgerRpcRequestsPerRun).toBe(6)
    expect(config.maxRetriesPerEndpoint).toBe(0)
    expect(config.retainPayloads).toBe(true)
  })

  it('rejects inconsistent request limits', () => {
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_MAX_LEDGERS_PER_RUN: '5',
      INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN: '4',
    })).toThrow('must be at least')
  })

  it('rejects invalid deadline and boolean values', () => {
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_EXECUTION_BUDGET_MS: '5000',
      INCREMENTAL_DEADLINE_MARGIN_MS: '5000',
    })).toThrow('must be less than')
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_RETAIN_PAYLOADS: 'yes',
    })).toThrow('must be true or false')
  })
})
