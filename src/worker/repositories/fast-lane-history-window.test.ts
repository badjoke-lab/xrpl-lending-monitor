import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import { buildFastLaneHistoryBundle } from './fast-lane-history-window'

const TRANSACTION = 'A'.repeat(64)
const LEDGER = 'C'.repeat(64)
const PARENT = 'P'.repeat(64)
const LOAN = 'L'.repeat(64)
const BROKER = 'B'.repeat(64)

function loanFields() {
  return {
    Borrower: 'rBorrower',
    Flags: 0,
    LoanBrokerID: BROKER,
    LoanSequence: 7,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 20,
    PreviousPaymentDueDate: 1000,
    NextPaymentDueDate: 1300,
    PaymentRemaining: 3,
    PrincipalOutstanding: '900',
    TotalValueOutstanding: '990',
    PeriodicPayment: '330',
  }
}

function scan(): IncrementalScanResult {
  const event = {
    hash: TRANSACTION,
    transactionType: 'LoanSet',
    account: 'rAccount',
    sequence: 1,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 2,
    transaction: { TransactionType: 'LoanSet', Account: 'rAccount' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 2,
      AffectedNodes: [{
        CreatedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: LOAN,
          NewFields: loanFields(),
        },
      }],
    },
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
      ledgerHash: LEDGER,
      parentHash: PARENT,
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
  it('records activity and semantic history from the exact fast-lane scan window', () => {
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
      endLedgerHash: LEDGER,
      createdAt: '2026-07-13T09:00:00.000Z',
    })
    expect(bundle.protocolEvents).toEqual([{
      eventHash: TRANSACTION,
      epochId: 'devnet-epoch-1',
      ledgerIndex: 101,
      eventIndex: 2,
      closeTime: 1234,
      eventType: 'LoanSet',
      resultCode: 'tesSUCCESS',
      payloadRetained: false,
      sourceJson: null,
      metadataJson: null,
      createdAt: '2026-07-13T09:00:00.000Z',
    }])
    expect(bundle.objectChanges.length).toBeGreaterThan(0)
    expect(bundle.objectChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        transactionHash: TRANSACTION,
        objectType: 'Loan',
        objectId: LOAN,
        action: 'created',
      }),
    ]))
    expect(bundle.loanLifecycle).toEqual([
      expect.objectContaining({
        loanId: LOAN,
        transactionHash: TRANSACTION,
        eventType: 'created',
      }),
    ])
    expect(bundle.archivedObjects).toEqual([])
    expect(bundle.balanceHistory).toEqual([])
  })

  it('fails before persistence when the semantic bundle exceeds its byte limit', () => {
    const oversized = scan()
    const template = oversized.ledgers[0]?.lendingTransactions[0]
    if (!template || !oversized.ledgers[0]) throw new Error('test fixture is incomplete')
    const events = Array.from({ length: 1_000 }, (_, index) => ({
      ...template,
      hash: index.toString(16).padStart(64, '0').toUpperCase(),
      transactionIndex: index,
      metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: index, AffectedNodes: [] },
    }))
    oversized.ledgers[0].transactions = events
    oversized.ledgers[0].lendingTransactions = events
    oversized.metrics.inspectedTransactions = events.length
    oversized.metrics.lendingTransactions = events.length

    expect(() => buildFastLaneHistoryBundle({
      scan: oversized,
      epochId: 'devnet-epoch-1',
      processedAt: '2026-07-13T09:00:00.000Z',
    })).toThrow('exceeds the persistence limit')
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
