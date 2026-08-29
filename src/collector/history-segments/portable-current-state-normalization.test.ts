import { describe, expect, it } from 'vitest'

import type { ValidatedLedgerTransaction } from '../incremental/read-validated-ledger'
import type { IncrementalScanResult } from '../incremental/scan-validated-ledgers'
import { buildPortableCurrentStateNormalizedWork } from './portable-current-state-normalization'

const parentHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)
const transactionHash = 'C'.repeat(64)
const loanId = 'D'.repeat(64)
const brokerId = 'E'.repeat(64)
const vaultId = 'F'.repeat(64)

function event(): ValidatedLedgerTransaction {
  return {
    hash: transactionHash,
    transactionType: 'LoanDelete',
    account: 'rOperator',
    sequence: 7,
    fee: '12',
    result: 'tesSUCCESS',
    transactionIndex: 0,
    transaction: {
      TransactionType: 'LoanDelete',
      Account: 'rOperator',
      Sequence: 7,
      Fee: '12',
    },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 0,
      AffectedNodes: [
        {
          DeletedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: loanId,
            FinalFields: {
              Borrower: 'rBorrower',
              Flags: 0,
              LoanBrokerID: brokerId,
              LoanID: loanId,
              PaymentRemaining: 0,
              PrincipalOutstanding: '0',
              TotalValueOutstanding: '0',
            },
          },
        },
        {
          DeletedNode: {
            LedgerEntryType: 'LoanBroker',
            LedgerIndex: brokerId,
            FinalFields: {
              Account: 'rBroker',
              CoverAvailable: '25',
              CoverRateMinimum: 1000,
              DebtMaximum: '1000',
              DebtTotal: '100',
              LoanBrokerID: brokerId,
              Owner: 'rOwner',
              VaultID: vaultId,
            },
          },
        },
      ],
    },
  }
}

function scan(): IncrementalScanResult {
  const lendingEvent = event()
  return {
    endpoint: 'https://example.invalid',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://example.invalid',
        ledgerIndex: 101,
        ledgerHash,
        parentHash,
        closeTime: 800_000_000,
        transactions: [lendingEvent],
        lendingTransactions: [lendingEvent],
      },
    ],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 1,
    },
  }
}

describe('portable current-state normalization', () => {
  it('retains chain evidence and current tombstones while deferring history classes', async () => {
    const result = await buildPortableCurrentStateNormalizedWork({
      scan: scan(),
      workId: 'current-work-v1:devnet:epoch:base:101:' + parentHash,
      network: 'devnet',
      epochId: 'epoch',
      baseIdentity: 'base',
      previousLedgerIndex: 100,
      expectedParentHash: parentHash,
    })

    expect(result.payload.semanticCounts).toMatchObject({
      validatedLedgers: 1,
      protocolEvents: 0,
      objectChanges: 0,
      loanLifecycleEvents: 0,
      archivedObjects: 0,
      balanceHistory: 0,
      currentProjectionMutations: 2,
      totalRecords: 3,
    })

    const records = result.chunks.flatMap((chunk) => chunk.chunk.records)
    expect(new Set(records.map((record) => record.semanticClass))).toEqual(
      new Set(['validated-ledger', 'current-projection']),
    )
    expect(
      records.filter((record) => record.semanticClass === 'current-projection'),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ objectId: loanId, isTombstone: true, value: null }),
        expect.objectContaining({ objectId: brokerId, isTombstone: true, value: null }),
      ]),
    )

    expect(result.deferredHistoryCounts.protocolEvents).toBe(1)
    expect(result.deferredHistoryCounts.objectChanges).toBeGreaterThan(0)
    expect(result.deferredHistoryCounts.loanLifecycleEvents).toBe(1)
    expect(result.deferredHistoryCounts.archivedObjects).toBe(2)
    expect(result.deferredHistoryCounts.balanceHistory).toBeGreaterThan(0)
    expect(result.deferredHistoryCounts.totalRecords).toBeGreaterThan(0)
    expect(result.deferredHistoryCountsJson).toContain('"totalRecords"')
  })

  it('keeps a validated-ledger witness even when the ledger has no lending transaction', async () => {
    const emptyScan: IncrementalScanResult = {
      ...scan(),
      ledgers: [
        {
          endpoint: 'https://example.invalid',
          ledgerIndex: 101,
          ledgerHash,
          parentHash,
          closeTime: 800_000_000,
          transactions: [],
          lendingTransactions: [],
        },
      ],
      metrics: {
        ledgers: 1,
        inspectedTransactions: 0,
        lendingTransactions: 0,
        elapsedMs: 1,
      },
    }

    const result = await buildPortableCurrentStateNormalizedWork({
      scan: emptyScan,
      workId: 'current-work-v1:devnet:epoch:base:101:' + parentHash,
      network: 'devnet',
      epochId: 'epoch',
      baseIdentity: 'base',
      previousLedgerIndex: 100,
      expectedParentHash: parentHash,
    })

    expect(result.payload.semanticCounts.validatedLedgers).toBe(1)
    expect(result.payload.semanticCounts.currentProjectionMutations).toBe(0)
    expect(result.payload.semanticCounts.totalRecords).toBe(1)
    expect(result.deferredHistoryCounts.totalRecords).toBe(0)
  })
})
