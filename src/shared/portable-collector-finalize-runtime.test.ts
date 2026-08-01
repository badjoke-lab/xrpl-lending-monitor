import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { PortableCollectorCommitRuntime } from './portable-collector-commit-runtime'
import {
  PortableCollectorFinalizeRuntime,
  PortableFinalizeExecutionError,
  type PortableFinalizeExecutionAdapter,
} from './portable-collector-finalize-runtime'
import {
  buildCommitPhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'
import {
  buildNormalizedCollectorPayload,
  buildNormalizedPayloadChunks,
  type NormalizedCandidateV1,
  type NormalizedPayloadChunkLimits,
  type NormalizedSemanticClassV1,
} from './portable-collector-payload'
import type { PortableScanBudget } from './portable-collector-planner'
import {
  canonicalPortableJson,
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  exportPortableCollectorRuntimeState,
  restorePortableCollectorRuntimeState,
} from './portable-collector-runtime-state'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  FixtureExecutionAdapter,
  type PortableFixtureExecutionOptions,
} from './portable-collector-fixture-execution'

class NodeSqliteFinalizeDatabase implements PortableSqliteDatabase {
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
const workId = 'work-101'
const t0 = '2026-08-01T12:00:00.000Z'
const commitAt = '2026-08-01T12:01:00.000Z'
const finalizeAt = '2026-08-01T12:02:00.000Z'
const nextScanAt = '2026-08-01T12:03:00.000Z'
const retryAt = '2026-08-01T12:04:00.000Z'
const leaseExpiresAt = '2026-08-01T12:10:00.000Z'
const baseHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)

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

function candidate(
  semanticClass: NormalizedSemanticClassV1,
  canonicalKey: string,
  index: number,
  overrides: Partial<NormalizedCandidateV1> = {},
): NormalizedCandidateV1 {
  return {
    semanticClass,
    canonicalKey,
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash:
      semanticClass === 'validated-ledger' ? null : transactionHash(index + 1),
    objectId: null,
    relationshipIds: ['vault:1', 'broker:1', 'vault:1'],
    isTombstone: false,
    value: { canonicalKey, semanticClass },
    ...overrides,
  }
}

function semanticGroups(extraProtocolEvents = 0) {
  return {
    ledgers: [
      candidate('validated-ledger', 'ledger:101', 0, {
        relationshipIds: [],
        value: { ledgerIndex: 101, ledgerHash, parentHash: baseHash },
      }),
    ],
    protocolEvents: [
      candidate('protocol-event', 'event:000', 1),
      ...Array.from({ length: extraProtocolEvents }, (_, index) =>
        candidate(
          'protocol-event',
          `event:${(index + 1).toString().padStart(3, '0')}`,
          index + 10,
        ),
      ),
    ],
    objectChanges: [
      candidate('object-change', 'change:1', 2, { objectId: 'loan:1' }),
    ],
    loanLifecycleEvents: [
      candidate('loan-lifecycle', 'lifecycle:1', 3, { objectId: 'loan:1' }),
    ],
    archivedObjects: [
      candidate('archived-object', 'archive:1', 4, { objectId: 'loan:2' }),
    ],
    balanceHistory: [candidate('balance-history', 'balance:1', 5)],
    currentProjectionMutations: [
      candidate('current-projection', 'projection:1', 6, {
        objectId: 'loan:1',
        isTombstone: true,
        value: null,
      }),
    ],
  }
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
  const db = new NodeSqliteFinalizeDatabase(database)
  return {
    database,
    db,
    store: new PortableCollectorReferenceStore(db),
    scheduler: new PortableCollectorScheduler(db),
  }
}

function commitExecutionOptions(): PortableFixtureExecutionOptions {
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
    commitSuccessorAvailableAt: commitAt,
    caughtUpSuccessorAvailableAt: commitAt,
    retryAvailableAt: retryAt,
  }
}

function finalizeExecution(
  hook?: () => void,
): PortableFinalizeExecutionAdapter {
  return {
    nextScanAvailableAt: nextScanAt,
    retryAvailableAt: retryAt,
    afterFinalizeMutation: hook,
  }
}

async function stageWork(options: {
  store: PortableCollectorReferenceStore
  extraProtocolEvents?: number
  chunkLimits?: NormalizedPayloadChunkLimits
}) {
  const groups = semanticGroups(options.extraProtocolEvents ?? 0)
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
    ...groups,
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
    planJson: '{"fixture":"finalize-runtime"}',
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
  return { payload, chunks }
}

