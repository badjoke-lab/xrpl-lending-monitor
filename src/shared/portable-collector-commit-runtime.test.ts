import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { PortableCollectorCommitRuntime } from './portable-collector-commit-runtime'
import {
  buildCommitPhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'
import {
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  type NormalizedCandidateV1,
  type NormalizedPayloadChunkLimits,
} from './portable-collector-payload'
import type { PortableScanBudget } from './portable-collector-planner'
import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  FixtureExecutionAdapter,
  type PortableFixtureExecutionOptions,
} from './portable-collector-fixture-execution'

class NodeSqliteCommitRuntimeDatabase implements PortableSqliteDatabase {
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
const t0 = '2026-08-01T11:00:00.000Z'
const successorAt = '2026-08-01T11:01:00.000Z'
const retryAt = '2026-08-01T11:02:00.000Z'
const leaseExpiresAt = '2026-08-01T11:10:00.000Z'
const baseHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)
const workId = 'work-101'

const budget: PortableScanBudget = {
  maxLedgers: 48,
  maxTransactions: 100,
  maxDecodedBytes: 1_000_000,
  maxNormalizedBytes: 1_000_000,
  maxPayloadBytes: 1_000_000,
  maxExternalRequests: 100,
}

function transactionHash(index: number): string {
  return index.toString(16).toUpperCase().padStart(64, '0')
}

function ledgerCandidate(): NormalizedCandidateV1 {
  return {
    semanticClass: 'validated-ledger',
    canonicalKey: 'ledger:101',
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: null,
    objectId: null,
    relationshipIds: [],
    isTombstone: false,
    value: { ledgerIndex: 101, ledgerHash, parentHash: baseHash },
  }
}

function protocolEvent(index: number): NormalizedCandidateV1 {
  return {
    semanticClass: 'protocol-event',
    canonicalKey: `event:${index.toString().padStart(3, '0')}`,
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: transactionHash(index + 1),
    objectId: null,
    relationshipIds: ['loan:2', 'loan:1', 'loan:2'],
    isTombstone: false,
    value: { index, transactionType: 'LoanSet' },
  }
}

function fixtureOptions(
  overrides: Partial<PortableFixtureExecutionOptions> = {},
): PortableFixtureExecutionOptions {
  return {
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    immutableBaseLedgerIndex: 100,
    immutableBaseLedgerHash: baseHash,
    validatedHeadLedgerIndex: 101,
    budget,
    estimates: [],
    ranges: [],
    commitSuccessorAvailableAt: successorAt,
    caughtUpSuccessorAvailableAt: successorAt,
    retryAvailableAt: retryAt,
    ...overrides,
  }
}

function createDatabase(): {
  database: DatabaseSync
  db: NodeSqliteCommitRuntimeDatabase
  store: PortableCollectorReferenceStore
  scheduler: PortableCollectorScheduler
} {
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
  const db = new NodeSqliteCommitRuntimeDatabase(database)
  return {
    database,
    db,
    store: new PortableCollectorReferenceStore(db),
    scheduler: new PortableCollectorScheduler(db),
  }
}

async function stagePayload(options: {
  store: PortableCollectorReferenceStore
  protocolEventCount: number
  chunkLimits?: NormalizedPayloadChunkLimits
}): Promise<number> {
  const protocolEvents = Array.from(
    { length: options.protocolEventCount },
    (_, index) => protocolEvent(index),
  )
  const payload = await buildNormalizedCollectorPayload({
    workId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: baseHash,
    startLedgerIndex: 101,
    endLedgerIndex: 101,
    finalLedgerHash: ledgerHash,
    ledgers: [ledgerCandidate()],
    protocolEvents,
    objectChanges: [],
    loanLifecycleEvents: [],
    archivedObjects: [],
    balanceHistory: [],
    currentProjectionMutations: [],
  })
  const chunks = await buildNormalizedPayloadChunks(payload, options.chunkLimits)

  options.store.beginWork({
    workId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: baseHash,
    plannedEndLedgerIndex: 101,
    planJson: '{"fixture":"commit-runtime"}',
    createdAt: t0,
  })
  for (const built of chunks) {
    options.store.stagePayloadChunk({
      workId,
      chunkIndex: built.chunk.chunkIndex,
      encoding: 'normalized-payload-chunk-json-v1',
      payload: built.encoded,
      payloadDigest: built.chunk.chunkDigest,
      recordCount: built.chunk.records.length,
      createdAt: t0,
    })
  }
  options.store.sealScan({
    workId,
    scannedEndLedgerIndex: 101,
    finalLedgerHash: ledgerHash,
    semanticCountsJson: canonicalPortableJson(payload.semanticCounts),
    payloadDigest: payload.digest,
    expectedPayloadChunks: chunks.length,
    expectedCommitChunks: chunks.length,
    updatedAt: t0,
  })
  return chunks.length
}

