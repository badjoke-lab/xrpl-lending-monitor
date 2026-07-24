import { describe, expect, it } from 'vitest'

import type { FastLaneShadowWindowPlan } from '../../collector/incremental/fast-lane-shadow-plan'
import { commitFastLaneCompactShadowWindow } from './fast-lane-compact-shadow-repository'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'

const ENCODED_HISTORY_BUNDLE = 'gzip-base64-v1:test-payload'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

function plan(): FastLaneShadowWindowPlan {
  return {
    epochId: 'fast-lane-shadow-devnet',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    endLedgerHash: 'C'.repeat(64),
    latestObservedLedger: 101,
    latestObservedHash: 'C'.repeat(64),
    windowStartCloseTime: 1000,
    windowEndCloseTime: 1299,
    inspectedTransactions: 5,
    lendingTransactions: 1,
    successfulLendingTransactions: 1,
    activity: [{
      hash: '1'.repeat(64),
      ledgerIndex: 101,
      transactionIndex: 1,
      transactionType: 'LoanPay',
      result: 'tesSUCCESS',
      account: 'rAccount',
    }],
    mutations: [{
      mutation: {
        operation: 'upsert',
        objectType: 'loan',
        objectId: 'L'.repeat(64),
        projectionJson: JSON.stringify({ id: 'L'.repeat(64) }),
      },
      ledgerIndex: 101,
      ledgerHash: 'C'.repeat(64),
      transactionHash: '1'.repeat(64),
      transactionIndex: 1,
      updatedAt: '2026-07-11T03:00:00.000Z',
    }],
  }
}

function historyBundle(): FastLaneHistoryBundle {
  return {
    schemaVersion: 1,
    epochId: 'devnet-epoch-1',
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    endLedgerHash: 'C'.repeat(64),
    createdAt: '2026-07-11T03:00:00.000Z',
    protocolEvents: [],
    objectChanges: [],
    loanLifecycle: [],
    archivedObjects: [],
    balanceHistory: [],
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
              epoch_id: 'fast-lane-shadow-devnet',
              last_processed_ledger: 101,
              last_processed_hash: 'C'.repeat(64),
              latest_observed_ledger: 101,
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

describe('compact fast-lane shadow persistence', () => {
  it('writes current objects and one encoded compact history bundle in the same batch', async () => {
    const state = fakeDatabase()
    await commitFastLaneCompactShadowWindow({
      db: state.db,
      plan: plan(),
      historyBundle: historyBundle(),
      encodedHistoryBundle: ENCODED_HISTORY_BUNDLE,
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'P'.repeat(64),
      processedAt: '2026-07-11T03:00:00.000Z',
    })

    const sql = state.batches[0]?.map((index) => state.prepared[index]?.sql ?? '') ?? []
    expect(sql.some((item) => item.includes('INSERT INTO fast_lane_shadow_objects_compact'))).toBe(true)
    expect(sql.some((item) => item.includes('INSERT INTO fast_lane_history_windows'))).toBe(true)
    expect(sql.some((item) => item.includes('INSERT INTO fast_lane_shadow_objects ('))).toBe(false)
    const historyStatement = state.prepared.find((item) => item.sql.includes('INSERT INTO fast_lane_history_windows'))
    expect(historyStatement?.values).toContain(ENCODED_HISTORY_BUNDLE)
  })

  it('rejects a history bundle from a different ledger window', async () => {
    const state = fakeDatabase()
    await expect(commitFastLaneCompactShadowWindow({
      db: state.db,
      plan: plan(),
      historyBundle: { ...historyBundle(), endLedgerIndex: 102 },
      encodedHistoryBundle: ENCODED_HISTORY_BUNDLE,
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'P'.repeat(64),
      processedAt: '2026-07-11T03:00:00.000Z',
    })).rejects.toThrow('Fast-lane activity partition does not match its history partition')
    expect(state.batches).toHaveLength(0)
  })
})
