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
  const batches: number[][] = []

  const db = {
    prepare(sql: string) {
      const statementIndex = prepared.length
      const record: RecordedStatement = { sql, values: [], runCount: 0 }
      prepared.push(record)
      const statement = {
        __statementIndex: statementIndex,
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
    async batch(statements: Array<{ __statementIndex?: number }>) {
      batches.push(statements.map((statement) => statement.__statementIndex ?? -1))
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
  objectPrefix: 'snapshots/snapshot-1/',
  startedAt: '2026-07-01T00:00:00.000Z',
}

const metrics = {
  pages: 25,
  requests: 25,
  decodedObjects: 51_200,
  objects: 3_402,
  elapsedMs: 6_858,
  requestedObjectsPerPage: 2_048,
  responseMode: 'binary' as const,
  byType: {
    vault: { objects: 1_760 },
    loan_broker: { objects: 1_157 },
    loan: { objects: 485 },
  },
}

describe('current-state repository lifecycle', () => {
  it('creates an R2-backed building snapshot without object rows in D1', async () => {
    const { db, prepared } = fakeDatabase()
    await beginCurrentSnapshot(db, snapshot)

    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.sql).toContain("'r2_shards'")
    expect(prepared[0]?.values).toEqual([
      snapshot.id,
      snapshot.network,
      snapshot.epochId,
      snapshot.ledgerIndex,
      snapshot.ledgerHash,
      snapshot.endpoint,
      snapshot.objectPrefix,
      snapshot.startedAt,
    ])
    expect(prepared[0]?.runCount).toBe(1)
  })

  it('activates only after the R2 manifest summary exists', async () => {
    const { db, prepared, batches } = fakeDatabase()
    await activateCurrentSnapshot({
      db,
      snapshot,
      metrics,
      manifest: {
        manifestKey: 'snapshots/snapshot-1/manifest.json',
        shardCount: 25,
        compressedBytes: 1_234_567,
        vaultCount: 1_760,
        loanBrokerCount: 1_157,
        loanCount: 485,
      },
      completedAt: '2026-07-01T00:01:00.000Z',
    })

    expect(prepared).toHaveLength(3)
    expect(prepared[0]?.sql).toContain("SET status = 'superseded'")
    expect(prepared[1]?.sql).toContain("SET status = 'active'")
    expect(prepared[1]?.sql).toContain('manifest_key')
    expect(prepared[2]?.sql).toContain('UPDATE sync_state')
    expect(batches).toEqual([[0, 1, 2]])
    expect(prepared[1]?.values).toEqual([
      'snapshots/snapshot-1/manifest.json',
      25,
      25,
      51_200,
      3_402,
      1_760,
      1_157,
      485,
      25,
      1_234_567,
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
