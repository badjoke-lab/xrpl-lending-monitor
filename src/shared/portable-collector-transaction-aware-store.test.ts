import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'

class NodeSqliteReferenceDatabase implements PortableSqliteDatabase {
  constructor(readonly database: DatabaseSync) {}

  run(sql: string, parameters: readonly PortableSqliteValue[] = []) {
    const result = this.database.prepare(sql).run(...parameters)
    return { changes: Number(result.changes) }
  }

  get<T>(sql: string, parameters: readonly PortableSqliteValue[] = []): T | undefined {
    return this.database.prepare(sql).get(...parameters) as T | undefined
  }

  all<T>(sql: string, parameters: readonly PortableSqliteValue[] = []): T[] {
    return this.database.prepare(sql).all(...parameters) as T[]
  }

  transaction<T>(operation: () => T): T {
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      this.database.exec('COMMIT')
      return result
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }
}

const migration = readFileSync(
  resolve(process.cwd(), 'migrations/10004_portable_collector_work.sql'),
  'utf8',
)
const createdAt = '2026-08-01T09:00:00.000Z'
const parentHash = 'A'.repeat(64)
const finalHash = 'B'.repeat(64)

function createReferenceDatabase(): {
  database: DatabaseSync
  adapter: NodeSqliteReferenceDatabase
  store: PortableCollectorReferenceStore
} {
  const database = new DatabaseSync(':memory:')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec(migration)
  const adapter = new NodeSqliteReferenceDatabase(database)
  return {
    database,
    adapter,
    store: new PortableCollectorReferenceStore(adapter),
  }
}

function stageCompleteWork(store: PortableCollectorReferenceStore): void {
  store.beginWork({
    workId: 'work-101-102',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: parentHash,
    plannedEndLedgerIndex: 102,
    planJson: '{"range":[101,102],"schemaVersion":1}',
    createdAt,
  })
  store.stagePayloadChunk({
    workId: 'work-101-102',
    chunkIndex: 0,
    encoding: 'json-v1',
    payload: new TextEncoder().encode('{"records":1}'),
    payloadDigest: 'payload-digest-1',
    recordCount: 1,
    createdAt,
  })
  store.stageReferenceRow({
    workId: 'work-101-102',
    semanticClass: 'current-projection',
    canonicalKey: 'Vault:rVault',
    sourceLedgerIndex: 102,
    sourceLedgerHash: finalHash,
    valueJson: '{"id":"rVault"}',
    isTombstone: false,
    createdAt,
  })
  store.sealScan({
    workId: 'work-101-102',
    scannedEndLedgerIndex: 102,
    finalLedgerHash: finalHash,
    semanticCountsJson: '{"currentProjectionMutations":1,"totalRecords":1}',
    payloadDigest: 'work-payload-digest',
    expectedPayloadChunks: 1,
    expectedCommitChunks: 1,
    updatedAt: '2026-08-01T09:01:00.000Z',
  })
  store.completeCommitChunk({
    workId: 'work-101-102',
    chunkIndex: 0,
    operationCount: 2,
    rowMutationCount: 1,
    chunkDigest: 'commit-digest-0',
    completedAt: '2026-08-01T09:02:00.000Z',
  })
}

describe('portable collector transaction-aware store', () => {
  let database: DatabaseSync
  let adapter: NodeSqliteReferenceDatabase
  let store: PortableCollectorReferenceStore

  beforeEach(() => {
    const reference = createReferenceDatabase()
    database = reference.database
    adapter = reference.adapter
    store = reference.store
    stageCompleteWork(store)
  })

  afterEach(() => {
    database.close()
  })

  it('returns exact typed work, payload, commit, candidate, and watermark snapshots', () => {
    expect(store.getWork('work-101-102')).toMatchObject({
      workId: 'work-101-102',
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      previousLedgerIndex: 100,
      startLedgerIndex: 101,
      expectedParentHash: parentHash,
      plannedEndLedgerIndex: 102,
      scannedEndLedgerIndex: 102,
      finalLedgerHash: finalHash,
      status: 'committing',
      expectedPayloadChunks: 1,
      expectedCommitChunks: 1,
    })

    const payload = store.getPayloadChunk('work-101-102', 0)
    expect(payload).toMatchObject({
      workId: 'work-101-102',
      chunkIndex: 0,
      encoding: 'json-v1',
      payloadDigest: 'payload-digest-1',
      byteCount: 13,
      recordCount: 1,
      createdAt,
    })
    expect(new TextDecoder().decode(payload?.payload)).toBe('{"records":1}')
    expect(store.listPayloadChunks('work-101-102')).toEqual([payload])

    expect(store.listCommitChunks('work-101-102')).toEqual([
      {
        workId: 'work-101-102',
        chunkIndex: 0,
        status: 'completed',
        operationCount: 2,
        rowMutationCount: 1,
        chunkDigest: 'commit-digest-0',
        createdAt: '2026-08-01T09:02:00.000Z',
        updatedAt: '2026-08-01T09:02:00.000Z',
        completedAt: '2026-08-01T09:02:00.000Z',
      },
    ])
    expect(store.listReferenceRowsForWork('work-101-102')).toEqual([
      {
        workId: 'work-101-102',
        semanticClass: 'current-projection',
        canonicalKey: 'Vault:rVault',
        sourceLedgerIndex: 102,
        sourceLedgerHash: finalHash,
        valueJson: '{"id":"rVault"}',
        isTombstone: false,
        createdAt,
      },
    ])
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
  })

  it('finalizes inside a caller-owned transaction without opening a nested transaction', () => {
    const watermark = adapter.transaction(() =>
      store.finalizeWorkInTransaction({
        workId: 'work-101-102',
        committedAt: '2026-08-01T09:03:00.000Z',
      }),
    )

    expect(watermark).toMatchObject({
      workId: 'work-101-102',
      ledgerIndex: 102,
      ledgerHash: finalHash,
    })
    expect(store.getWork('work-101-102')?.status).toBe('committed')
    expect(store.listCommittedReferenceRows()).toHaveLength(1)
  })

  it('rolls back work visibility and watermark when the caller transaction fails', () => {
    expect(() =>
      adapter.transaction(() => {
        store.finalizeWorkInTransaction({
          workId: 'work-101-102',
          committedAt: '2026-08-01T09:03:00.000Z',
        })
        throw new Error('injected interruption after storage finalization')
      }),
    ).toThrow('injected interruption after storage finalization')

    expect(store.getWork('work-101-102')?.status).toBe('committing')
    expect(store.getWork('work-101-102')?.committedAt).toBeNull()
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(store.listCommittedReferenceRows()).toEqual([])
    expect(store.listReferenceRowsForWork('work-101-102')).toHaveLength(1)
  })
})