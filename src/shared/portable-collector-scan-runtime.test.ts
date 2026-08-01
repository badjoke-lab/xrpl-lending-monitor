import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildScanPhaseMessage,
  parsePortablePhaseMessage,
  type ScanPhaseMessageV1,
} from './portable-collector-messages'
import type { NormalizedCandidateV1 } from './portable-collector-payload'
import type {
  PortableLedgerCostEstimate,
  PortableScanBudget,
} from './portable-collector-planner'
import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import { PortableCollectorScanRuntime } from './portable-collector-scan-runtime'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  FixtureExecutionAdapter,
  type PortableFixtureExecutionOptions,
  type PortableFixtureNormalizedRange,
} from './portable-collector-fixture-execution'

class NodeSqliteScanRuntimeDatabase implements PortableSqliteDatabase {
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
const t0 = '2026-08-01T10:30:00.000Z'
const retryAt = '2026-08-01T10:32:00.000Z'
const commitAt = '2026-08-01T10:31:00.000Z'
const caughtUpAt = '2026-08-01T10:35:00.000Z'
const leaseExpiresAt = '2026-08-01T10:40:00.000Z'
const baseHash = 'A'.repeat(64)
const ledger101Hash = 'B'.repeat(64)
const ledger102Hash = 'C'.repeat(64)
const ledger103Hash = 'D'.repeat(64)
const transactionHash = 'E'.repeat(64)

const generousBudget: PortableScanBudget = {
  maxLedgers: 48,
  maxTransactions: 100,
  maxDecodedBytes: 1_000_000,
  maxNormalizedBytes: 1_000_000,
  maxPayloadBytes: 1_000_000,
  maxExternalRequests: 100,
}

function estimate(ledgerIndex: number, transactionCount = 1): PortableLedgerCostEstimate {
  return {
    ledgerIndex,
    transactionCount,
    decodedBytes: 100,
    normalizedBytes: 80,
    payloadBytes: 120,
    externalRequests: 1,
  }
}

function ledgerCandidate(
  ledgerIndex: number,
  ledgerHash: string,
  parentHash: string,
): NormalizedCandidateV1 {
  return {
    semanticClass: 'validated-ledger',
    canonicalKey: `ledger:${ledgerIndex}`,
    sourceLedgerIndex: ledgerIndex,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: null,
    objectId: null,
    relationshipIds: [],
    isTombstone: false,
    value: { ledgerIndex, ledgerHash, parentHash },
  }
}

function protocolEvent(ledgerIndex: number, ledgerHash: string): NormalizedCandidateV1 {
  return {
    semanticClass: 'protocol-event',
    canonicalKey: `event:${ledgerIndex}:0`,
    sourceLedgerIndex: ledgerIndex,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: transactionHash,
    objectId: null,
    relationshipIds: ['loan:1'],
    isTombstone: false,
    value: { transactionType: 'LoanSet' },
  }
}

function range101To102(): PortableFixtureNormalizedRange {
  return {
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    finalLedgerHash: ledger102Hash,
    ledgers: [
      ledgerCandidate(101, ledger101Hash, baseHash),
      ledgerCandidate(102, ledger102Hash, ledger101Hash),
    ],
    protocolEvents: [protocolEvent(101, ledger101Hash)],
    objectChanges: [],
    loanLifecycleEvents: [],
    archivedObjects: [],
    balanceHistory: [],
    currentProjectionMutations: [],
  }
}

function range103(): PortableFixtureNormalizedRange {
  return {
    startLedgerIndex: 103,
    endLedgerIndex: 103,
    finalLedgerHash: ledger103Hash,
    ledgers: [ledgerCandidate(103, ledger103Hash, ledger102Hash)],
    protocolEvents: [protocolEvent(103, ledger103Hash)],
    objectChanges: [],
    loanLifecycleEvents: [],
    archivedObjects: [],
    balanceHistory: [],
    currentProjectionMutations: [],
  }
}

function scanMessage(input: Partial<ScanPhaseMessageV1> = {}): ScanPhaseMessageV1 {
  return buildScanPhaseMessage({
    network: input.network ?? 'devnet',
    epochId: input.epochId ?? 'epoch-1',
    baseIdentity: input.baseIdentity ?? 'base-100',
    expectedPreviousLedgerIndex: input.expectedPreviousLedgerIndex ?? 100,
    expectedPreviousLedgerHash: input.expectedPreviousLedgerHash ?? baseHash,
    scanSequence: input.scanSequence ?? 0,
  })
}

function adapterOptions(
  overrides: Partial<PortableFixtureExecutionOptions> = {},
): PortableFixtureExecutionOptions {
  return {
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    immutableBaseLedgerIndex: 100,
    immutableBaseLedgerHash: baseHash,
    validatedHeadLedgerIndex: 102,
    budget: generousBudget,
    estimates: [estimate(101), estimate(102)],
    ranges: [range101To102()],
    commitSuccessorAvailableAt: commitAt,
    caughtUpSuccessorAvailableAt: caughtUpAt,
    retryAvailableAt: retryAt,
    ...overrides,
  }
}

function createRuntime(
  message: ScanPhaseMessageV1,
  options: PortableFixtureExecutionOptions,
): {
  database: DatabaseSync
  db: NodeSqliteScanRuntimeDatabase
  store: PortableCollectorReferenceStore
  scheduler: PortableCollectorScheduler
  execution: FixtureExecutionAdapter
  runtime: PortableCollectorScanRuntime
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
  const db = new NodeSqliteScanRuntimeDatabase(database)
  const store = new PortableCollectorReferenceStore(db)
  const scheduler = new PortableCollectorScheduler(db)
  const execution = new FixtureExecutionAdapter(options)
  const runtime = new PortableCollectorScanRuntime(store, scheduler, execution)
  scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
  return { database, db, store, scheduler, execution, runtime }
}

function executionOptions(now = t0) {
  return {
    leaseOwner: 'fixture-worker',
    now,
    leaseExpiresAt,
  }
}

function seedCommittedWatermark(
  store: PortableCollectorReferenceStore,
  workId = 'seed-work-101-102',
): void {
  store.beginWork({
    workId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: baseHash,
    plannedEndLedgerIndex: 102,
    planJson: '{"seed":true}',
    createdAt: '2026-08-01T10:00:00.000Z',
  })
  store.stagePayloadChunk({
    workId,
    chunkIndex: 0,
    encoding: 'seed-json-v1',
    payload: new TextEncoder().encode('{"seed":true}'),
    payloadDigest: 'seed-chunk-digest',
    recordCount: 1,
    createdAt: '2026-08-01T10:00:00.000Z',
  })
  store.sealScan({
    workId,
    scannedEndLedgerIndex: 102,
    finalLedgerHash: ledger102Hash,
    semanticCountsJson: '{"totalRecords":1}',
    payloadDigest: 'seed-payload-digest',
    expectedPayloadChunks: 1,
    expectedCommitChunks: 1,
    updatedAt: '2026-08-01T10:01:00.000Z',
  })
  store.completeCommitChunk({
    workId,
    chunkIndex: 0,
    operationCount: 1,
    rowMutationCount: 0,
    chunkDigest: 'seed-chunk-digest',
    completedAt: '2026-08-01T10:02:00.000Z',
  })
  store.finalizeWork({
    workId,
    committedAt: '2026-08-01T10:03:00.000Z',
  })
}

describe('portable collector fixture scan runtime', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('stages a planned initial range and reserves commit without early visibility', async () => {
    const message = scanMessage()
    const { store, scheduler, execution, runtime } = createRuntime(
      message,
      adapterOptions(),
    )

    const result = await runtime.execute(message.messageId, executionOptions())

    expect(result).toMatchObject({
      status: 'completed',
      messageId: message.messageId,
      result: {
        status: 'staged',
        startLedgerIndex: 101,
        endLedgerIndex: 102,
        payloadChunks: 1,
      },
    })
    if (result.status !== 'completed') throw new Error('scan did not complete')
    const workId = String(result.result.workId)
    expect(store.getWork(workId)).toMatchObject({
      status: 'staged',
      previousLedgerIndex: 100,
      scannedEndLedgerIndex: 102,
      finalLedgerHash: ledger102Hash,
      expectedPayloadChunks: 1,
      expectedCommitChunks: 1,
    })
    expect(store.listPayloadChunks(workId)).toHaveLength(1)
    expect(store.listReferenceRowsForWork(workId)).toEqual([])
    expect(store.listCommittedReferenceRows()).toEqual([])
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(parsePortablePhaseMessage(scheduler.getOutbox(message.messageId)!.successorPayloadJson)).toMatchObject({
      phase: 'commit',
      workId,
      chunkIndex: 0,
    })
    expect(execution.snapshotCounters()).toEqual({
      validatedHeadReads: 1,
      estimateReads: 1,
      normalizedRangeReads: 1,
      stagedMutationHooks: 1,
      selectedLedgers: 2,
      normalizedRecords: 3,
    })
  })

  it('uses an existing committed watermark as the exact scan boundary', async () => {
    const message = scanMessage({
      expectedPreviousLedgerIndex: 102,
      expectedPreviousLedgerHash: ledger102Hash,
    })
    const runtimeState = createRuntime(
      message,
      adapterOptions({
        validatedHeadLedgerIndex: 103,
        estimates: [estimate(103)],
        ranges: [range103()],
      }),
    )
    seedCommittedWatermark(runtimeState.store)

    const result = await runtimeState.runtime.execute(
      message.messageId,
      executionOptions(),
    )

    expect(result).toMatchObject({
      status: 'completed',
      result: { status: 'staged', startLedgerIndex: 103, endLedgerIndex: 103 },
    })
    if (result.status !== 'completed') throw new Error('watermark scan did not complete')
    expect(runtimeState.store.getWork(String(result.result.workId))).toMatchObject({
      previousLedgerIndex: 102,
      expectedParentHash: ledger102Hash,
      status: 'staged',
    })
    expect(runtimeState.store.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
      ledgerIndex: 102,
      ledgerHash: ledger102Hash,
      workId: 'seed-work-101-102',
    })
  })

