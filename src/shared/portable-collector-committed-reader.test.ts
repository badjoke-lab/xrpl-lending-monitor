import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PortableCollectorCommittedReader,
  PortableCommittedReaderError,
} from './portable-collector-committed-reader'
import type {
  PortableReferenceRow,
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  createSqlitePortableCollectorAdapters,
  SqlitePortableCollectorStorageAdapter,
} from './portable-collector-sqlite-adapters'

class NodeSqliteCommittedReaderDatabase implements PortableSqliteDatabase {
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

const openDatabases: DatabaseSync[] = []
const t0 = '2026-08-01T15:00:00.000Z'
const hash100 = 'A'.repeat(64)
const hash101 = 'B'.repeat(64)
const hash102 = 'C'.repeat(64)
const hash103 = 'D'.repeat(64)

function transactionHash(value: number): string {
  return value.toString(16).toUpperCase().padStart(64, '0')
}

function createDatabase() {
  const database = new DatabaseSync(':memory:')
  openDatabases.push(database)
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    'migrations/10004_portable_collector_work.sql',
    'migrations/10005_portable_scheduler.sql',
    'migrations/10006_portable_reference_identity.sql',
  ]) {
    database.exec(readFileSync(resolve(process.cwd(), migration), 'utf8'))
  }
  const db = new NodeSqliteCommittedReaderDatabase(database)
  const adapters = createSqlitePortableCollectorAdapters(db)
  return { database, db, ...adapters }
}

function row(input: {
  workId: string
  semanticClass: PortableReferenceRow['semanticClass']
  canonicalKey: string
  ledgerIndex: number
  ledgerHash: string
  transactionIndex?: number
  objectId?: string | null
  relationships?: string[]
  tombstone?: boolean
  valueJson?: string | null
  createdAt: string
}): PortableReferenceRow {
  return {
    workId: input.workId,
    semanticClass: input.semanticClass,
    canonicalKey: input.canonicalKey,
    sourceLedgerIndex: input.ledgerIndex,
    sourceLedgerHash: input.ledgerHash,
    sourceTransactionHash:
      input.transactionIndex === undefined
        ? null
        : transactionHash(input.transactionIndex),
    objectId: input.objectId ?? null,
    relationshipIds: input.relationships ?? [],
    valueJson: input.valueJson ?? null,
    isTombstone: input.tombstone ?? false,
    createdAt: input.createdAt,
  }
}

function commitWork(options: {
  storage: SqlitePortableCollectorStorageAdapter
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  endLedgerIndex: number
  finalLedgerHash: string
  rows: PortableReferenceRow[]
  timestamp: string
}) {
  options.storage.beginWork({
    workId: options.workId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
    plannedEndLedgerIndex: options.endLedgerIndex,
    planJson: `{"workId":"${options.workId}"}`,
    createdAt: options.timestamp,
  })
  options.storage.stagePayloadChunk({
    workId: options.workId,
    chunkIndex: 0,
    encoding: 'fixture-json-v1',
    payload: new TextEncoder().encode(`{"workId":"${options.workId}"}`),
    payloadDigest: `payload:${options.workId}`,
    recordCount: options.rows.length,
    createdAt: options.timestamp,
  })
  for (const candidate of options.rows) options.storage.stageReferenceRow(candidate)
  options.storage.sealScan({
    workId: options.workId,
    scannedEndLedgerIndex: options.endLedgerIndex,
    finalLedgerHash: options.finalLedgerHash,
    semanticCountsJson: `{"totalRecords":${options.rows.length}}`,
    payloadDigest: `work:${options.workId}`,
    expectedPayloadChunks: 1,
    expectedCommitChunks: 1,
    updatedAt: options.timestamp,
  })
  options.storage.completeCommitChunk({
    workId: options.workId,
    chunkIndex: 0,
    operationCount: options.rows.length,
    rowMutationCount: options.rows.length,
    chunkDigest: `chunk:${options.workId}`,
    completedAt: options.timestamp,
  })
  return options.storage.finalizeWork({
    workId: options.workId,
    committedAt: options.timestamp,
  })
}

