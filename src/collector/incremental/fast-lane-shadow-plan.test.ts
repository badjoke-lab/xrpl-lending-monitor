import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from './scan-validated-ledgers'
import { buildFastLaneShadowWindowPlan } from './fast-lane-shadow-plan'

function loanFields(paymentRemaining: number, principalOutstanding: string) {
  return {
    Borrower: 'rBorrower',
    Flags: 0,
    LoanBrokerID: 'B'.repeat(64),
    LoanSequence: 7,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 20,
    PreviousPaymentDueDate: 1000,
    NextPaymentDueDate: 1300,
    PaymentRemaining: paymentRemaining,
    PrincipalOutstanding: principalOutstanding,
    TotalValueOutstanding: principalOutstanding,
    PeriodicPayment: '300',
  }
}

function event(hash: string, transactionIndex: number, fields: Record<string, unknown>) {
  return {
    hash,
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: transactionIndex,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex,
    transaction: { TransactionType: 'LoanPay' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: transactionIndex,
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: 'L'.repeat(64),
            FinalFields: fields,
          },
        },
      ],
    },
  }
}

function scan(): IncrementalScanResult {
  const first = event('1'.repeat(64), 1, loanFields(3, '900'))
  const second = event('2'.repeat(64), 0, loanFields(2, '600'))
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    latestValidatedLedger: 102,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 101,
        ledgerHash: 'A'.repeat(64),
        parentHash: 'P'.repeat(64),
        closeTime: 1000,
        transactions: [first],
        lendingTransactions: [first],
      },
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 102,
        ledgerHash: 'C'.repeat(64),
        parentHash: 'A'.repeat(64),
        closeTime: 1299,
        transactions: [second],
        lendingTransactions: [second],
      },
    ],
    metrics: {
      ledgers: 2,
      inspectedTransactions: 2,
      lendingTransactions: 2,
      elapsedMs: 5,
    },
  }
}

describe('buildFastLaneShadowWindowPlan', () => {
  it('bundles activity and coalesces repeated object mutations to the latest state', () => {
    const plan = buildFastLaneShadowWindowPlan({
      epochId: 'epoch-1',
      scan: scan(),
      latestObservedHash: 'C'.repeat(64),
      processedAt: '2026-07-11T03:00:00.000Z',
    })

    expect(plan.activity).toHaveLength(2)
    expect(plan.successfulLendingTransactions).toBe(2)
    expect(plan.mutations).toHaveLength(1)
    expect(plan.mutations[0]).toMatchObject({
      ledgerIndex: 102,
      transactionIndex: 0,
      transactionHash: '2'.repeat(64),
    })
    const mutation = plan.mutations[0]?.mutation
    expect(mutation?.operation).toBe('upsert')
    if (mutation?.operation !== 'upsert') throw new Error('expected upsert')
    expect(JSON.parse(mutation.projectionJson)).toMatchObject({
      paymentRemaining: 2,
      principalOutstanding: '600',
      previousLedgerIndex: 102,
    })
  })
})
