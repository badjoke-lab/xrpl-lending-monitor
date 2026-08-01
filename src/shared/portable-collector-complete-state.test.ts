import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  PortableCollectorCompleteStateError,
  SqlitePortableCollectorCompleteStateTransferAdapter,
} from './portable-collector-complete-state'
import { PortableCollectorCommittedReader } from './portable-collector-committed-reader'
import { buildScanPhaseMessage } from './portable-collector-messages'
import type {
  PortableReferenceRow,
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  createSqlitePortableCollectorAdapters,
  type SqlitePortableCollectorStorageAdapter,
} from './portable-collector-sqlite-adapters'
import {
  SqlitePortableCollectorPublicationMaintenanceAdapter,
  type SqlitePortablePublicationOptions,
} from './portable-collector-sqlite-publication'

class NodeSqliteCompleteStateDatabase implements PortableSqliteDatabase {
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
const hash104 = 'E'.repeat(64)
const transactionHash = 'F'.repeat(64)

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
  const db = new NodeSqliteCompleteStateDatabase(database)
  return { database, db, ...createSqlitePortableCollectorAdapters(db) }
}

function clock(start = '2026-08-01T18:00:00.000Z'): () => string {
  let offset = 0
  const base = new Date(start).getTime()
  return () => new Date(base + offset++ * 1_000).toISOString()
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

function stageWork(options: {
  storage: SqlitePortableCollectorStorageAdapter
  workId: string
  previousLedgerIndex: number
  expectedParentHash: string
  endLedgerIndex: number
  finalLedgerHash: string
  timestamp: string
  completeCommit?: boolean
}) {
  const candidate = referenceRow({
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
  options.storage.stageReferenceRow(candidate)
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
  if (options.completeCommit) {
    options.storage.completeCommitChunk({
      workId: options.workId,
      chunkIndex: 0,
      operationCount: 1,
      rowMutationCount: 1,
      chunkDigest: `commit:${options.workId}`,
      completedAt: options.timestamp,
    })
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
  stageWork({ ...options, completeCommit: true })
  return options.storage.finalizeWork({
    workId: options.workId,
    committedAt: options.timestamp,
  })
}

function seedCommittedWorks(storage: SqlitePortableCollectorStorageAdapter) {
  commitWork({
    storage,
    workId: 'work-101',
    previousLedgerIndex: 100,
    expectedParentHash: hash100,
    endLedgerIndex: 101,
    finalLedgerHash: hash101,
    timestamp: '2026-08-01T18:00:01.000Z',
  })
  commitWork({
    storage,
    workId: 'work-102',
    previousLedgerIndex: 101,
    expectedParentHash: hash101,
    endLedgerIndex: 102,
    finalLedgerHash: hash102,
    timestamp: '2026-08-01T18:00:02.000Z',
  })
  commitWork({
    storage,
    workId: 'work-103',
    previousLedgerIndex: 102,
    expectedParentHash: hash102,
    endLedgerIndex: 103,
    finalLedgerHash: hash103,
    timestamp: '2026-08-01T18:00:03.000Z',
  })
}

function publicationOptions(now: () => string): SqlitePortablePublicationOptions {
  return {
    streamId: 'devnet:epoch-1:base-100',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    initialPreviousLedgerIndex: 100,
    initialExpectedParentHash: hash100,
    now,
  }
}

function publicationAdapter(options: {
  db: PortableSqliteDatabase
  storage: SqlitePortableCollectorStorageAdapter
  now: () => string
}) {
  return new SqlitePortableCollectorPublicationMaintenanceAdapter(
    options.db,
    options.storage,
    publicationOptions(options.now),
  )
}

function committedReader(storage: SqlitePortableCollectorStorageAdapter, sourceId = 'sqlite-reference') {
  return new PortableCollectorCommittedReader(storage, {
    sourceId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
  })
}

function seedScheduler(db: PortableSqliteDatabase) {
  const scheduler = new PortableCollectorScheduler(db)
  const current = buildScanPhaseMessage({
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    expectedPreviousLedgerIndex: 103,
    expectedPreviousLedgerHash: hash103,
    scanSequence: 0,
  })
  const successor = buildScanPhaseMessage({
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    expectedPreviousLedgerIndex: 103,
    expectedPreviousLedgerHash: hash103,
    scanSequence: 1,
  })
  scheduler.enqueue(current, {
    availableAt: '2026-08-01T18:20:00.000Z',
    createdAt: '2026-08-01T18:20:00.000Z',
  })
  scheduler.claim(current.messageId, {
    leaseOwner: 'state-transfer-worker',
    now: '2026-08-01T18:20:00.000Z',
    leaseExpiresAt: '2026-08-01T18:25:00.000Z',
  })
  scheduler.completeWithSuccessor({
    messageId: current.messageId,
    leaseOwner: 'state-transfer-worker',
    now: '2026-08-01T18:20:01.000Z',
    result: { caughtUp: true },
    successor,
    successorAvailableAt: '2026-08-01T18:21:00.000Z',
  })
  scheduler.dispatchNextOutbox({ now: '2026-08-01T18:21:00.000Z' })
  return { scheduler, current, successor }
}

async function seedCompleteSource() {
  const state = createDatabase()
  seedCommittedWorks(state.storage)

  const publication = publicationAdapter({
    db: state.db,
    storage: state.storage,
    now: clock('2026-08-01T18:10:00.000Z'),
  })
  const selected = publication.selectCommittedAfter({
    publicationWatermarkWorkId: null,
    limit: 2,
  })
  const verified = await publication.verifyCandidate(
    await publication.buildCandidate(selected),
  )
  publication.advancePublicationWatermark(verified)
  const plan = await publication.buildPlan({
    verifiedPublication: verified,
    retainCommittedWorks: 1,
    maxMutations: 2,
  })
  expect(publication.applyPlan(plan)).toEqual({ appliedMutations: 2 })

  stageWork({
    storage: state.storage,
    workId: 'work-104-staged',
    previousLedgerIndex: 103,
    expectedParentHash: hash103,
    endLedgerIndex: 104,
    finalLedgerHash: hash104,
    timestamp: '2026-08-01T18:30:00.000Z',
  })
  stageWork({
    storage: state.storage,
    workId: 'work-104-committing',
    previousLedgerIndex: 103,
    expectedParentHash: hash103,
    endLedgerIndex: 104,
    finalLedgerHash: hash104,
    timestamp: '2026-08-01T18:31:00.000Z',
    completeCommit: true,
  })

  const schedulerState = seedScheduler(state.db)
  return { state, publication, verified, plan, schedulerState }
}

describe('R3E complete portable state transfer', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('restores collection, scheduler, publication, and maintenance state exactly', async () => {
    const source = await seedCompleteSource()
    const sourceTransfer = new SqlitePortableCollectorCompleteStateTransferAdapter(
      source.state.db,
    )
    const sourceReader = committedReader(source.state.storage)
    const firstPage = await sourceReader.listBySemanticClass({
      semanticClass: 'protocol-event',
      order: 'asc',
      limit: 1,
    })
    expect(firstPage.nextCursor).not.toBeNull()

    const exported = sourceTransfer.exportCompleteState()
    expect(sourceTransfer.exportCompleteState()).toBe(exported)

    const target = createDatabase()
    const targetTransfer = new SqlitePortableCollectorCompleteStateTransferAdapter(
      target.db,
    )
    targetTransfer.restoreCompleteState(exported)
    expect(targetTransfer.exportCompleteState()).toBe(exported)

    expect(target.storage.getWork('work-104-staged')?.status).toBe('staged')
    expect(target.storage.getWork('work-104-committing')?.status).toBe('committing')
    expect(target.storage.getWork('work-101')?.status).toBe('committed')
    expect(target.storage.listPayloadChunks('work-101')).toEqual([])
    expect(target.storage.listCommitChunks('work-101')).toEqual([])
    expect(target.storage.listReferenceRowsForWork('work-101')).toHaveLength(1)

    const targetReader = committedReader(target.storage)
    expect(targetReader.getFence()).toEqual(firstPage.fence)
    const continued = await targetReader.listBySemanticClass({
      semanticClass: 'protocol-event',
      order: 'asc',
      limit: 1,
      cursor: firstPage.nextCursor!,
    })
    expect(continued.rows.map((row) => row.canonicalKey)).toEqual(['event:102'])
    await expect(
      committedReader(target.storage, 'another-source').listBySemanticClass({
        semanticClass: 'protocol-event',
        order: 'asc',
        limit: 1,
        cursor: firstPage.nextCursor!,
      }),
    ).rejects.toMatchObject({ code: 'invalid_cursor' })

    const targetScheduler = new PortableCollectorScheduler(target.db)
    expect(
      targetScheduler.getMessage(source.schedulerState.current.messageId),
    ).toMatchObject({ status: 'completed' })
    expect(
      targetScheduler.getMessage(source.schedulerState.successor.messageId),
    ).toMatchObject({ status: 'queued' })
    expect(
      targetScheduler.getOutbox(source.schedulerState.current.messageId),
    ).toMatchObject({ status: 'dispatched' })

    const targetPublication = publicationAdapter({
      db: target.db,
      storage: target.storage,
      now: clock('2026-08-01T19:00:00.000Z'),
    })
    expect(targetPublication.getPublicationWatermark()).toMatchObject({
      publicationId: source.verified.publicationId,
      workId: 'work-102',
      ledgerIndex: 102,
      ledgerHash: hash102,
    })
    expect(targetPublication.getPlan(source.plan.planId)).toEqual(source.plan)
    expect(targetPublication.applyPlan(source.plan)).toEqual({ appliedMutations: 0 })

    const remaining = targetPublication.selectCommittedAfter({
      publicationWatermarkWorkId: 'work-102',
      limit: 10,
    })
    expect(remaining.map((work) => work.workId)).toEqual(['work-103'])
    const nextVerified = await targetPublication.verifyCandidate(
      await targetPublication.buildCandidate(remaining),
    )
    const nextWatermark = targetPublication.advancePublicationWatermark(nextVerified)
    expect(nextWatermark).toMatchObject({
      workId: 'work-103',
      ledgerIndex: 103,
      ledgerHash: hash103,
    })
    expect(target.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
      workId: 'work-103',
      ledgerIndex: 103,
      ledgerHash: hash103,
    })
  })

  it('rejects a non-empty target without changing existing state', async () => {
    const source = await seedCompleteSource()
    const exported = new SqlitePortableCollectorCompleteStateTransferAdapter(
      source.state.db,
    ).exportCompleteState()

    const target = createDatabase()
    target.storage.beginWork({
      workId: 'existing-work',
      network: 'devnet',
      epochId: 'epoch-existing',
      baseIdentity: 'base-existing',
      previousLedgerIndex: 0,
      expectedParentHash: hash100,
      plannedEndLedgerIndex: 1,
      planJson: '{"existing":true}',
      createdAt: '2026-08-01T20:00:00.000Z',
    })
    const before = target.storage.exportState()

    expect(() =>
      new SqlitePortableCollectorCompleteStateTransferAdapter(
        target.db,
      ).restoreCompleteState(exported),
    ).toThrowError(expect.objectContaining({ code: 'target_not_empty' }))
    expect(target.storage.exportState()).toBe(before)
  })

  it('rolls back an invalid publication chain and rejects unsupported versions', async () => {
    const source = await seedCompleteSource()
    const exported = new SqlitePortableCollectorCompleteStateTransferAdapter(
      source.state.db,
    ).exportCompleteState()
    const parsed = JSON.parse(exported) as {
      schemaVersion: number
      publicationCandidates: Array<Record<string, unknown>>
    }

    const unsupported = JSON.stringify({ ...parsed, schemaVersion: 2 })
    const unsupportedTarget = createDatabase()
    expect(() =>
      new SqlitePortableCollectorCompleteStateTransferAdapter(
        unsupportedTarget.db,
      ).restoreCompleteState(unsupported),
    ).toThrowError(expect.objectContaining({ code: 'unsupported_version' }))

    parsed.publicationCandidates[0] = {
      ...parsed.publicationCandidates[0],
      previous_publication_id: 'missing-publication',
    }
    const invalidTarget = createDatabase()
    expect(() =>
      new SqlitePortableCollectorCompleteStateTransferAdapter(
        invalidTarget.db,
      ).restoreCompleteState(JSON.stringify(parsed)),
    ).toThrowError(PortableCollectorCompleteStateError)

    for (const table of [
      'collector_work',
      'collector_scheduler_messages',
      'collector_publication_candidates',
      'collector_maintenance_plans',
    ]) {
      expect(
        invalidTarget.db.get<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ${table}`,
        )?.count,
      ).toBe(0)
    }
  })
})
