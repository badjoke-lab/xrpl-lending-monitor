import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../collector/incremental/scan-validated-ledgers'
import type { ValidatedLedgerTransaction } from '../collector/incremental/read-validated-ledger'
import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from './portable-collector-xrpl-normalization'

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

describe('portable XRPL seven-class normalization', () => {
  it('uses the existing history derivations and emits all seven portable classes', async () => {
    const result = await buildPortableXrplNormalizedWork({
      scan: scan(),
      workId: 'collector-work-v1:devnet:epoch:base:101:' + parentHash,
      network: 'devnet',
      epochId: 'epoch',
      baseIdentity: 'base',
      previousLedgerIndex: 100,
      expectedParentHash: parentHash,
    })

    expect(result.payload.semanticCounts.validatedLedgers).toBe(1)
    expect(result.payload.semanticCounts.protocolEvents).toBe(1)
    expect(result.payload.semanticCounts.objectChanges).toBeGreaterThan(0)
    expect(result.payload.semanticCounts.loanLifecycleEvents).toBe(1)
    expect(result.payload.semanticCounts.archivedObjects).toBe(2)
    expect(result.payload.semanticCounts.balanceHistory).toBeGreaterThan(0)
    expect(result.payload.semanticCounts.currentProjectionMutations).toBe(2)

    const classes = new Set(
      result.chunks.flatMap((chunk) =>
        chunk.chunk.records.map((record) => record.semanticClass),
      ),
    )
    expect(classes).toEqual(
      new Set([
        'validated-ledger',
        'protocol-event',
        'object-change',
        'loan-lifecycle',
        'archived-object',
        'balance-history',
        'current-projection',
      ]),
    )

    const persisted = result.chunks.flatMap((chunk) =>
      portableReferenceRowsFromChunk(chunk.chunk),
    )
    expect(persisted.filter((row) => row.semanticClass === 'current-projection')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          objectId: loanId,
          isTombstone: true,
          valueJson: null,
        }),
        expect.objectContaining({
          objectId: brokerId,
          isTombstone: true,
          valueJson: null,
        }),
      ]),
    )
    expect(result.semanticCountsJson).toContain('"totalRecords"')
  })
})
