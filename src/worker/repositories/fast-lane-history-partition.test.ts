import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import {
  buildBoundedFastLaneHistoryWindows,
  MAX_FAST_LANE_HISTORY_BUNDLE_BYTES,
} from './fast-lane-history-window'

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').toUpperCase()
}

function denseScan(): IncrementalScanResult {
  const ledgers = Array.from({ length: 4 }, (_, ledgerOffset) => {
    const ledgerIndex = 101 + ledgerOffset
    const transactions = Array.from({ length: 2_500 }, (_, transactionIndex) => ({
      hash: hash(`${ledgerIndex}:${transactionIndex}`),
      transactionType: 'LoanPay',
      account: 'rAccount',
      sequence: transactionIndex,
      fee: '10',
      result: 'tesSUCCESS',
      transactionIndex,
      transaction: { TransactionType: 'LoanPay', Account: 'rAccount' },
      metadata: {
        TransactionResult: 'tesSUCCESS',
        TransactionIndex: transactionIndex,
        AffectedNodes: [],
      },
    }))
    return {
      endpoint: 'wss://example.invalid/',
      ledgerIndex,
      ledgerHash: hash(`ledger:${ledgerIndex}`),
      parentHash: ledgerOffset === 0 ? hash('ledger:100') : hash(`ledger:${ledgerIndex - 1}`),
      closeTime: 1000 + ledgerOffset,
      transactions,
      lendingTransactions: transactions,
    }
  })
  return {
    endpoint: 'wss://example.invalid/',
    startLedgerIndex: 101,
    endLedgerIndex: 104,
    latestValidatedLedger: 104,
    completeToLatest: true,
    ledgers,
    metrics: {
      ledgers: ledgers.length,
      inspectedTransactions: ledgers.reduce((total, ledger) => total + ledger.transactions.length, 0),
      lendingTransactions: ledgers.reduce((total, ledger) => total + ledger.lendingTransactions.length, 0),
      elapsedMs: 10,
    },
  }
}

describe('partitioned fast-lane history', () => {
  it('retains every ledger in contiguous bounded bundles', async () => {
    const windows = await buildBoundedFastLaneHistoryWindows({
      scan: denseScan(),
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-24T13:00:00.000Z',
    })

    expect(windows.length).toBeGreaterThan(1)
    expect(windows[0]?.bundle.startLedgerIndex).toBe(101)
    expect(windows.at(-1)?.bundle.endLedgerIndex).toBe(104)
    expect(windows.reduce((total, window) => total + window.scan.ledgers.length, 0)).toBe(4)
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]
      if (!window) throw new Error('missing history window')
      expect(window.encodedBytes).toBeLessThanOrEqual(MAX_FAST_LANE_HISTORY_BUNDLE_BYTES)
      if (index > 0) {
        expect(window.bundle.startLedgerIndex).toBe(windows[index - 1]!.bundle.endLedgerIndex + 1)
      }
    }
  }, 30_000)
})