  it('reserves a sequence-plus-one scan when caught up without creating work', async () => {
    const message = scanMessage({ scanSequence: 4 })
    const { db, store, scheduler, runtime } = createRuntime(
      message,
      adapterOptions({
        validatedHeadLedgerIndex: 100,
        estimates: [],
        ranges: [],
      }),
    )

    const result = await runtime.execute(message.messageId, executionOptions())

    expect(result).toMatchObject({
      status: 'completed',
      result: {
        status: 'caught_up',
        ledgerIndex: 100,
        scanSequence: 4,
        successorScanSequence: 5,
      },
    })
    const successor = parsePortablePhaseMessage(
      scheduler.getOutbox(message.messageId)!.successorPayloadJson,
    )
    expect(successor).toMatchObject({
      phase: 'scan',
      expectedPreviousLedgerIndex: 100,
      expectedPreviousLedgerHash: baseHash,
      scanSequence: 5,
    })
    expect(successor.messageId).not.toBe(message.messageId)
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
  })

  it('retries the exact scan identity after a retryable transport failure', async () => {
    const message = scanMessage({ scanSequence: 2 })
    const { store, scheduler, runtime } = createRuntime(
      message,
      adapterOptions({
        validatedHeadLedgerIndex: 100,
        estimates: [],
        ranges: [],
        failures: [
          {
            stage: 'validated_head',
            classification: 'retryable_transport',
            message: 'fixture transport unavailable',
          },
        ],
      }),
    )

    const result = await runtime.execute(message.messageId, executionOptions())

    expect(result).toEqual({
      status: 'retry_scheduled',
      messageId: message.messageId,
      classification: 'retryable_transport',
      availableAt: retryAt,
    })
    const snapshot = scheduler.getMessage(message.messageId)!
    expect(snapshot).toMatchObject({
      status: 'pending',
      availableAt: retryAt,
      attemptCount: 1,
      errorClassification: 'retryable_transport',
    })
    expect(parsePortablePhaseMessage(snapshot.payloadJson)).toMatchObject({
      messageId: message.messageId,
      scanSequence: 2,
    })
    expect(store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
  })

  it('halts a single-ledger budget overflow without work or successor', async () => {
    const message = scanMessage()
    const { db, scheduler, runtime } = createRuntime(
      message,
      adapterOptions({
        validatedHeadLedgerIndex: 101,
        budget: { ...generousBudget, maxTransactions: 1 },
        estimates: [estimate(101, 2)],
        ranges: [],
      }),
    )

    const result = await runtime.execute(message.messageId, executionOptions())

    expect(result).toMatchObject({
      status: 'halted',
      classification: 'resource_halt',
    })
    expect(scheduler.getMessage(message.messageId)).toMatchObject({
      status: 'error',
      errorClassification: 'resource_halt',
      successorMessageId: null,
    })
    expect(scheduler.getOutbox(message.messageId)).toBeUndefined()
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
  })

  it('rolls back staged work and retries the same scan after a storage interruption', async () => {
    const message = scanMessage({ scanSequence: 7 })
    const { db, scheduler, runtime } = createRuntime(
      message,
      adapterOptions({
        failures: [
          {
            stage: 'after_scan_staging',
            classification: 'retryable_storage',
            message: 'injected storage interruption',
          },
        ],
      }),
    )

    const result = await runtime.execute(message.messageId, executionOptions())

    expect(result).toEqual({
      status: 'retry_scheduled',
      messageId: message.messageId,
      classification: 'retryable_storage',
      availableAt: retryAt,
    })
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
    expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_payload_chunks')?.count).toBe(0)
    expect(scheduler.getOutbox(message.messageId)).toBeUndefined()
    const snapshot = scheduler.getMessage(message.messageId)!
    expect(snapshot).toMatchObject({
      status: 'pending',
      availableAt: retryAt,
      attemptCount: 1,
    })
    expect(parsePortablePhaseMessage(snapshot.payloadJson)).toMatchObject({
      messageId: message.messageId,
      scanSequence: 7,
    })
  })

  it('halts stale and hash-mismatched boundaries without mutation', async () => {
    for (const message of [
      scanMessage({ expectedPreviousLedgerIndex: 99 }),
      scanMessage({ expectedPreviousLedgerHash: 'F'.repeat(64) }),
    ]) {
      const { db, scheduler, runtime } = createRuntime(message, adapterOptions())
      const result = await runtime.execute(message.messageId, executionOptions())
      expect(result.status).toBe('halted')
      if (result.status !== 'halted') throw new Error('boundary mismatch did not halt')
      expect(['stale_boundary', 'parent_hash_mismatch']).toContain(result.classification)
      expect(scheduler.getOutbox(message.messageId)).toBeUndefined()
      expect(db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
    }
  })
}