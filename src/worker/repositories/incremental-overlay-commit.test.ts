import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import type { CurrentStateOverlayBaseIdentity } from './current-state-overlay'
import { commitIncrementalScan } from './incremental-ledger-repository'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

function completeLoanFields() {
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
    PaymentRemaining: 2,
    PrincipalOutstanding: '600',
    TotalValueOutstanding: '660',
    PeriodicPayment: '330',
  }
}

function scan(previousHash: string): IncrementalScanResult {
  const transaction = {
    hash: 'T'.repeat(64),
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: 7,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 1,
    transaction: { TransactionType: 'LoanPay', Amount: '300' },
    metadata: {
      TransactionResult: 'tesSUCCESS',
      TransactionIndex: 1,
      AffectedNodes: [
        {
          ModifiedNode: {
            LedgerEntryType: 'Loan',
            LedgerIndex: 'L'.repeat(64),
            PreviousFields: {
              PaymentRemaining: 3,
              PrincipalOutstanding: '900',
            },
            FinalFields: completeLoanFields(),
          },
        },
      ],
    },
  }

  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    latestValidatedLedger: 101,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 101,
        ledgerHash: 'N'.repeat(64),
        parentHash: previousHash,
        closeTime: 1001,
        transactions: [transaction],
        lendingTransactions: [transaction],
      },
    ],
    metrics: {
      ledgers: 1,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 10,
    },
  }
}

function fakeDatabase(options: {
  epochId: string
  base: CurrentStateOverlayBaseIdentity
  previousLedger: number
  previousHash: string
  finalLedger: number
  finalHash: string
}) {
  const prepared: PreparedRecord[] = []
  const batches: number[][] = []
  let cursorReads = 0
  let overlayReads = 0

  const db = {
    prepare(sql: string) {
      const index = prepared.length
      const record: PreparedRecord = { sql, values: [] }
      prepared.push(record)
      const statement = {
        __index: index,
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM sync_state')) {
            cursorReads += 1
            const final = cursorReads > 1
            return {
              epoch_id: options.epochId,
              last_processed_ledger: final ? options.finalLedger : options.previousLedger,
              last_processed_hash: final ? options.finalHash : options.previousHash,
            } as T
          }
          if (sql.includes('FROM current_state_overlay_state')) {
            overlayReads += 1
            const final = overlayReads > 1
            return {
              network: 'devnet',
              epoch_id: options.epochId,
              base_snapshot_id: options.base.baseSnapshotId,
              base_ledger_index: options.base.baseLedgerIndex,
              base_ledger_hash: options.base.baseLedgerHash,
              overlay_ledger_index: final ? options.finalLedger : options.previousLedger,
              overlay_ledger_hash: final ? options.finalHash : options.previousHash,
              updated_at: '2026-07-04T14:00:00.000Z',
            } as T
          }
          throw new Error(`Unexpected first query: ${sql}`)
        },
      }
      return statement
    },
    async batch(statements: Array<{ __index?: number }>) {
      batches.push(statements.map((statement) => statement.__index ?? -1))
      return []
    },
  }

  return { db: db as unknown as D1Database, prepared, batches }
}

describe('incremental overlay commit integration', () => {
  it('commits history, projection mutation, watermark, and cursor in one guarded batch', async () => {
    const previousHash = 'A'.repeat(64)
    const finalHash = 'N'.repeat(64)
    const base: CurrentStateOverlayBaseIdentity = {
      network: 'devnet',
      epochId: 'epoch-1',
      baseSnapshotId: 'snapshot-100',
      baseLedgerIndex: 100,
      baseLedgerHash: previousHash,
    }
    const state = fakeDatabase({
      epochId: 'epoch-1',
      base,
      previousLedger: 100,
      previousHash,
      finalLedger: 101,
      finalHash,
    })

    await expect(
      commitIncrementalScan({
        db: state.db,
        epochId: 'epoch-1',
        base,
        expectedPreviousLedger: 100,
        expectedPreviousHash: previousHash,
        scan: scan(previousHash),
        processedAt: '2026-07-04T14:00:00.000Z',
        retainPayloads: true,
      }),
    ).resolves.toBe('committed')

    expect(state.batches).toHaveLength(1)
    const sql = state.batches[0]?.map((index) => state.prepared[index]?.sql ?? '') ?? []
    const incrementalGuard = sql.findIndex((item) => item.includes('INSERT INTO incremental_commit_guards'))
    const overlayBeforeGuard = sql.findIndex((item) => item.includes('INSERT INTO current_state_overlay_commit_guards'))
    const overlayMutation = sql.findIndex((item) => item.includes('INSERT INTO current_state_overlay_objects'))
    const watermarkUpdate = sql.findIndex((item) => item.includes('UPDATE current_state_overlay_state'))
    const overlayGuardIndexes = sql
      .map((item, index) => item.includes('INSERT INTO current_state_overlay_commit_guards') ? index : -1)
      .filter((index) => index >= 0)
    const cursorUpdate = sql.findIndex((item) => item.includes('UPDATE sync_state'))

    expect(incrementalGuard).toBe(0)
    expect(overlayBeforeGuard).toBe(1)
    expect(overlayMutation).toBeGreaterThan(overlayBeforeGuard)
    expect(watermarkUpdate).toBeGreaterThan(overlayMutation)
    expect(overlayGuardIndexes).toHaveLength(2)
    expect(overlayGuardIndexes[1]).toBeGreaterThan(watermarkUpdate)
    expect(cursorUpdate).toBeGreaterThan(overlayGuardIndexes[1] ?? -1)
  })
})
