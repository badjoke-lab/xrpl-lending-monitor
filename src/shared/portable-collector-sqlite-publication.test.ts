import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PortablePublicationMaintenanceError,
  SqlitePortableCollectorPublicationMaintenanceAdapter,
} from './portable-collector-sqlite-publication'
import type {
  PortableReferenceRow,
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  createSqlitePortableCollectorAdapters,
  type SqlitePortableCollectorStorageAdapter,
} from './portable-collector-sqlite-adapters'

class NodeSqlitePublicationDatabase implements PortableSqliteDatabase {
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
const hash100 = 'A'.repeat(64)
const hash101 = 'B'.repeat(64)
const hash102 = 'C'.repeat(64)
const hash103 = 'D'.repeat(64)
const transactionHash = 'E'.repeat(64)

function createDatabase() {
  const database = new DatabaseSync(':memory:')
  openDatabases.push(database)
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    'migrations/10004_portable_collector_work.sql',
    'migrations/10005_portable_scheduler.sql',
    'migrations/10006_portable_reference_identity.sql',
    'migrations/10007_portable_publication_maintenance.sql',
  ]) {
    database.exec(readFileSync(resolve(process.cwd(), migration), 'utf8'))
  }
  const db = new NodeSqlitePublicationDatabase(database)
  const adapters = createSqlitePortableCollectorAdapters(db)
  return { database, db, ...adapters }
}

function referenceRow(options: {
  workId: string
  ledgerIndex: number
  ledgerHash: string
  createdAt: string
}): PortableReferenceRow {
  return {
    workId: options.workId,
    semanticClass: 'protocol-event',
    canonicalKey: `event:${options.ledgerIndex}`,
    sourceLedgerIndex: options.ledgerIndex,
    sourceLedgerHash: options.ledgerHash,
    sourceTransactionHash: transactionHash,
    objectId: null,
    relationshipIds: [`ledger:${options.ledgerIndex}`],
    valueJson: `{"ledgerIndex":${options.ledgerIndex}}`,
    isTombstone: false,
    createdAt: options.createdAt,
  }
}

function commitWork(options: {
  storage: SqlitePortableCollectorStorageAdapter
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  endLedgerIndex: number
  finalLedgerHash: string
  timestamp: string
}) {
  const row = referenceRow({
    workId: options.workId,
    ledgerIndex: options.endLedgerIndex,
    ledgerHash: options.finalLedgerHash,
    createdAt: options.timestamp,
  })
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
    payloadDigest: `payload-chunk:${options.workId}`,
    recordCount: 1,
    createdAt: options.timestamp,
  })
  options.storage.stageReferenceRow(row)
  options.storage.sealScan({
    workId: options.workId,
    scannedEndLedgerIndex: options.endLedgerIndex,
    finalLedgerHash: options.finalLedgerHash,
    semanticCountsJson: '{"totalRecords":1}',
    payloadDigest: `payload:${options.workId}`,
    expectedPayloadChunks: 1,
    expectedCommitChunks: 1,
    updatedAt: options.timestamp,
  })
  options.storage.completeCommitChunk({
    workId: options.workId,
    chunkIndex: 0,
    operationCount: 1,
    rowMutationCount: 1,
    chunkDigest: `commit:${options.workId}`,
    completedAt: options.timestamp,
  })
  return options.storage.finalizeWork({
    workId: options.workId,
    committedAt: options.timestamp,
  })
}

function seedThreeWorks(storage: SqlitePortableCollectorStorageAdapter) {
  commitWork({
    storage,
    workId: 'work-101',
    previousLedgerIndex: 100,
    expectedParentHash: hash100,
    endLedgerIndex: 101,
    finalLedgerHash: hash101,
    timestamp: '2026-08-01T17:00:01.000Z',
  })
  commitWork({
    storage,
    workId: 'work-102',
    previousLedgerIndex: 101,
    expectedParentHash: hash101,
    endLedgerIndex: 102,
    finalLedgerHash: hash102,
    timestamp: '2026-08-01T17:00:02.000Z',
  })
  commitWork({
    storage,
    workId: 'work-103',
    previousLedgerIndex: 102,
    expectedParentHash: hash102,
    endLedgerIndex: 103,
    finalLedgerHash: hash103,
    timestamp: '2026-08-01T17:00:03.000Z',
  })
}

