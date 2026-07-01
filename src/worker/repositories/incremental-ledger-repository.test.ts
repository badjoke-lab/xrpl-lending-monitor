import { describe, expect, it } from 'vitest'

import type { IncrementalScanResult } from '../../collector/incremental/scan-validated-ledgers'
import { commitIncrementalScan } from './incremental-ledger-repository'

interface StatementRecord {
  sql: string
  values: unknown[]
}

function fakeDatabase(cursorRows: unknown[]) {
  const statements: StatementRecord[] = []
  const batches: number[][] = []
  let cursorIndex = 0
  const db = {
    prepare(sql: string) {
      const index = statements.length
      const record: StatementRecord = { sql, values: [] }
      statements.push(record)
      const statement = {
        __index: index,
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async first<T>() {
          const row = cursorRows[cursorIndex] ?? null
          cursorIndex += 1
          return row as T | null
        },
      }
      return statement
    },
    async batch(items: Array<{ __index?: number }>) {
      batches.push(items.map((item) => item.__index ?? -1))
      return []
    },
  }
  return { db: db as unknown as D1Database, statements, batches }
}

function scan(): IncrementalScanResult {
  const transaction = {
    hash: 'T'.repeat(64),
    transactionType: 'LoanPay',
    account: 'rAccount',
    sequence: 7,
    fee: '10',
    result: 'tesSUCCESS',
    transactionIndex: 1,
    transaction: { TransactionType: 'LoanPay', Amount: '100' },
    metadata: { TransactionResult: 'tesSUCCESS', TransactionIndex: 1 },
  }
  return {
    endpoint: 'https://devnet.example',
    startLedgerIndex: 11,
    endLedgerIndex: 12,
    latestValidatedLedger: 12,
    completeToLatest: true,
    ledgers: [
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 11,
        ledgerHash: 'B'.repeat(64),
        parentHash: 'A'.repeat(64),
        closeTime: 1001,
        transactions: [transaction],
        lendingTransactions: [transaction],
      },
      {
        endpoint: 'https://devnet.example',
        ledgerIndex: 12,
        ledgerHash: 'C'.repeat(64),
        parentHash: 'B'.repeat(64),
        closeTime: 1002,
        transactions: [],
        lendingTransactions: [],
      },
    ],
    metrics: {
      ledgers: 2,
      inspectedTransactions: 1,
      lendingTransactions: 1,
      elapsedMs: 20,
    },
  }
}

const before = {
  epoch_id: 'epoch-1',
  last_processed_ledger: 10,
  last_processed_hash: 'A'.repeat(64),
}
const after = {
  epoch_id: 'epoch-1',
  last_processed_ledger: 12,
  last_processed_hash: 'C'.repeat(64),
}

describe('commitIncrementalScan', () => {
  it('writes ledgers and matching events before guarded cursor advancement', async () => {
    const state = fakeDatabase([before, after])
    const status = await commitIncrementalScan({
      db: state.db,
      epochId: 'epoch-1',
      expectedPreviousLedger: 10,
      expectedPreviousHash: 'A'.repeat(64),
      scan: scan(),
      processedAt: '2026-07-01T00:00:00.000Z',
      retainPayloads: true,
    })

    expect(status).toBe('committed')
    expect(state.batches).toHaveLength(1)
    const batched = state.batches[0]?.map((index) => state.statements[index]?.sql) ?? []
    expect(batched.filter((sql) => sql?.includes('INSERT INTO processed_ledgers'))).toHaveLength(2)
    expect(batched.filter((sql) => sql?.includes('INSERT INTO protocol_events'))).toHaveLength(1)
    expect(batched.at(-1)).toContain('UPDATE sync_state')
    const eventStatement = state.statements.find((item) => item.sql.includes('protocol_events'))
    expect(eventStatement?.values[8]).toBe(JSON.stringify({ TransactionType: 'LoanPay', Amount: '100' }))
    expect(eventStatement?.values[10]).toBe(1)
  })

  it('stores no source payload when retention is disabled', async () => {
    const state = fakeDatabase([before, after])
    await commitIncrementalScan({
      db: state.db,
      epochId: 'epoch-1',
      expectedPreviousLedger: 10,
      expectedPreviousHash: 'A'.repeat(64),
      scan: scan(),
      processedAt: '2026-07-01T00:00:00.000Z',
      retainPayloads: false,
    })

    const eventStatement = state.statements.find((item) => item.sql.includes('protocol_events'))
    expect(eventStatement?.values.slice(8, 11)).toEqual([null, null, 0])
  })

  it('returns already committed after an ambiguous retry reaches the same final cursor', async () => {
    const state = fakeDatabase([after])
    await expect(
      commitIncrementalScan({
        db: state.db,
        epochId: 'epoch-1',
        expectedPreviousLedger: 10,
        expectedPreviousHash: 'A'.repeat(64),
        scan: scan(),
        processedAt: '2026-07-01T00:00:00.000Z',
        retainPayloads: true,
      }),
    ).resolves.toBe('already_committed')
    expect(state.batches).toHaveLength(0)
  })

  it('rejects persistence when the cursor changed before the batch', async () => {
    const state = fakeDatabase([
      {
        epoch_id: 'epoch-1',
        last_processed_ledger: 11,
        last_processed_hash: 'B'.repeat(64),
      },
    ])
    await expect(
      commitIncrementalScan({
        db: state.db,
        epochId: 'epoch-1',
        expectedPreviousLedger: 10,
        expectedPreviousHash: 'A'.repeat(64),
        scan: scan(),
        processedAt: '2026-07-01T00:00:00.000Z',
        retainPayloads: true,
      }),
    ).rejects.toThrow('cursor changed before persistence')
    expect(state.batches).toHaveLength(0)
  })

  it('does not query or write for an empty scan', async () => {
    const state = fakeDatabase([])
    const empty = { ...scan(), ledgers: [], endLedgerIndex: null }
    await expect(
      commitIncrementalScan({
        db: state.db,
        epochId: 'epoch-1',
        expectedPreviousLedger: 12,
        expectedPreviousHash: 'C'.repeat(64),
        scan: empty,
        processedAt: '2026-07-01T00:00:00.000Z',
        retainPayloads: true,
      }),
    ).resolves.toBe('empty')
    expect(state.statements).toHaveLength(0)
  })
})