async function commitAll(options: {
  store: PortableCollectorReferenceStore
  scheduler: PortableCollectorScheduler
  chunkCount: number
}) {
  const runtime = new PortableCollectorCommitRuntime(
    options.store,
    options.scheduler,
    new FixtureExecutionAdapter(commitExecutionOptions()),
  )
  let message = buildCommitPhaseMessage({ workId, chunkIndex: 0 })
  options.scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
  for (let chunkIndex = 0; chunkIndex < options.chunkCount; chunkIndex += 1) {
    const result = await runtime.execute(message.messageId, {
      leaseOwner: 'commit-worker',
      now: chunkIndex === 0 ? t0 : commitAt,
      leaseExpiresAt,
    })
    expect(result.status).toBe('completed')
    options.scheduler.dispatchNextOutbox({ now: commitAt })
    if (chunkIndex + 1 < options.chunkCount) {
      message = buildCommitPhaseMessage({ workId, chunkIndex: chunkIndex + 1 })
    }
  }
  const outbox = options.scheduler.getOutbox(message.messageId)
  if (!outbox) throw new Error('finalize outbox was not reserved')
  const finalizeMessage = parsePortablePhaseMessage(outbox.successorPayloadJson)
  if (finalizeMessage.phase !== 'finalize') throw new Error('expected finalize successor')
  return finalizeMessage
}

async function prepareCommittedCandidates(extraProtocolEvents = 0) {
  const state = createDatabase()
  const staged = await stageWork({
    store: state.store,
    extraProtocolEvents,
  })
  const finalizeMessage = await commitAll({
    store: state.store,
    scheduler: state.scheduler,
    chunkCount: staged.chunks.length,
  })
  return { ...state, ...staged, finalizeMessage }
}

function finalizeOptions(now = finalizeAt) {
  return {
    leaseOwner: 'finalize-worker',
    now,
    leaseExpiresAt,
  }
}

