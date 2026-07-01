import { describe, expect, it } from 'vitest'

import {
  activateCurrentSnapshot,
  beginCurrentSnapshot,
  failCurrentSnapshot,
  type CurrentSnapshotIdentity,
} from './current-state-repository'

interface RecordedStatement {
  sql: string
  values: unknown[]
  runCount: number
}

function fakeDatabase() {
  const prepared: RecordedStatement[] = []
  const batches: RecordedStatement[][] = []

  const db = {
    prepare(sql: string) {
      const record: RecordedStatement = { sql, values: [], runCount: 0 }
      prepared.push(record)
      const statement = {
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async run() {
          record.runCount += 1
          return { success: true }
        },
      }
      return statement
    },
    async batch(statements: unknown[]) {
      const records = statements.map((statement) => {
        const match = prepared.find((record) => {
          const candidate = statement as { bind?: unknown; run?: unknown }
          return candidate && record.runCount === 0
        })
        return match ?? prepared[prepared.length - 1]!
      })
      batches.push(records)
      return []
    },
  }

  return { db: db as unknown as D1Database, prepared, batches }
}

const snapshot: CurrentSnapshotIdentity = {
  id: 'snapshot-1',
  network: 'devnet',
  epochId: 'epoch-1',
  ledgerIndex: 123,
  ledgerHash: 'A'.repeat(64),
  endpoint: 'https://devnet.example/',
  startedAt: '2026-07-01T00:00:00.000Z',
}

describe('current-state repository lifecycle', () => {
  it('creates a building snapshot before any current rows are activated', async () => {
    const { db, prepared } = fakeDatabase()
    await beginCurrentSnapshot(db, snapshot)

    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.sql).toContain("VALUES (?1, ?2, ?3, 'building'")
    expect(prepared[0]?.values).toEqual([
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      snapshot.ledgerIndex,
      snapshot.ledgerHash,
      snapshot.endpoint,
      snapshot.startedAt,
    ])
    expect(prepared[0]?.runCount).toBe(1)
  })

  it('supersedes, activates, and advances the cursor in one ordered batch', async () => {
    const { db, prepared, batches } = fakeDatabase()
    await activateCurrentSnapshot({
      db,
      snapshot,
      metrics: {
        pages: 25,
        requests: 25,
        decodedObjects: 51_200,
        objects: 3_402,
        elapsedMs: 6_858,
        requestedObjectsPerPage: 2_048,
        responseMode: 'binary',
        byType: {
          vault: { objects: 1_760 },
          loan_broker: { objects: 1_157 },
          loan: { objects: 485 },
        },
      },
      completedAt: '2026-07-01T00:01:00.000Z',
    })

    expect(prepared).toHaveLength(3)
    expect(prepared[0]?.sql).toContain("SET status = 'superseded'")
    expect(prepared[1]?.sql).toContain("SET status = 'active'")
    expect(prepared[2]?.sql).toContain('UPDATE sync_state')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(3)
    expect(prepared[1]?.values).toEqual([
      25,
      25,
      3_402,
      6_858,
      '2026-07-01T00:01:00.000Z',
      snapshot.id,
    ])
    expect(prepared[2]?.values).toEqual([
      snapshot.ledgerIndex,
      snapshot.ledgerHash,
      '2026-07-01T00:01:00.000Z',
      snapshot.network,
      snapshot.epochId,
    ])
  })

  it('marks only a building snapshot failed without touching the cursor', async () => {
    const { db, prepared, batches } = fakeDatabase()
    await failCurrentSnapshot({
      db,
      snapshotId: snapshot.id,
      failedAt: '2026-07-01T00:02:00.000Z',
      code: 'CurrentStateScanError',
      message: 'incomplete marker traversal',
    })

    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.sql).toContain("SET status = 'failed'")
    expect(prepared[0]?.sql).toContain("status = 'building'")
    expect(prepared[0]?.sql).not.toContain('sync_state')
    expect(prepared[0]?.runCount).toBe(1)
    expect(batches).toHaveLength(0)
  })
})