function publicationAdapter(options: {
  db: NodeSqlitePublicationDatabase
  storage: SqlitePortableCollectorStorageAdapter
  now?: () => string
}) {
  return new SqlitePortableCollectorPublicationMaintenanceAdapter(
    options.db,
    options.storage,
    {
      streamId: 'devnet:epoch-1:base-100',
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      initialPreviousLedgerIndex: 100,
      initialExpectedParentHash: hash100,
      now: options.now ?? (() => '2026-08-01T17:10:00.000Z'),
    },
  )
}

describe('R3D SQLite publication and maintenance', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('builds, reopens, verifies, and advances a contiguous publication independently', async () => {
    const state = createDatabase()
    seedThreeWorks(state.storage)
    const collectionBefore = state.storage.getWatermark('devnet', 'epoch-1', 'base-100')
    const publication = publicationAdapter(state)

    const selected = publication.selectCommittedAfter({
      publicationWatermarkWorkId: null,
      limit: 2,
    })
    expect(selected.map((work) => work.workId)).toEqual(['work-101', 'work-102'])

    const candidate = await publication.buildCandidate(selected)
    expect(candidate.publicationId).toBe(`publication:v1:${candidate.manifestDigest}`)
    expect(candidate.previousPublicationId).toBeNull()
    expect(candidate.works).toEqual(selected)
    expect(publication.getCandidate(candidate.publicationId)).toEqual(candidate)
    expect(publication.getPublicationWatermark()).toBeUndefined()
    expect(state.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toEqual(
      collectionBefore,
    )

    const duplicate = await publication.buildCandidate(selected)
    expect(duplicate).toEqual(candidate)

    const verified = await publication.verifyCandidate(candidate)
    expect(verified).toMatchObject({
      publicationId: candidate.publicationId,
      verifiedAt: '2026-08-01T17:10:00.000Z',
    })
    expect(publication.getPublicationWatermark()).toBeUndefined()

    const watermark = publication.advancePublicationWatermark(verified)
    expect(watermark).toMatchObject({
      streamId: 'devnet:epoch-1:base-100',
      publicationId: candidate.publicationId,
      workId: 'work-102',
      ledgerIndex: 102,
      ledgerHash: hash102,
    })
    expect(state.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toEqual(
      collectionBefore,
    )
    expect(publication.advancePublicationWatermark(verified)).toEqual(watermark)
  })

  it('rejects a tampered candidate before publication watermark advancement', async () => {
    const state = createDatabase()
    seedThreeWorks(state.storage)
    const publication = publicationAdapter(state)
    const selected = publication.selectCommittedAfter({
      publicationWatermarkWorkId: null,
      limit: 1,
    })
    const candidate = await publication.buildCandidate(selected)

    state.db.run(
      `UPDATE collector_publication_candidates
       SET asset_json = ?
       WHERE publication_id = ?`,
      ['{"schemaVersion":1,"works":[]}', candidate.publicationId],
    )

    await expect(publication.verifyCandidate(candidate)).rejects.toBeInstanceOf(
      PortablePublicationMaintenanceError,
    )
    await expect(publication.verifyCandidate(candidate)).rejects.toMatchObject({
      code: 'identity_conflict',
    })
    expect(publication.getPublicationWatermark()).toBeUndefined()
  })

  it('enforces publication chaining from the stored publication watermark', async () => {
    const state = createDatabase()
    seedThreeWorks(state.storage)
    let clock = 0
    const publication = publicationAdapter({
      ...state,
      now: () => `2026-08-01T17:1${clock++}:00.000Z`,
    })

    const firstWorks = publication.selectCommittedAfter({
      publicationWatermarkWorkId: null,
      limit: 2,
    })
    const first = await publication.verifyCandidate(
      await publication.buildCandidate(firstWorks),
    )
    publication.advancePublicationWatermark(first)

    expect(() =>
      publication.selectCommittedAfter({
        publicationWatermarkWorkId: null,
        limit: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'watermark_conflict' }))

    const secondWorks = publication.selectCommittedAfter({
      publicationWatermarkWorkId: 'work-102',
      limit: 10,
    })
    expect(secondWorks.map((work) => work.workId)).toEqual(['work-103'])
    const second = await publication.verifyCandidate(
      await publication.buildCandidate(secondWorks),
    )
    expect(second.previousPublicationId).toBe(first.publicationId)
    const watermark = publication.advancePublicationWatermark(second)
    expect(watermark).toMatchObject({
      publicationId: second.publicationId,
      workId: 'work-103',
      ledgerIndex: 103,
      ledgerHash: hash103,
    })
  })

  it('authorizes only bounded old chunk compaction after verified publication watermark', async () => {
    const state = createDatabase()
    seedThreeWorks(state.storage)
    const collectionBefore = state.storage.getWatermark('devnet', 'epoch-1', 'base-100')
    let clock = 0
    const publication = publicationAdapter({
      ...state,
      now: () => `2026-08-01T17:2${clock++}:00.000Z`,
    })

    const works = publication.selectCommittedAfter({
      publicationWatermarkWorkId: null,
      limit: 10,
    })
    const verified = await publication.verifyCandidate(
      await publication.buildCandidate(works),
    )

    await expect(
      publication.buildPlan({
        verifiedPublication: verified,
        retainCommittedWorks: 1,
        maxMutations: 3,
      }),
    ).rejects.toMatchObject({ code: 'watermark_conflict' })

    publication.advancePublicationWatermark(verified)
    const plan = await publication.buildPlan({
      verifiedPublication: verified,
      retainCommittedWorks: 1,
      maxMutations: 3,
    })
    expect(plan.planId).toBe(`maintenance:v1:${plan.planDigest}`)
    expect(plan.mutations).toEqual([
      {
        table: 'collector_payload_chunks',
        workId: 'work-101',
        reason: 'verified_publication_retention',
      },
      {
        table: 'collector_commit_chunks',
        workId: 'work-101',
        reason: 'verified_publication_retention',
      },
      {
        table: 'collector_payload_chunks',
        workId: 'work-102',
        reason: 'verified_publication_retention',
      },
    ])
    expect(publication.getPlan(plan.planId)).toEqual(plan)

    const applied = publication.applyPlan(plan)
    expect(applied).toEqual({ appliedMutations: 3 })
    expect(publication.applyPlan(plan)).toEqual({ appliedMutations: 0 })

    expect(state.storage.listPayloadChunks('work-101')).toEqual([])
    expect(state.storage.listCommitChunks('work-101')).toEqual([])
    expect(state.storage.listPayloadChunks('work-102')).toEqual([])
    expect(state.storage.listCommitChunks('work-102')).toHaveLength(1)
    expect(state.storage.listPayloadChunks('work-103')).toHaveLength(1)
    expect(state.storage.listCommitChunks('work-103')).toHaveLength(1)

    expect(state.storage.getWork('work-101')?.status).toBe('committed')
    expect(state.storage.listReferenceRowsForWork('work-101')).toHaveLength(1)
    expect(state.storage.listCommittedReferenceRows()).toHaveLength(3)
    expect(state.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toEqual(
      collectionBefore,
    )
    expect(publication.getPublicationWatermark()).toMatchObject({
      publicationId: verified.publicationId,
      ledgerIndex: 103,
    })
  })

  it('rejects changed publication and maintenance identities', async () => {
    const state = createDatabase()
    seedThreeWorks(state.storage)
    const publication = publicationAdapter(state)
    const selected = publication.selectCommittedAfter({
      publicationWatermarkWorkId: null,
      limit: 1,
    })
    const candidate = await publication.buildCandidate(selected)

    await expect(
      publication.verifyCandidate({
        ...candidate,
        manifestDigest: '0'.repeat(64),
      }),
    ).rejects.toMatchObject({ code: 'identity_conflict' })

    const verified = await publication.verifyCandidate(candidate)
    publication.advancePublicationWatermark(verified)
    const plan = await publication.buildPlan({
      verifiedPublication: verified,
      retainCommittedWorks: 0,
      maxMutations: 2,
    })
    expect(() =>
      publication.applyPlan({
        ...plan,
        planDigest: '0'.repeat(64),
      }),
    ).toThrowError(expect.objectContaining({ code: 'identity_conflict' }))
  })
})
