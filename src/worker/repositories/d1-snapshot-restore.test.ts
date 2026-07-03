import { describe, expect, it } from 'vitest'

import { restorePreviousSnapshot } from './d1-snapshot-retention'

function fakeDatabase() {
  const rows = [
    { epoch_id: 'epoch-1', snapshot_id: 'current', rollback_snapshot_id: 'previous' },
    {
      id: 'previous', network: 'devnet', epoch_id: 'epoch-1', status: 'verified',
      ledger_index: 100, ledger_hash: 'A'.repeat(64), manifest_hash: 'b'.repeat(64),
    },
  ]
  const prepared: Array<{ sql: string; values: unknown[] }> = []
  const batches: number[][] = []
  const db = {
    prepare(sql: string) {
      const index = prepared.length
      const record = { sql, values: [] as unknown[] }
      prepared.push(record)
      const statement = {
        __index: index,
        bind(...values: unknown[]) { record.values = values; return statement },
        async first<T>() { return (rows.shift() ?? null) as T | null },
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

describe('D1 snapshot restore', () => {
  it('atomically swaps active and previous pointers in one epoch', async () => {
    const { db, prepared, batches } = fakeDatabase()
    await expect(restorePreviousSnapshot({
      db,
      restoredAt: '2026-07-03T01:00:00.000Z',
    })).resolves.toEqual({ snapshotId: 'previous', rollbackSnapshotId: 'current' })

    expect(prepared[2]?.values).toEqual([
      'previous', 'current', '2026-07-03T01:00:00.000Z', 'epoch-1',
    ])
    expect(prepared[3]?.sql).toContain('UPDATE sync_state')
    expect(batches).toEqual([[2, 3]])
  })
})
