import { describe, expect, it } from 'vitest'

import type { FastLaneShadowWindowPlan } from '../../collector/incremental/fast-lane-shadow-plan'
import { commitFastLaneCompactShadowWindows } from './fast-lane-compact-shadow-repository'
import type { FastLaneHistoryBundle } from './fast-lane-history-window'

interface PreparedRecord {
  sql: string
  values: unknown[]
}

function history(start: number, end: number, endHash: string): FastLaneHistoryBundle {
  return {
    schemaVersion: 1,
    epochId: 'devnet-epoch-1',
    startLedgerIndex: start,
    endLedgerIndex: end,
    endLedgerHash: endHash,
    createdAt: '2026-07-24T13:00:00.000Z',
    protocolEvents: [],
    objectChanges: [],
    loanLifecycle: [],
    archivedObjects: [],
    balanceHistory: [],
  }
}

function plan(): FastLaneShadowWindowPlan {
  return {
    epochId: 'fast-lane-shadow-devnet',
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    endLedgerHash: 'D'.repeat(64),
    latestObservedLedger: 102,
    latestObservedHash: 'D'.repeat(64),
    windowStartCloseTime: 1000,
    windowEndCloseTime: 1001,
    inspectedTransactions: 2,
    lendingTransactions: 2,
    successfulLendingTransactions: 2,
    activity: [],
    mutations: [{
      mutation: {
        operation: 'upsert',
        objectType: 'loan',
        objectId: 'L'.repeat(64),
        projectionJson: JSON.stringify({ id: 'L'.repeat(64) }),
      },
      ledgerIndex: 102,
      ledgerHash: 'D'.repeat(64),
      transactionHash: '2'.repeat(64),
      transactionIndex: 1,
      updatedAt: '2026-07-24T13:00:00.000Z',
    }],
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
              last_processed_ledger: 102,
              last_processed_hash: 'D'.repeat(64),
              latest_observed_ledger: 102,
              latest_observed_hash: 'D'.repeat(64),
              status: 'healthy',
              updated_at: '2026-07-24T13:00:00.000Z',
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

describe('multi-window compact fast-lane commit', () => {
  it('commits multiple bounded history rows with one coalesced current projection', async () => {
    const state = fakeDatabase()
    await commitFastLaneCompactShadowWindows({
      db: state.db,
      plan: plan(),
      historyWindows: [
        { historyBundle: history(101, 101, 'C'.repeat(64)), encodedHistoryBundle: 'gzip-base64-v1:first' },
        { historyBundle: history(102, 102, 'D'.repeat(64)), encodedHistoryBundle: 'gzip-base64-v1:second' },
      ],
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'B'.repeat(64),
      processedAt: '2026-07-24T13:00:00.000Z',
    })

    const sql = state.batches[0]?.map((index) => state.prepared[index]?.sql ?? '') ?? []
    expect(sql.filter((item) => item.includes('INSERT INTO fast_lane_history_windows'))).toHaveLength(2)
    expect(sql.filter((item) => item.includes('INSERT INTO fast_lane_shadow_objects_compact'))).toHaveLength(1)
    expect(sql.filter((item) => item.includes('UPDATE fast_lane_shadow_state'))).toHaveLength(1)
  })

  it('rejects a gap between history partitions before persistence', async () => {
    const state = fakeDatabase()
    await expect(commitFastLaneCompactShadowWindows({
      db: state.db,
      plan: plan(),
      historyWindows: [
        { historyBundle: history(101, 101, 'C'.repeat(64)), encodedHistoryBundle: 'gzip-base64-v1:first' },
        { historyBundle: history(103, 103, 'D'.repeat(64)), encodedHistoryBundle: 'gzip-base64-v1:second' },
      ],
      expectedPreviousLedger: 100,
      expectedPreviousHash: 'B'.repeat(64),
      processedAt: '2026-07-24T13:00:00.000Z',
    })).rejects.toThrow('not contiguous')
    expect(state.batches).toHaveLength(0)
  })
})
