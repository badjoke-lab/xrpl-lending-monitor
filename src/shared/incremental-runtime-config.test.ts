import { describe, expect, it } from 'vitest'
import { resolveIncrementalRuntimeConfig } from './incremental-runtime-config'

describe('incremental runtime config', () => {
  it('uses bounded HTTP defaults', () => {
    const config = resolveIncrementalRuntimeConfig({})
    expect(config.ledgerTransport).toBe('http')
    expect(config.webSocketEndpoint).toBeNull()
    expect(config.webSocketReadWindow).toBe(1)
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

  it('accepts explicit WebSocket transport, bounded read window, and overrides', () => {
    const config = resolveIncrementalRuntimeConfig({
      INCREMENTAL_LEDGER_TRANSPORT: 'websocket',
      INCREMENTAL_WEBSOCKET_ENDPOINT: 'wss://devnet.example/socket',
      INCREMENTAL_WEBSOCKET_READ_WINDOW: '4',
      INCREMENTAL_MAX_LEDGERS_PER_RUN: '8',
      INCREMENTAL_MAX_LEDGER_RPC_REQUESTS_PER_RUN: '10',
      INCREMENTAL_MAX_RETRIES_PER_ENDPOINT: '0',
      INCREMENTAL_RETAIN_PAYLOADS: 'true',
    })
    expect(config.ledgerTransport).toBe('websocket')
    expect(config.webSocketEndpoint).toBe('wss://devnet.example/socket')
    expect(config.webSocketReadWindow).toBe(4)
    expect(config.maxLedgersPerRun).toBe(8)
    expect(config.maxLedgerRpcRequestsPerRun).toBe(10)
    expect(config.maxRetriesPerEndpoint).toBe(0)
    expect(config.retainPayloads).toBe(true)
  })

  it('rejects WebSocket transport without a WSS endpoint', () => {
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_LEDGER_TRANSPORT: 'websocket',
    })).toThrow('INCREMENTAL_WEBSOCKET_ENDPOINT is required')

    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_LEDGER_TRANSPORT: 'websocket',
      INCREMENTAL_WEBSOCKET_ENDPOINT: 'https://devnet.example',
    })).toThrow('must use WSS')
  })

  it('rejects an unknown transport', () => {
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_LEDGER_TRANSPORT: 'socket',
    })).toThrow('must be http or websocket')
  })

  it('rejects a read window larger than the ledger batch', () => {
    expect(() => resolveIncrementalRuntimeConfig({
      INCREMENTAL_WEBSOCKET_READ_WINDOW: '5',
      INCREMENTAL_MAX_LEDGERS_PER_RUN: '4',
    })).toThrow('must not exceed')
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