function seedTwoWorks(storage: SqlitePortableCollectorStorageAdapter) {
  commitWork({
    storage,
    workId: 'work-101',
    previousLedgerIndex: 100,
    expectedParentHash: hash100,
    endLedgerIndex: 101,
    finalLedgerHash: hash101,
    timestamp: `${t0.slice(0, 16)}:01.000Z`,
    rows: [
      row({
        workId: 'work-101',
        semanticClass: 'protocol-event',
        canonicalKey: 'event:shared',
        ledgerIndex: 101,
        ledgerHash: hash101,
        transactionIndex: 1,
        relationships: ['loan:1'],
        valueJson: '{"version":1}',
        createdAt: `${t0.slice(0, 16)}:01.000Z`,
      }),
      row({
        workId: 'work-101',
        semanticClass: 'protocol-event',
        canonicalKey: 'event:old-only',
        ledgerIndex: 101,
        ledgerHash: hash101,
        transactionIndex: 2,
        relationships: ['loan:1', 'vault:1'],
        valueJson: '{"old":true}',
        createdAt: `${t0.slice(0, 16)}:01.000Z`,
      }),
      row({
        workId: 'work-101',
        semanticClass: 'validated-ledger',
        canonicalKey: 'ledger:101',
        ledgerIndex: 101,
        ledgerHash: hash101,
        valueJson: `{"ledgerHash":"${hash101}"}`,
        createdAt: `${t0.slice(0, 16)}:01.000Z`,
      }),
    ],
  })

  commitWork({
    storage,
    workId: 'work-102',
    previousLedgerIndex: 101,
    expectedParentHash: hash101,
    endLedgerIndex: 102,
    finalLedgerHash: hash102,
    timestamp: `${t0.slice(0, 16)}:02.000Z`,
    rows: [
      row({
        workId: 'work-102',
        semanticClass: 'protocol-event',
        canonicalKey: 'event:shared',
        ledgerIndex: 102,
        ledgerHash: hash102,
        transactionIndex: 3,
        relationships: ['loan:1', 'broker:1'],
        valueJson: '{"version":2}',
        createdAt: `${t0.slice(0, 16)}:02.000Z`,
      }),
      row({
        workId: 'work-102',
        semanticClass: 'object-change',
        canonicalKey: 'change:102',
        ledgerIndex: 102,
        ledgerHash: hash102,
        transactionIndex: 4,
        objectId: 'loan:1',
        relationships: ['loan:1'],
        valueJson: '{"changed":true}',
        createdAt: `${t0.slice(0, 16)}:02.000Z`,
      }),
      row({
        workId: 'work-102',
        semanticClass: 'current-projection',
        canonicalKey: 'projection:deleted',
        ledgerIndex: 102,
        ledgerHash: hash102,
        transactionIndex: 5,
        objectId: 'loan:2',
        relationships: ['loan:2'],
        tombstone: true,
        valueJson: null,
        createdAt: `${t0.slice(0, 16)}:02.000Z`,
      }),
    ],
  })
}

function reader(storage: SqlitePortableCollectorStorageAdapter, sourceId = 'sqlite-reference') {
  return new PortableCollectorCommittedReader(storage, {
    sourceId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
  })
}

