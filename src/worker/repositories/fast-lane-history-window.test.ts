import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import { buildFastLaneHistoryBundle } from './fast-lane-history-window'

function scan(): IncrementalScanResult {
  const event = {
    hash: 'A'.repeat(64),
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: 1,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 2,
    transaction: { TransactionType: 'LoanPay', Account: 'rAccount' },
    metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: 2, AffectedNodes: [] },
  }
  return {
    endpoint: 'wss://example.invalid/',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [{
      endpoint: 'wss://example.invalid/',
      ledgerIndex: 101,
      ledgerHash: 'C'.repeat(64),
      parentHash: 'P'.repeat(64),
      closeTime: 1234,
      transactions: [event],
      lendingTransactions: [event],
    }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 10,
    },
  }
}

describe('fast-lane compact history bundle', () => {
  it('records public activity from the exact fast-lane scan window', () => {
    const bundle = buildFastLaneHistoryBundle({
      scan: scan(),
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })

    expect(bundle).toMatchObject({
      schemaVersion: 1,
      epochId: 'devnet-epoch-1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      endLedgerHash: 'C'.repeat(64),
      createdAt: '2026-07-13T09:00:00.000Z',
    })
    expect(bundle.protocolEvents).toEqual([{
      eventHash: 'A'.repeat(64),
      epochId: 'devnet-epoch-1',
      ledgerIndex: 101,
      eventIndex: 2,
      closeTime: 1234,
      eventType: 'LoanPay',
      resultCode: 'tesSUCCESS',
      payloadRetained: false,
      sourceJson: null,
      metadataJson: null,
      createdAt: '2026-07-13T09:00:00.000Z',
    }])
    expect(bundle.objectChanges).toEqual([])
    expect(bundle.loanLifecycle).toEqual([])
    expect(bundle.archivedObjects).toEqual([])
    expect(bundle.balanceHistory).toEqual([])
  })

  it('rejects an empty scan', () => {
    const empty = scan()
    empty.ledgers = []
    empty.endLedgerIndex = null

    expect(() => buildFastLaneHistoryBundle({
      scan: empty,
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })).toThrow('non-empty scan')
  })
})
