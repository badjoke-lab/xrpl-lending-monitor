import { describe, expect, it, vi } from 'vitest'

import { resolveIncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import { createBoundedLedgerReader } from './bounded-ledger-reader'

const runtimeConfig = resolveRuntimeConfig({
  APP_NETWORK: 'devnet',
  MAINNET_ENABLED: 'false',
  XRPL_DEVNET_RPC_URL: 'https://primary.example',
  XRPL_DEVNET_RPC_FALLBACK_URL: 'https://fallback.example',
})

function ledger(endpoint: string, ledgerIndex: number) {
  return {
    endpoint,
    ledgerIndex,
    ledgerHash: `HASH_${ledgerIndex}`,
    parentHash: `HASH_${ledgerIndex - 1}`,
    closeTime: 1000 + ledgerIndex,
    transactions: [],
  }
}

describe('bounded ledger reader', () => {
  it('retries the preferred endpoint and records usage', async () => {
    const baseReader = vi.fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockImplementationOnce(async ({ endpoint, ledgerIndex }) => ledger(endpoint, ledgerIndex))
    const bounded = createBoundedLedgerReader({
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig({}),
      preferredEndpoint: 'https://primary.example/',
      baseReader,
    })

    const result = await bounded.reader({
      endpoint: 'https://ignored.example',
      ledgerIndex: 11,
      timeoutMs: 1000,
    })

    expect(result.endpoint).toBe('https://primary.example/')
    expect(bounded.usage.rpcRequests).toBe(2)
    expect(bounded.usage.endpointAttempts).toBe(2)
  })

  it('ignores a WebSocket state endpoint when rolling back to HTTP', async () => {
    const baseReader = vi.fn(async ({ endpoint, ledgerIndex }) => ledger(endpoint, ledgerIndex))
    const bounded = createBoundedLedgerReader({
      runtimeConfig,
      incrementalConfig: resolveIncrementalRuntimeConfig({}),
      preferredEndpoint: 'wss://devnet.example/socket',
      baseReader,
    })

    const result = await bounded.reader({
      endpoint: 'https://ignored.example',
      ledgerIndex: 12,
      timeoutMs: 1000,
    })

    expect(result.endpoint).toBe('https://primary.example/')
    expect(baseReader).toHaveBeenCalledTimes(1)
    expect(baseReader).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'https://primary.example/',
    }))
  })

  it('fails before exceeding the request budget', async () => {
    const baseReader = vi.fn(async () => { throw new Error('unavailable') })
    const bounded = createBoundedLedgerReader({
      runtimeConfig,
      incrementalConfig: {
        ...resolveIncrementalRuntimeConfig({}),
        maxLedgerRpcRequestsPerRun: 2,
        maxRetriesPerEndpoint: 3,
      },
      preferredEndpoint: null,
      baseReader,
    })

    await expect(bounded.reader({
      endpoint: 'https://ignored.example',
      ledgerIndex: 11,
      timeoutMs: 1000,
    })).rejects.toThrow('request budget exhausted')
    expect(baseReader).toHaveBeenCalledTimes(2)
    expect(bounded.usage.rpcRequests).toBe(2)
  })
})
