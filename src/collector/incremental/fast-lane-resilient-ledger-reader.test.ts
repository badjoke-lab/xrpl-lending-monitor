import { describe, expect, it, vi } from 'vitest'

import type { LedgerReader } from './scan-validated-ledgers'
import { createFastLaneResilientLedgerReader } from './fast-lane-resilient-ledger-reader'

function ledger(endpoint: string, ledgerIndex: number) {
  return {
    endpoint,
    ledgerIndex,
    ledgerHash: 'B'.repeat(64),
    parentHash: 'A'.repeat(64),
    closeTime: 1000,
    transactions: [],
  }
}

describe('fast-lane resilient ledger reader', () => {
  it('keeps WebSocket as the primary path', async () => {
    const primary = vi.fn<LedgerReader>().mockResolvedValue(ledger('wss://devnet.example', 101))
    const fallback = vi.fn<LedgerReader>()
    const reader = createFastLaneResilientLedgerReader({
      primary,
      fallbackEndpoints: ['https://rpc.example'],
      fallbackReader: fallback,
    })

    await expect(reader({ endpoint: 'wss://devnet.example', ledgerIndex: 101, timeoutMs: 1000 }))
      .resolves.toMatchObject({ ledgerIndex: 101, endpoint: 'wss://devnet.example' })
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back across HTTP endpoints after a WebSocket timeout', async () => {
    const primary = vi.fn<LedgerReader>().mockRejectedValue(new Error('WebSocket timeout'))
    const fallback = vi.fn<LedgerReader>()
      .mockRejectedValueOnce(new Error('first RPC unavailable'))
      .mockResolvedValueOnce(ledger('https://rpc-two.example', 202))
    const reader = createFastLaneResilientLedgerReader({
      primary,
      fallbackEndpoints: ['https://rpc-one.example', 'https://rpc-two.example'],
      fallbackReader: fallback,
    })

    await expect(reader({ endpoint: 'wss://devnet.example', ledgerIndex: 202, timeoutMs: 1000 }))
      .resolves.toMatchObject({ ledgerIndex: 202, endpoint: 'https://rpc-two.example' })
    expect(fallback).toHaveBeenNthCalledWith(1, {
      endpoint: 'https://rpc-one.example', ledgerIndex: 202, timeoutMs: 1000,
    })
    expect(fallback).toHaveBeenNthCalledWith(2, {
      endpoint: 'https://rpc-two.example', ledgerIndex: 202, timeoutMs: 1000,
    })
  })

  it('fails closed when all transports fail', async () => {
    const reader = createFastLaneResilientLedgerReader({
      primary: vi.fn<LedgerReader>().mockRejectedValue(new Error('WebSocket timeout')),
      fallbackEndpoints: ['https://rpc.example'],
      fallbackReader: vi.fn<LedgerReader>().mockRejectedValue(new Error('HTTP timeout')),
    })

    await expect(reader({ endpoint: 'wss://devnet.example', ledgerIndex: 303, timeoutMs: 1000 }))
      .rejects.toThrow('ledger 303 failed on WebSocket and all HTTP fallbacks')
  })
})
