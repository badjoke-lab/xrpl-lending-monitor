import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from './scan-validated-ledgers'
import {
  FAST_LANE_PERSISTENCE_MAX_LEDGERS,
  selectFastLaneHeadRpcEndpoint,
  selectFastLanePersistenceSafeScan,
  selectFastLaneStartLedger,
} from './fast-lane-shadow-cycle'

function emptyLedgerScan(ledgerCount: number): IncrementalScanResult {
  const startLedgerIndex = 100
  const ledgers = Array.from({ length: ledgerCount }, (_, offset) => ({
    endpoint: 'wss://s.devnet.rippletest.net:51233/',
    ledgerIndex: startLedgerIndex + offset,
    ledgerHash: String(startLedgerIndex + offset).padStart(64, '0'),
    parentHash: String(startLedgerIndex + offset - 1).padStart(64, '0'),
    closeTime: 1_000 + offset,
    transactions: [],
    lendingTransactions: [],
  }))
  return {
    endpoint: 'wss://s.devnet.rippletest.net:51233/',
    startLedgerIndex,
    endLedgerIndex: ledgers.at(-1)?.ledgerIndex ?? null,
    latestValidatedLedger: ledgers.at(-1)?.ledgerIndex ?? startLedgerIndex,
    completeToLatest: true,
    ledgers,
    metrics: {
      ledgers: ledgerCount,
      inspectedTransactions: 0,
      lendingTransactions: 0,
      elapsedMs: 10,
    },
  }
}

describe('selectFastLaneHeadRpcEndpoint', () => {
  it('selects the HTTP endpoint on the same host as the ledger WebSocket', () => {
    expect(selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [
        'https://devnet.honeycluster.io/',
        'https://s.devnet.rippletest.net:51234/',
      ],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toBe('https://s.devnet.rippletest.net:51234/')
  })

  it('falls back to the primary HTTP endpoint when no host matches', () => {
    expect(selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [
        'https://devnet.honeycluster.io/',
        'https://fallback.example/',
      ],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toBe('https://devnet.honeycluster.io/')
  })

  it('rejects an empty RPC endpoint list', () => {
    expect(() => selectFastLaneHeadRpcEndpoint({
      rpcEndpoints: [],
      webSocketEndpoint: 'wss://s.devnet.rippletest.net:51233/',
    })).toThrow('Fast-lane shadow requires a Devnet RPC endpoint')
  })
})

describe('selectFastLaneStartLedger', () => {
  it('starts immediately after the canonical base when state is missing', () => {
    expect(selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: null,
    })).toBe(3_860_022)
  })

  it('continues immediately after an existing cursor', () => {
    expect(selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: 3_861_542,
    })).toBe(3_861_543)
  })

  it('rejects a cursor behind the canonical base', () => {
    expect(() => selectFastLaneStartLedger({
      baseLedgerIndex: 3_860_021,
      lastProcessedLedger: 3_860_020,
    })).toThrow('Fast-lane last processed ledger is invalid')
  })
})

describe('selectFastLanePersistenceSafeScan', () => {
  it('keeps a 32-ledger network scan but limits the contiguous persistence prefix to 16 ledgers', () => {
    const scan = emptyLedgerScan(32)
    const selected = selectFastLanePersistenceSafeScan({
      scan,
      latestObservedHash: 'F'.repeat(64),
      processedAt: '2026-09-03T10:00:00.000Z',
    })

    expect(scan.ledgers).toHaveLength(32)
    expect(selected.scan.ledgers).toHaveLength(FAST_LANE_PERSISTENCE_MAX_LEDGERS)
    expect(selected.scan.startLedgerIndex).toBe(100)
    expect(selected.scan.endLedgerIndex).toBe(115)
    expect(selected.scan.completeToLatest).toBe(false)
    expect(selected.plan.startLedgerIndex).toBe(100)
    expect(selected.plan.endLedgerIndex).toBe(115)
    expect(selected.plan.mutations).toHaveLength(0)
  })
})