function runtimeOptions(now = t0) {
  return {
    leaseOwner: 'commit-worker',
    now,
    leaseExpiresAt,
  }
}

function createRuntime(
  scheduler: PortableCollectorScheduler,
  store: PortableCollectorReferenceStore,
  executionOptions: PortableFixtureExecutionOptions,
): PortableCollectorCommitRuntime {
  return new PortableCollectorCommitRuntime(
    store,
    scheduler,
    new FixtureExecutionAdapter(executionOptions),
  )
}

describe('portable collector commit runtime', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('commits one verified chunk with complete identity and reserves finalize', async () => {
    const { store, scheduler } = createDatabase()
    await stagePayload({ store, protocolEventCount: 2 })
    const message = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
    scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(scheduler, store, fixtureOptions())

    const result = await runtime.execute(message.messageId, runtimeOptions())

    expect(result).toMatchObject({
      status: 'completed',
      result: {
        status: 'committed_chunk',
        workId,
        chunkIndex: 0,
        totalChunks: 1,
        rowMutationCount: 3,
        successorPhase: 'finalize',
      },
    })
    expect(store.getWork(workId)?.status).toBe('committing')
    const rows = store.listReferenceRowsForWork(workId)
    expect(rows).toHaveLength(3)
    expect(rows.find((row) => row.canonicalKey === 'event:000')).toMatchObject({
      semanticClass: 'protocol-event',
      sourceTransactionHash: transactionHash(1),
      objectId: null,
      relationshipIds: ['loan:1', 'loan:2'],
    })
    expect(store.listCommitChunks(workId)).toHaveLength(1)
    expect(store.listCommittedReferenceRows()).toEqual([])
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(parsePortablePhaseMessage(scheduler.getOutbox(message.messageId)!.successorPayloadJson)).toMatchObject({
      phase: 'finalize',
      workId,
    })

    const duplicate = await runtime.execute(message.messageId, runtimeOptions(successorAt))
    expect(duplicate.status).toBe('duplicate')
    expect(store.listReferenceRowsForWork(workId)).toHaveLength(3)
    expect(store.listCommitChunks(workId)).toHaveLength(1)
  })

  it('commits a deterministic multi-chunk payload in exact order', async () => {
    const { store, scheduler } = createDatabase()
    expect(await stagePayload({ store, protocolEventCount: 44 })).toBe(2)
    const first = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
    scheduler.enqueue(first, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(scheduler, store, fixtureOptions())

    const firstResult = await runtime.execute(first.messageId, runtimeOptions())
    expect(firstResult).toMatchObject({
      status: 'completed',
      result: { chunkIndex: 0, totalChunks: 2, rowMutationCount: 40, successorPhase: 'commit' },
    })
    expect(store.listReferenceRowsForWork(workId)).toHaveLength(40)
    expect(store.listCommitChunks(workId).map((chunk) => chunk.chunkIndex)).toEqual([0])

    scheduler.dispatchNextOutbox({ now: successorAt })
    const second = buildCommitPhaseMessage({ workId, chunkIndex: 1 })
    const secondResult = await runtime.execute(second.messageId, runtimeOptions(successorAt))
    expect(secondResult).toMatchObject({
      status: 'completed',
      result: { chunkIndex: 1, totalChunks: 2, rowMutationCount: 5, successorPhase: 'finalize' },
    })
    expect(store.listReferenceRowsForWork(workId)).toHaveLength(45)
    expect(store.listCommitChunks(workId).map((chunk) => chunk.chunkIndex)).toEqual([0, 1])
  })

  it('halts a non-next commit message without candidate mutation', async () => {
    const { store, scheduler } = createDatabase()
    expect(await stagePayload({ store, protocolEventCount: 44 })).toBe(2)
    const wrong = buildCommitPhaseMessage({ workId, chunkIndex: 1 })
    scheduler.enqueue(wrong, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(scheduler, store, fixtureOptions())

    const result = await runtime.execute(wrong.messageId, runtimeOptions())

    expect(result).toMatchObject({ status: 'halted', classification: 'invalid_message' })
    expect(store.listReferenceRowsForWork(workId)).toEqual([])
    expect(store.listCommitChunks(workId)).toEqual([])
    expect(scheduler.getOutbox(wrong.messageId)).toBeUndefined()
  })

  it('halts canonical chunk tampering as a digest mismatch', async () => {
    const { db, store, scheduler } = createDatabase()
    await stagePayload({ store, protocolEventCount: 2 })
    const chunk = store.getPayloadChunk(workId, 0)!
    const changed = new TextDecoder().decode(chunk.payload).replace('LoanSet', 'LoanPay')
    const changedBytes = new TextEncoder().encode(changed)
    db.run(
      `UPDATE collector_payload_chunks
       SET payload = ?, byte_count = ?
       WHERE work_id = ? AND chunk_index = 0`,
      [changedBytes, changedBytes.byteLength, workId],
    )
    const message = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
    scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(scheduler, store, fixtureOptions())

    const result = await runtime.execute(message.messageId, runtimeOptions())

    expect(result).toMatchObject({ status: 'halted', classification: 'digest_mismatch' })
    expect(store.listReferenceRowsForWork(workId)).toEqual([])
    expect(store.listCommitChunks(workId)).toEqual([])
  })

  it('halts a valid 41-record chunk at the commit resource guard', async () => {
    const { store, scheduler } = createDatabase()
    expect(
      await stagePayload({
        store,
        protocolEventCount: 40,
        chunkLimits: { maxRecords: 41, maxEncodedBytes: 512_000 },
      }),
    ).toBe(1)
    const message = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
    scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(scheduler, store, fixtureOptions())

    const result = await runtime.execute(message.messageId, runtimeOptions())

    expect(result).toMatchObject({ status: 'halted', classification: 'resource_halt' })
    expect(store.listReferenceRowsForWork(workId)).toEqual([])
    expect(store.listCommitChunks(workId)).toEqual([])
  })

  it('rolls back candidates and commit evidence before retrying the same identity', async () => {
    const { store, scheduler } = createDatabase()
    await stagePayload({ store, protocolEventCount: 2 })
    const message = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
    scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
    const runtime = createRuntime(
      scheduler,
      store,
      fixtureOptions({
        failures: [
          {
            stage: 'after_commit_mutation',
            classification: 'retryable_storage',
            message: 'injected commit storage interruption',
          },
        ],
      }),
    )

    const result = await runtime.execute(message.messageId, runtimeOptions())

    expect(result).toEqual({
      status: 'retry_scheduled',
      messageId: message.messageId,
      classification: 'retryable_storage',
      availableAt: retryAt,
    })
    expect(store.getWork(workId)?.status).toBe('staged')
    expect(store.listReferenceRowsForWork(workId)).toEqual([])
    expect(store.listCommitChunks(workId)).toEqual([])
    expect(scheduler.getOutbox(message.messageId)).toBeUndefined()
    expect(scheduler.getMessage(message.messageId)).toMatchObject({
      status: 'pending',
      availableAt: retryAt,
      attemptCount: 1,
    })
  })
})
