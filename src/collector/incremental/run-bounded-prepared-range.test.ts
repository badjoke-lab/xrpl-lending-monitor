import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'

const mocks = vi.hoisted(() => ({
  runPreparedIncrementalRange: vi.fn(),
  createXrplWebSocketLedgerSession: vi.fn(),
  scanValidatedLedgerRange: vi.fn(),
}))

vi.mock('./run-prepared-range', () => ({
  runPreparedIncrementalRange: mocks.runPreparedIncrementalRange,
}))

vi.mock('./scan-validated-ledgers', () => ({
  scanValidatedLedgerRange: mocks.scanValidatedLedgerRange,
}))

vi.mock('./xrpl-websocket-ledger-session', () => ({
  createXrplWebSocketLedgerSession: mocks.createXrplWebSocketLedgerSession,
}))

import { runBoundedPreparedIncrementalRange } from './run-bounded-prepared-range'

const runtimeConfig = resolveRuntimeConfig({
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://primary.example',
  XRPL_DEVNET_RPC_FALLBACK_URL: 'https://fallback.example',
})

function websocketConfig() {
  return resolveIncrementalRuntimeConfig({
    INCREMENTAL_LEDGER_TRANSPORT: 'websocket',
    INCREMENTAL_WEBSOCKET_ENDPOINT: 'wss://devnet.example/socket',
    INCREMENTAL_WEBSOCKET_READ_WINDOW: '4',
  })
}

function options() {
  return {
    db: {} as D1Database,
    cursor: {
      epochId: 'epoch-1',
      lastProcessedLedger: 100,
      lastProcessedHash: 'A'.repeat(64),
      latestObservedLedger: 132,
      latestObservedHash: 'B'.repeat(64),
      endpoint: 'https://primary.example/',
    },
    scope: {
      epoch_id: 'epoch-1',
      base_snapshot_id: 'snapshot-1',
      base_ledger_index: 90,
      base_ledger_hash: '0'.repeat(64),
      overlay_ledger_index: 100,
      overlay_ledger_hash: 'A'.repeat(64),
    },
    previous: null,
    attemptedAt: '2026-07-10T00:00:00.000Z',
    startedAtMs: 0,
    runtimeConfig,
    incrementalConfig: websocketConfig(),
  }
}

describe('configured bounded prepared range transport', () => {
  beforeEach(() => {
    mocks.runPreparedIncrementalRange.mockReset()
    mocks.createXrplWebSocketLedgerSession.mockReset()
    mocks.scanValidatedLedgerRange.mockReset()
  })

  it('routes the range through one configured WebSocket session and read window', async () => {
    const close = vi.fn()
    const reader = vi.fn()
    mocks.createXrplWebSocketLedgerSession.mockReturnValue({
      reader,
      usage: {
        connections: 1,
        logicalMessages: 32,
        successfulLedgers: 32,
      },
      close,
    })
    mocks.runPreparedIncrementalRange.mockResolvedValue({
      state: {
        endpoint: 'https://primary.example/',
        lastRpcRequests: 0,
        lastEndpointAttempts: 0,
      },
      rowsWritten: 10,
    })
    mocks.scanValidatedLedgerRange.mockResolvedValue({ ledgers: [] })

    const result = await runBoundedPreparedIncrementalRange(options())

    expect(mocks.createXrplWebSocketLedgerSession).toHaveBeenCalledWith({
      endpoint: 'wss://devnet.example/socket',
    })
    const preparedOptions = mocks.runPreparedIncrementalRange.mock.calls[0]?.[0]
    expect(preparedOptions).toBeDefined()
    const scan = preparedOptions.scan
    expect(typeof scan).toBe('function')

    const scanOptions = {
      endpoint: 'https://ignored.example',
      timeoutMs: 1_000,
      startLedgerIndex: 101,
      latestValidatedLedger: 132,
      maxLedgers: 32,
      expectedPreviousHash: 'A'.repeat(64),
    }
    await scan(scanOptions)
    expect(mocks.scanValidatedLedgerRange).toHaveBeenCalledWith({
      ...scanOptions,
      endpoint: 'wss://devnet.example/socket',
      reader,
      readWindowSize: 4,
    })

    expect(result.state).toMatchObject({
      endpoint: 'wss://devnet.example/socket',
      lastRpcRequests: 32,
      lastEndpointAttempts: 1,
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('closes the WebSocket session when the prepared range fails', async () => {
    const close = vi.fn()
    mocks.createXrplWebSocketLedgerSession.mockReturnValue({
      reader: vi.fn(),
      usage: {
        connections: 1,
        logicalMessages: 7,
        successfulLedgers: 6,
      },
      close,
    })
    mocks.runPreparedIncrementalRange.mockRejectedValue(new Error('scan failed'))

    await expect(runBoundedPreparedIncrementalRange(options())).rejects.toThrow('scan failed')
    expect(close).toHaveBeenCalledTimes(1)
  })
})
