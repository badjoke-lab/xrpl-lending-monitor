import { describe, expect, it } from 'vitest'

import type { FastLaneShadowWindowPlan } from '../../collector/incremental/fast-lane-shadow-plan'
import { commitFastLaneShadowWindow } from './fast-lane-shadow-repository'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

function plan(): FastLaneShadowWindowPlan {
  return {
    epochId: 'epoch-1',
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    endLedgerHash: 'C'.repeat(64),
    latestObservedLedger: 102,
    latestObservedHash: 'C'.repeat(64),
    windowStartCloseTime: 1000,
    windowEndCloseTime: 1299,
    inspectedTransactions: 25,
    lendingTransactions: 2,
    successfulLendingTransactions: 2,
    activity: [
      {
        hash: '1'.repeat(64),
        ledgerIndex: 101,
        transactionIndex: 1,
        transactionType: 'LoanPay',
        result: 'tesSUCCESS',
        account: 'rAccount',
      },
      {
        hash: '2'.repeat(64),
        ledgerIndex: 102,
        transactionIndex: 0,
        transactionType: 'LoanPay',
        result: 'tesSUCCESS',
        account: 'rAccount',
      },
    ],
    mutations: [
      {
        mutation: {
          operation: 'upsert',
          objectType: 'loan',
          objectId: 'L'.repeat(64),
          projectionJson: JSON.stringify({ id: 'L'.repeat(64), paymentRemaining: 2 }),
          relationships: {
            borrower: 'rBorrower',
            loanBrokerId: 'B'.repeat(64),
            onLedgerStatus: 'active',
          },
        },
        ledgerIndex: 102,
        ledgerHash: 'C'.repeat(64),
        transactionHash: '2'.repeat(64),
        transactionIndex: 0,
        updatedAt: '2026-07-11T03:00:00.000Z',
      },
    ],
  }
}

function fakeDatabase() {
  const prepared: PreparedRecord[] = []
  const batches: number[][] = []
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
          if (sql.includes('FROM fast_lane_shadow_state')) {
            return {
              epoch_id: 'epoch-1',
              last_processed_ledger: 102,
              last_processed_hash: 'C'.repeat(64),
              latest_observed_ledger: 102,
              latest_observed_hash: 'C'.repeat(64),
              status: 'healthy',
              updated_at: '2026-07-11T03:00:00.000Z',
            } as T
          }
          throw new Error(`Unexpected first query: ${sql}`)
        },
      }
      return statement
    },
    async batch(statements: Array<{ __index?: number }>) {
      batches.push(statements.map((statement) => statement.__index ?? -1))
      return statements.map(() => ({ meta: { rows_read: 0, rows_written: 1 } }))
    },
  }
  return { db: db as unknown as D1Database, prepared, batches }
}

describe('fast-lane shadow persistence', () => {
  it('commits guard, coalesced object, activity bundle, and isolated cursor in one batch', async () => {
    const state = fakeDatabase()
    const usage = await commitFastLaneShadowWindow({
      db: state.db,
      plan: plan(),
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'P'.repeat(64),
      processedAt: '2026-07-11T03:00:00.000Z',
    })

    expect(state.batches).toHaveLength(1)
    const sql = state.batches[0]?.map((index) => state.prepared[index]?.sql ?? '') ?? []
    expect(sql.findIndex((item) => item.includes('INSERT INTO fast_lane_shadow_state'))).toBe(0)
    const guard = sql.findIndex((item) => item.includes('INSERT INTO fast_lane_shadow_commit_guards'))
    const object = sql.findIndex((item) => item.includes('INSERT INTO fast_lane_shadow_objects'))
    const window = sql.findIndex((item) => item.includes('INSERT INTO fast_lane_shadow_windows'))
    const cursor = sql.findIndex((item) => item.includes('UPDATE fast_lane_shadow_state'))
    const cleanup = sql.findIndex((item) => item.includes('DELETE FROM fast_lane_shadow_commit_guards'))

    expect(guard).toBeGreaterThan(0)
    expect(object).toBeGreaterThan(guard)
    expect(window).toBeGreaterThan(object)
    expect(cursor).toBeGreaterThan(window)
    expect(cleanup).toBeGreaterThan(cursor)
    expect(usage).toEqual({ statements: 6, rowsRead: 0, rowsWritten: 6 })
  })

  it('rejects a non-contiguous window before touching D1', async () => {
    const state = fakeDatabase()
    const invalid = { ...plan(), startLedgerIndex: 102 }

    await expect(commitFastLaneShadowWindow({
      db: state.db,
      plan: invalid,
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'P'.repeat(64),
      processedAt: '2026-07-11T03:00:00.000Z',
    })).rejects.toThrow('does not begin after the expected cursor')

    expect(state.batches).toHaveLength(0)
  })
})
