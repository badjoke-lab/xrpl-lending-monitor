import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../incremental/scan-validated-ledgers'
import { buildHistorySegmentRecords } from './build-segment-records'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const T = 'D'.repeat(64)
const L = 'E'.repeat(64)
const BROKER = 'F'.repeat(64)

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
    hash: T,
    transactionType: 'LoanSet',
    account: 'rAccount',
    sequence: 1,
    fee: '12',
    result: 'tesSUCCESS',
    transactionIndex: 0,
    transaction: { TransactionType: 'LoanSet', Account: 'rAccount' },
    metadata: {
      AffectedNodes: [
        {
          CreatedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: L,
            NewFields: loanFields(),
          },
        },
      ],
    },
  }
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    latestValidatedLedger: 102,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: 101,
        ledgerHash: B,
        parentHash: A,
        closeTime: 1001,
        transactions: [],
        lendingTransactions: [],
      },
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: 102,
        ledgerHash: C,
        parentHash: B,
        closeTime: 1002,
        transactions: [event],
        lendingTransactions: [event],
      },
    ],
    metrics: {
      ledgers: 2,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 10,
    },
  }
}

describe('history segment record builder', () => {
  it('reuses collector derivations without D1 persistence', () => {
    const records = buildHistorySegmentRecords({ scan: scan(), epochId: 'devnet-test' })

    expect(records.ledgers.map((ledger) => ledger.ledgerIndex)).toEqual([101, 102])
    expect(records.protocolEvents).toEqual([
      expect.objectContaining({
        eventHash: T,
        ledgerIndex: 102,
        eventType: 'LoanSet',
        resultCode: 'tesSUCCESS',
      }),
    ])
    expect(records.objectChanges.length).toBeGreaterThan(0)
    expect(records.lifecycleEvents).toEqual([
      expect.objectContaining({ loanId: L, eventType: 'created' }),
    ])
    expect(records.currentProjectionMutations).toEqual([
      expect.objectContaining({
        ledgerIndex: 102,
        ledgerHash: C,
        transactionHash: T,
        mutation: expect.objectContaining({
          operation: 'upsert',
          objectType: 'loan',
          objectId: L,
        }),
      }),
    ])
  })

  it('rejects a ledger index gap', () => {
    const input = scan()
    input.ledgers = input.ledgers.map((ledger, index) =>
      index === 1 ? { ...ledger, ledgerIndex: 103 } : ledger,
    )
    input.endLedgerIndex = 103
    expect(() => buildHistorySegmentRecords({ scan: input, epochId: 'devnet-test' })).toThrow('index gap')
  })

  it('rejects a parent-hash discontinuity', () => {
    const input = scan()
    input.ledgers = input.ledgers.map((ledger, index) =>
      index === 1 ? { ...ledger, parentHash: A } : ledger,
    )
    expect(() => buildHistorySegmentRecords({ scan: input, epochId: 'devnet-test' })).toThrow('parent-hash discontinuity')
  })
})