describe('portable collector finalize runtime', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('publishes all seven semantic classes and advances the watermark atomically', async () => {
    const state = await prepareCommittedCandidates()
    expect(state.store.listCommittedReferenceRows()).toEqual([])
    expect(state.store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()

    const runtime = new PortableCollectorFinalizeRuntime(
      state.store,
      state.scheduler,
      finalizeExecution(),
    )
    const result = await runtime.execute(
      state.finalizeMessage.messageId,
      finalizeOptions(),
    )

    expect(result).toMatchObject({
      status: 'completed',
      result: {
        status: 'finalized',
        workId,
        ledgerIndex: 101,
        ledgerHash,
      },
    })
    expect(state.store.getWork(workId)?.status).toBe('committed')
    expect(state.store.listCommittedReferenceRows()).toHaveLength(7)
    expect(
      new Set(state.store.listCommittedReferenceRows().map((row) => row.semanticClass)),
    ).toEqual(
      new Set([
        'validated-ledger',
        'protocol-event',
        'object-change',
        'loan-lifecycle',
        'archived-object',
        'balance-history',
        'current-projection',
      ]),
    )
    expect(
      state.store.listCommittedReferenceRows().find((row) => row.canonicalKey === 'event:000'),
    ).toMatchObject({
      sourceTransactionHash: transactionHash(2),
      objectId: null,
      relationshipIds: ['broker:1', 'vault:1'],
    })
    expect(state.store.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
      ledgerIndex: 101,
      ledgerHash,
      workId,
    })
    const successor = parsePortablePhaseMessage(
      state.scheduler.getOutbox(state.finalizeMessage.messageId)!.successorPayloadJson,
    )
    expect(successor).toMatchObject({
      phase: 'scan',
      expectedPreviousLedgerIndex: 101,
      expectedPreviousLedgerHash: ledgerHash,
      scanSequence: 0,
    })

    const duplicate = await runtime.execute(
      state.finalizeMessage.messageId,
      finalizeOptions(nextScanAt),
    )
    expect(duplicate.status).toBe('duplicate')
    expect(state.store.listCommittedReferenceRows()).toHaveLength(7)
  })

  it('finalizes a deterministic multi-chunk payload', async () => {
    const state = await prepareCommittedCandidates(40)
    expect(state.chunks.length).toBeGreaterThan(1)
    const runtime = new PortableCollectorFinalizeRuntime(
      state.store,
      state.scheduler,
      finalizeExecution(),
    )

    const result = await runtime.execute(
      state.finalizeMessage.messageId,
      finalizeOptions(),
    )

    expect(result.status).toBe('completed')
    expect(state.store.listCommittedReferenceRows()).toHaveLength(47)
    expect(state.store.listCommitChunks(workId)).toHaveLength(state.chunks.length)
  })

  it('halts when durable candidate identity differs from the verified payload', async () => {
    const state = await prepareCommittedCandidates()
    state.db.run(
      `UPDATE collector_reference_rows
       SET relationship_ids_json = ?
       WHERE work_id = ? AND canonical_key = ?`,
      ['["changed:1"]', workId, 'event:000'],
    )
    const runtime = new PortableCollectorFinalizeRuntime(
      state.store,
      state.scheduler,
      finalizeExecution(),
    )

    const result = await runtime.execute(
      state.finalizeMessage.messageId,
      finalizeOptions(),
    )

    expect(result).toMatchObject({ status: 'halted', classification: 'digest_mismatch' })
    expect(state.store.getWork(workId)?.status).toBe('committing')
    expect(state.store.listCommittedReferenceRows()).toEqual([])
    expect(state.store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(state.scheduler.getOutbox(state.finalizeMessage.messageId)).toBeUndefined()
  })

  it('halts when commit evidence or semantic counts are incomplete', async () => {
    for (const tamper of ['commit', 'counts'] as const) {
      const state = await prepareCommittedCandidates()
      if (tamper === 'commit') {
        state.db.run(
          'DELETE FROM collector_commit_chunks WHERE work_id = ? AND chunk_index = 0',
          [workId],
        )
      } else {
        state.db.run(
          'UPDATE collector_work SET semantic_counts_json = ? WHERE work_id = ?',
          ['{"totalRecords":999}', workId],
        )
      }
      const runtime = new PortableCollectorFinalizeRuntime(
        state.store,
        state.scheduler,
        finalizeExecution(),
      )
      const result = await runtime.execute(
        state.finalizeMessage.messageId,
        finalizeOptions(),
      )
      expect(result).toMatchObject({ status: 'halted', classification: 'digest_mismatch' })
      expect(state.store.listCommittedReferenceRows()).toEqual([])
      expect(state.store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    }
  })

  it('rolls back visibility, watermark, completion, and outbox before retry', async () => {
    const state = await prepareCommittedCandidates()
    const runtime = new PortableCollectorFinalizeRuntime(
      state.store,
      state.scheduler,
      finalizeExecution(() => {
        throw new PortableFinalizeExecutionError(
          'retryable_storage',
          'injected finalize storage interruption',
        )
      }),
    )

    const result = await runtime.execute(
      state.finalizeMessage.messageId,
      finalizeOptions(),
    )

    expect(result).toEqual({
      status: 'retry_scheduled',
      messageId: state.finalizeMessage.messageId,
      classification: 'retryable_storage',
      availableAt: retryAt,
    })
    expect(state.store.getWork(workId)?.status).toBe('committing')
    expect(state.store.listCommittedReferenceRows()).toEqual([])
    expect(state.store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(state.scheduler.getOutbox(state.finalizeMessage.messageId)).toBeUndefined()
    expect(state.scheduler.getMessage(state.finalizeMessage.messageId)).toMatchObject({
      status: 'pending',
      availableAt: retryAt,
      attemptCount: 1,
    })
  })

  it('resumes finalization from an identity-complete runtime v3 export', async () => {
    const source = await prepareCommittedCandidates(40)
    const exported = exportPortableCollectorRuntimeState(source.db)
    expect((JSON.parse(exported) as { schemaVersion: number }).schemaVersion).toBe(3)

    const target = createDatabase()
    restorePortableCollectorRuntimeState(target.db, exported)
    expect(exportPortableCollectorRuntimeState(target.db)).toBe(exported)
    const runtime = new PortableCollectorFinalizeRuntime(
      target.store,
      target.scheduler,
      finalizeExecution(),
    )

    const result = await runtime.execute(
      source.finalizeMessage.messageId,
      finalizeOptions(),
    )

    expect(result.status).toBe('completed')
    expect(target.store.getWork(workId)?.status).toBe('committed')
    expect(target.store.listCommittedReferenceRows()).toHaveLength(47)
    expect(target.store.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
      ledgerIndex: 101,
      ledgerHash,
    })
  })
})
