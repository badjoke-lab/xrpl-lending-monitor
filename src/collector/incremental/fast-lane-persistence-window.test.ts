import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from './scan-validated-ledgers'
import { selectFastLanePersistenceWindow } from './fast-lane-persistence-window'

function loanFields(seed: number) {
  return {
    Borrower: `rBorrower${seed}`,
    Flags: 0,
    LoanBrokerID: 'B'.repeat(64),
    LoanSequence: seed,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 20,
    PreviousPaymentDueDate: 1000,
    NextPaymentDueDate: 1300,
    PaymentRemaining: 3,
    PrincipalOutstanding: '900',
    TotalValueOutstanding: '900',
    PeriodicPayment: '300',
  }
}

function event(seed: number, transactionIndex = 0) {
  const objectId = seed.toString(16).toUpperCase().padStart(64, '0')
  const hash = (seed + 1000).toString(16).toUpperCase().padStart(64, '0')
  return {
    hash,
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: seed,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex,
    transaction: { TransactionType: 'LoanPay' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: transactionIndex,
      AffectedNodes: [{
        ModifiedNode: {
          LedgerEntryType: 'Loan',
          LedgerIndex: objectId,
          FinalFields: loanFields(seed),
        },
      }],
    },
  }
}

function scanWithOneMutationPerLedger(count: number): IncrementalScanResult {
  const ledgers = Array.from({ length: count }, (_, offset) => {
    const ledgerIndex = 101 + offset
    const item = event(ledgerIndex)
    return {
      endpoint: 'https://devnet.example',
      ledgerIndex,
      ledgerHash: ledgerIndex.toString(16).toUpperCase().padStart(64, '0'),
      parentHash: (ledgerIndex - 1).toString(16).toUpperCase().padStart(64, '0'),
      closeTime: 1000 + offset,
      transactions: [item],
      lendingTransactions: [item],
    }
  })
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 101,
    endLedgerIndex: 100 + count,
    latestValidatedLedger: 100 + count,
    completeToLatest: true,
    ledgers,
    metrics: {
      ledgers: count,
      inspectedTransactions: count,
      lendingTransactions: count,
      elapsedMs: 5,
    },
  }
}

function scanWithMutationsInFirstLedger(count: number): IncrementalScanResult {
  const items = Array.from({ length: count }, (_, offset) => event(2000 + offset, offset))
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [{
      endpoint: 'https://devnet.example',
      ledgerIndex: 101,
      ledgerHash: 'A'.repeat(64),
      parentHash: 'B'.repeat(64),
      closeTime: 1000,
      transactions: items,
      lendingTransactions: items,
    }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: count,
      lendingTransactions: count,
      elapsedMs: 5,
    },
  }
}

describe('selectFastLanePersistenceWindow', () => {
  it('commits the largest contiguous prefix that stays within 24 coalesced mutations', () => {
    const selected = selectFastLanePersistenceWindow({
      scan: scanWithOneMutationPerLedger(25),
      epochId: 'fast-lane-shadow-devnet',
      latestObservedHash: 'F'.repeat(64),
      processedAt: '2026-09-03T12:00:00.000Z',
    })

    expect(selected.scan.metrics.ledgers).toBe(24)
    expect(selected.scan.endLedgerIndex).toBe(124)
    expect(selected.plan.endLedgerIndex).toBe(124)
    expect(selected.plan.mutations).toHaveLength(24)
    expect(selected.plan.latestObservedLedger).toBe(125)
  })

  it('fails closed before persistence when no non-empty prefix fits the mutation budget', () => {
    expect(() => selectFastLanePersistenceWindow({
      scan: scanWithMutationsInFirstLedger(25),
      epochId: 'fast-lane-shadow-devnet',
      latestObservedHash: 'F'.repeat(64),
      processedAt: '2026-09-03T12:00:00.000Z',
    })).toThrow('Fast-lane first persistence window exceeds mutation budget: limit=24')
  })
})