describe('R3B portable committed reader', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('fails unavailable before a committed watermark exists', () => {
    const state = createDatabase()
    expect(() => reader(state.storage).getFence()).toThrowError(
      expect.objectContaining({ code: 'unavailable' }),
    )
  })

  it('returns the latest exact committed row at one immutable fence', () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    const result = reader(state.storage).exact({
      semanticClass: 'protocol-event',
      canonicalKey: 'event:shared',
    })

    expect(result.source).toEqual({
      schemaVersion: 1,
      sourceId: 'sqlite-reference',
      mode: 'portable',
    })
    expect(result.fence).toMatchObject({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      ledgerIndex: 102,
      ledgerHash: hash102,
      workId: 'work-102',
    })
    expect(result.row).toMatchObject({
      workId: 'work-102',
      canonicalKey: 'event:shared',
      sourceLedgerIndex: 102,
      sourceTransactionHash: transactionHash(3),
      relationshipIds: ['broker:1', 'loan:1'],
      valueJson: '{"version":2}',
    })
  })

  it('paginates semantic rows deterministically with a fence-bound cursor', async () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    const committed = reader(state.storage)

    const first = await committed.listBySemanticClass({
      semanticClass: 'protocol-event',
      order: 'asc',
      limit: 2,
    })
    expect(first.rows.map((candidate) => `${candidate.sourceLedgerIndex}:${candidate.canonicalKey}`)).toEqual([
      '101:event:old-only',
      '101:event:shared',
    ])
    expect(first.nextCursor).not.toBeNull()

    const second = await committed.listBySemanticClass({
      semanticClass: 'protocol-event',
      order: 'asc',
      limit: 2,
      cursor: first.nextCursor!,
    })
    expect(second.rows.map((candidate) => `${candidate.sourceLedgerIndex}:${candidate.canonicalKey}`)).toEqual([
      '102:event:shared',
    ])
    expect(second.nextCursor).toBeNull()
    expect(second.fence).toEqual(first.fence)
  })

  it('supports ledger-range, relationship, and tombstone reads without source mixing', async () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    const committed = reader(state.storage)

    const range = await committed.listByLedgerRange({
      startLedgerIndex: 102,
      endLedgerIndex: 102,
      order: 'asc',
    })
    expect(new Set(range.rows.map((candidate) => candidate.semanticClass))).toEqual(
      new Set(['protocol-event', 'object-change', 'current-projection']),
    )
    expect(range.rows.every((candidate) => candidate.workId === 'work-102')).toBe(true)

    const related = await committed.listByRelationship({
      relationshipId: 'loan:1',
      order: 'asc',
    })
    expect(related.rows.map((candidate) => candidate.canonicalKey)).toEqual([
      'event:old-only',
      'event:shared',
      'change:102',
      'event:shared',
    ])

    const tombstone = committed.exact({
      semanticClass: 'current-projection',
      canonicalKey: 'projection:deleted',
    })
    expect(tombstone.row).toMatchObject({
      isTombstone: true,
      valueJson: null,
      objectId: 'loan:2',
    })
  })

  it('rejects tampered, source-mismatched, query-mismatched, and stale cursors', async () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    const committed = reader(state.storage)
    const first = await committed.listBySemanticClass({
      semanticClass: 'protocol-event',
      limit: 1,
    })
    expect(first.nextCursor).not.toBeNull()
    const cursor = first.nextCursor!

    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('0') ? '1' : '0'}`
    await expect(
      committed.listBySemanticClass({
        semanticClass: 'protocol-event',
        limit: 1,
        cursor: tampered,
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' })

    await expect(
      reader(state.storage, 'another-source').listBySemanticClass({
        semanticClass: 'protocol-event',
        limit: 1,
        cursor,
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' })

    await expect(
      committed.listByRelationship({
        relationshipId: 'loan:1',
        limit: 1,
        cursor,
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' })

    commitWork({
      storage: state.storage,
      workId: 'work-103',
      previousLedgerIndex: 102,
      expectedParentHash: hash102,
      endLedgerIndex: 103,
      finalLedgerHash: hash103,
      timestamp: `${t0.slice(0, 16)}:03.000Z`,
      rows: [
        row({
          workId: 'work-103',
          semanticClass: 'protocol-event',
          canonicalKey: 'event:103',
          ledgerIndex: 103,
          ledgerHash: hash103,
          transactionIndex: 6,
          relationships: ['loan:3'],
          valueJson: '{"new":true}',
          createdAt: `${t0.slice(0, 16)}:03.000Z`,
        }),
      ],
    })

    await expect(
      committed.listBySemanticClass({
        semanticClass: 'protocol-event',
        limit: 1,
        cursor,
      }),
    ).rejects.toMatchObject({ code: 'stale_cursor' })
  })

  it('never exposes staged rows and fails closed on malformed committed identity', async () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    state.storage.beginWork({
      workId: 'work-103-staged',
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      previousLedgerIndex: 102,
      expectedParentHash: hash102,
      plannedEndLedgerIndex: 103,
      planJson: '{"staged":true}',
      createdAt: `${t0.slice(0, 16)}:04.000Z`,
    })
    state.storage.stageReferenceRow(
      row({
        workId: 'work-103-staged',
        semanticClass: 'protocol-event',
        canonicalKey: 'event:hidden',
        ledgerIndex: 103,
        ledgerHash: hash103,
        transactionIndex: 7,
        createdAt: `${t0.slice(0, 16)}:04.000Z`,
      }),
    )

    const page = await reader(state.storage).listBySemanticClass({
      semanticClass: 'protocol-event',
    })
    expect(page.rows.some((candidate) => candidate.canonicalKey === 'event:hidden')).toBe(false)

    state.db.run(
      `UPDATE collector_reference_rows
       SET relationship_ids_json = ?
       WHERE work_id = ? AND canonical_key = ?`,
      ['["z","a"]', 'work-102', 'event:shared'],
    )
    await expect(
      reader(state.storage).listBySemanticClass({
        semanticClass: 'protocol-event',
      }),
    ).rejects.toBeInstanceOf(PortableCommittedReaderError)
    await expect(
      reader(state.storage).listBySemanticClass({
        semanticClass: 'protocol-event',
      }),
    ).rejects.toMatchObject({ code: 'integrity_failure' })
  })

  it('rejects invalid query bounds, classes, limits, and orders', async () => {
    const state = createDatabase()
    seedTwoWorks(state.storage)
    const committed = reader(state.storage)

    expect(() =>
      committed.exact({
        semanticClass: 'unknown' as never,
        canonicalKey: 'event:shared',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_query' }))

    await expect(
      committed.listByLedgerRange({
        startLedgerIndex: 102,
        endLedgerIndex: 101,
      }),
    ).rejects.toMatchObject({ code: 'invalid_query' })

    await expect(
      committed.listBySemanticClass({
        semanticClass: 'protocol-event',
        limit: 101,
      }),
    ).rejects.toMatchObject({ code: 'invalid_query' })
  })
})
