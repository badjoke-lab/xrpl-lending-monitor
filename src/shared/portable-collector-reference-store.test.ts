import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import { restorePortableCollectorState } from './portable-collector-reference-restore'

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

const createdAt = '2026-08-01T07:00:00.000Z'
const parentHash = 'A'.repeat(64)
const finalHash = 'B'.repeat(64)
const migration = readFileSync(
  resolve(process.cwd(), 'migrations/10004_portable_collector_work.sql'),
  'utf8',
)

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

function definition(overrides: Partial<{
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  plannedEndLedgerIndex: number
}> = {}) {
  return {
    workId: overrides.workId ?? 'work-101-102',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: overrides.previousLedgerIndex ?? 100,
    expectedParentHash: overrides.expectedParentHash ?? parentHash,
    plannedEndLedgerIndex: overrides.plannedEndLedgerIndex ?? 102,
    planJson: JSON.stringify({ schemaVersion: 1, range: [101, 102] }),
    createdAt,
  }
}

function stageCompleteWork(
  store: PortableCollectorReferenceStore,
  work = definition(),
  options: { expectedCommitChunks?: number; completedCommitChunks?: number } = {},
): void {
  const expectedCommitChunks = options.expectedCommitChunks ?? 1
  const completedCommitChunks = options.completedCommitChunks ?? expectedCommitChunks
  store.beginWork(work)
  store.stagePayloadChunk({
    workId: work.workId,
    chunkIndex: 0,
    encoding: 'json-v1',
    payload: new TextEncoder().encode('{"records":2}'),
    payloadDigest: 'payload-digest-1',
    recordCount: 2,
    createdAt,
  })
  store.stageReferenceRow({
    workId: work.workId,
    semanticClass: 'current-projection',
    canonicalKey: 'Vault:rVault',
    sourceLedgerIndex: work.plannedEndLedgerIndex,
    sourceLedgerHash: finalHash,
    valueJson: '{"id":"rVault"}',
    isTombstone: false,
    createdAt,
  })
  store.sealScan({
    workId: work.workId,
    scannedEndLedgerIndex: work.plannedEndLedgerIndex,
    finalLedgerHash: finalHash,
    semanticCountsJson: '{"currentProjection":1}',
    payloadDigest: 'work-payload-digest',
    expectedPayloadChunks: 1,
    expectedCommitChunks,
    updatedAt: '2026-08-01T07:01:00.000Z',
  })
  for (let chunkIndex = 0; chunkIndex < completedCommitChunks; chunkIndex += 1) {
    store.completeCommitChunk({
      workId: work.workId,
      chunkIndex,
      operationCount: 4,
      rowMutationCount: 1,
      chunkDigest: `commit-digest-${chunkIndex}`,
      completedAt: `2026-08-01T07:02:0${chunkIndex}.000Z`,
    })
  }
}

describe('portable collector SQLite reference store', () => {
  let database: DatabaseSync
  let adapter: NodeSqliteReferenceDatabase
  let store: PortableCollectorReferenceStore

  beforeEach(() => {
    const reference = createReferenceDatabase()
    database = reference.database
    adapter = reference.adapter
    store = reference.store
  })

  afterEach(() => {
    database.close()
  })

  it('keeps staged rows invisible until one atomic finalization advances the watermark', () => {
    stageCompleteWork(store)

    expect(store.listCommittedReferenceRows()).toEqual([])
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()

    const watermark = store.finalizeWork({
      workId: 'work-101-102',
      committedAt: '2026-08-01T07:03:00.000Z',
    })

    expect(watermark).toEqual({
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      ledgerIndex: 102,
      ledgerHash: finalHash,
      workId: 'work-101-102',
      updatedAt: '2026-08-01T07:03:00.000Z',
    })
    expect(store.listCommittedReferenceRows()).toEqual([
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

    expect(
      store.finalizeWork({
        workId: 'work-101-102',
        committedAt: '2026-08-01T07:04:00.000Z',
      }),
    ).toEqual(watermark)
  })

  it('does not advance a cursor or expose rows when commit chunks are incomplete', () => {
    stageCompleteWork(store, definition(), {
      expectedCommitChunks: 2,
      completedCommitChunks: 1,
    })

    expect(() =>
      store.finalizeWork({
        workId: 'work-101-102',
        committedAt: '2026-08-01T07:03:00.000Z',
      }),
    ).toThrow('cannot finalize before every commit chunk is complete')
    expect(store.listCommittedReferenceRows()).toEqual([])
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
  })

  it('rejects a later work item that does not start at the committed boundary', () => {
    stageCompleteWork(store)
    store.finalizeWork({
      workId: 'work-101-102',
      committedAt: '2026-08-01T07:03:00.000Z',
    })

    const gapWork = definition({
      workId: 'work-104',
      previousLedgerIndex: 103,
      expectedParentHash: finalHash,
      plannedEndLedgerIndex: 104,
    })
    stageCompleteWork(store, gapWork)

    expect(() =>
      store.finalizeWork({
        workId: gapWork.workId,
        committedAt: '2026-08-01T07:06:00.000Z',
      }),
    ).toThrow('committed watermark does not match the work parent boundary')
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')?.ledgerIndex).toBe(102)
  })

  it('exports and restores the complete state with byte-for-byte canonical parity', () => {
    stageCompleteWork(store)
    store.finalizeWork({
      workId: 'work-101-102',
      committedAt: '2026-08-01T07:03:00.000Z',
    })

    const exportedState = store.exportState()
    const restored = createReferenceDatabase()
    try {
      restorePortableCollectorState(restored.adapter, exportedState)
      expect(restored.store.exportState()).toBe(exportedState)
      expect(restored.store.listCommittedReferenceRows()).toEqual(
        store.listCommittedReferenceRows(),
      )
      expect(restored.store.getWatermark('devnet', 'epoch-1', 'base-100')).toEqual(
        store.getWatermark('devnet', 'epoch-1', 'base-100'),
      )
    } finally {
      restored.database.close()
    }

    const parsed = JSON.parse(exportedState) as {
      schemaVersion: number
      work: Array<{ status: string }>
      payloadChunks: Array<{ payload: { encoding: string; value: string } }>
      watermarks: Array<{ ledger_index: number }>
    }
    expect(parsed.schemaVersion).toBe(1)
    expect(parsed.work).toHaveLength(1)
    expect(parsed.work[0]?.status).toBe('committed')
    expect(parsed.payloadChunks[0]?.payload.encoding).toBe('hex')
    expect(parsed.watermarks[0]?.ledger_index).toBe(102)
  })

  it('refuses to restore into a non-empty target', () => {
    stageCompleteWork(store)
    const exportedState = store.exportState()

    expect(() => restorePortableCollectorState(adapter, exportedState)).toThrow(
      'restore target is not empty',
    )
  })
})
