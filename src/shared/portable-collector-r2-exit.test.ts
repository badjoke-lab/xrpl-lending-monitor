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
  buildScanPhaseMessage,
  parsePortablePhaseMessage,
  type PortableCollectorPhaseMessageV1,
  type ScanPhaseMessageV1,
} from './portable-collector-messages'
import type { NormalizedCandidateV1, NormalizedSemanticClassV1 } from './portable-collector-payload'
import type { PortableLedgerCostEstimate, PortableScanBudget } from './portable-collector-planner'
import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  exportPortableCollectorRuntimeState,
  restorePortableCollectorRuntimeState,
} from './portable-collector-runtime-state'
import { PortableCollectorScanRuntime } from './portable-collector-scan-runtime'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  FixtureExecutionAdapter,
  type PortableFixtureExecutionOptions,
  type PortableFixtureNormalizedRange,
} from './portable-collector-fixture-execution'

class NodeSqliteR2ExitDatabase implements PortableSqliteDatabase {
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

interface RuntimeState {
  database: DatabaseSync
  db: NodeSqliteR2ExitDatabase
  store: PortableCollectorReferenceStore
  scheduler: PortableCollectorScheduler
}

const openDatabases: DatabaseSync[] = []
const workNetwork = 'devnet'
const epochId = 'epoch-1'
const baseIdentity = 'base-100'
const baseLedgerIndex = 100
const ledgerIndex = 101
const baseHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)
const t0 = '2026-08-01T13:00:00.000Z'
const scanRetryAt = '2026-08-01T13:01:00.000Z'
const commitAt = '2026-08-01T13:02:00.000Z'
const commitRetryAt = '2026-08-01T13:03:00.000Z'
const finalizeAt = '2026-08-01T13:04:00.000Z'
const finalizeRetryAt = '2026-08-01T13:05:00.000Z'
const nextScanAt = '2026-08-01T13:06:00.000Z'
const leaseExpiresAt = '2026-08-01T13:10:00.000Z'

const generousBudget: PortableScanBudget = {
  maxLedgers: 48,
  maxTransactions: 1_000,
  maxDecodedBytes: 10_000_000,
  maxNormalizedBytes: 10_000_000,
  maxPayloadBytes: 10_000_000,
  maxExternalRequests: 1_000,
}

function transactionHash(index: number): string {
  return index.toString(16).toUpperCase().padStart(64, '0')
}

function candidate(
  semanticClass: NormalizedSemanticClassV1,
  canonicalKey: string,
  identityIndex: number,
  overrides: Partial<NormalizedCandidateV1> = {},
): NormalizedCandidateV1 {
  return {
    semanticClass,
    canonicalKey,
    sourceLedgerIndex: ledgerIndex,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash:
      semanticClass === 'validated-ledger' ? null : transactionHash(identityIndex + 1),
    objectId: null,
    relationshipIds: ['vault:1', 'broker:1', 'vault:1'],
    isTombstone: false,
    value: { canonicalKey, semanticClass },
    ...overrides,
  }
}

function fixtureRange(extraProtocolEvents = 0): PortableFixtureNormalizedRange {
  return {
    startLedgerIndex: ledgerIndex,
    endLedgerIndex: ledgerIndex,
    finalLedgerHash: ledgerHash,
    ledgers: [
      candidate('validated-ledger', 'ledger:101', 0, {
        relationshipIds: [],
        value: { ledgerIndex, ledgerHash, parentHash: baseHash },
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

function estimate(transactionCount: number): PortableLedgerCostEstimate {
  return {
    ledgerIndex,
    transactionCount,
    decodedBytes: 10_000,
    normalizedBytes: 10_000,
    payloadBytes: 20_000,
    externalRequests: 1,
  }
}

function initialScanMessage(overrides: Partial<ScanPhaseMessageV1> = {}): ScanPhaseMessageV1 {
  return buildScanPhaseMessage({
    network: overrides.network ?? workNetwork,
    epochId: overrides.epochId ?? epochId,
    baseIdentity: overrides.baseIdentity ?? baseIdentity,
    expectedPreviousLedgerIndex:
      overrides.expectedPreviousLedgerIndex ?? baseLedgerIndex,
    expectedPreviousLedgerHash: overrides.expectedPreviousLedgerHash ?? baseHash,
    scanSequence: overrides.scanSequence ?? 0,
  })
}

function fixtureOptions(options: {
  range?: PortableFixtureNormalizedRange
  validatedHeadLedgerIndex?: number
  budget?: PortableScanBudget
  estimates?: PortableLedgerCostEstimate[]
  retryAvailableAt?: string
  failures?: PortableFixtureExecutionOptions['failures']
} = {}): PortableFixtureExecutionOptions {
  const range = options.range ?? fixtureRange()
  return {
    network: workNetwork,
    epochId,
    baseIdentity,
    immutableBaseLedgerIndex: baseLedgerIndex,
    immutableBaseLedgerHash: baseHash,
    validatedHeadLedgerIndex: options.validatedHeadLedgerIndex ?? ledgerIndex,
    budget: options.budget ?? generousBudget,
    estimates: options.estimates ?? [estimate(range.protocolEvents.length)],
    ranges: options.validatedHeadLedgerIndex === baseLedgerIndex ? [] : [range],
    commitSuccessorAvailableAt: commitAt,
    caughtUpSuccessorAvailableAt: nextScanAt,
    retryAvailableAt: options.retryAvailableAt ?? scanRetryAt,
    failures: options.failures,
  }
}

function finalizeExecution(options: {
  retryAvailableAt?: string
  afterFinalizeMutation?: () => void
} = {}): PortableFinalizeExecutionAdapter {
  return {
    nextScanAvailableAt: nextScanAt,
    retryAvailableAt: options.retryAvailableAt ?? finalizeRetryAt,
    afterFinalizeMutation: options.afterFinalizeMutation,
  }
}

function createRuntime(): RuntimeState {
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
  const db = new NodeSqliteR2ExitDatabase(database)
  return {
    database,
    db,
    store: new PortableCollectorReferenceStore(db),
    scheduler: new PortableCollectorScheduler(db),
  }
}

function restoreRuntime(exported: string): RuntimeState {
  const runtime = createRuntime()
  restorePortableCollectorRuntimeState(runtime.db, exported)
  expect(exportPortableCollectorRuntimeState(runtime.db)).toBe(exported)
  return runtime
}

function parseOutboxSuccessor(
  scheduler: PortableCollectorScheduler,
  currentMessageId: string,
): PortableCollectorPhaseMessageV1 {
  const outbox = scheduler.getOutbox(currentMessageId)
  if (!outbox) throw new Error(`successor outbox not found: ${currentMessageId}`)
  return parsePortablePhaseMessage(outbox.successorPayloadJson)
}

async function executeScan(options: {
  runtime: RuntimeState
  message: ScanPhaseMessageV1
  execution: FixtureExecutionAdapter
  now?: string
  leaseOwner?: string
}) {
  return new PortableCollectorScanRuntime(
    options.runtime.store,
    options.runtime.scheduler,
    options.execution,
  ).execute(options.message.messageId, {
    leaseOwner: options.leaseOwner ?? 'scan-worker',
    now: options.now ?? t0,
    leaseExpiresAt,
  })
}

async function executeCommit(options: {
  runtime: RuntimeState
  messageId: string
  execution: FixtureExecutionAdapter
  now?: string
}) {
  return new PortableCollectorCommitRuntime(
    options.runtime.store,
    options.runtime.scheduler,
    options.execution,
  ).execute(options.messageId, {
    leaseOwner: 'commit-worker',
    now: options.now ?? commitAt,
    leaseExpiresAt,
  })
}

async function executeFinalize(options: {
  runtime: RuntimeState
  messageId: string
  execution?: PortableFinalizeExecutionAdapter
  now?: string
}) {
  return new PortableCollectorFinalizeRuntime(
    options.runtime.store,
    options.runtime.scheduler,
    options.execution ?? finalizeExecution(),
  ).execute(options.messageId, {
    leaseOwner: 'finalize-worker',
    now: options.now ?? finalizeAt,
    leaseExpiresAt,
  })
}

async function stageScan(options: {
  runtime: RuntimeState
  range: PortableFixtureNormalizedRange
  execution?: FixtureExecutionAdapter
}) {
  const scan = initialScanMessage()
  options.runtime.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
  const result = await executeScan({
    runtime: options.runtime,
    message: scan,
    execution: options.execution ?? new FixtureExecutionAdapter(fixtureOptions({ range: options.range })),
  })
  expect(result.status).toBe('completed')
  if (result.status !== 'completed') throw new Error('scan did not complete')
  expect(result.result.status).toBe('staged')
  return {
    scan,
    workId: String(result.result.workId),
    chunkCount: Number(result.result.payloadChunks),
  }
}

async function runCommits(options: {
  runtime: RuntimeState
  scanMessageId: string
  chunkCount: number
  execution?: FixtureExecutionAdapter
  startAt?: number
}) {
  const execution =
    options.execution ?? new FixtureExecutionAdapter(fixtureOptions({ retryAvailableAt: commitRetryAt }))
  let currentMessageId = options.scanMessageId
  for (let chunkIndex = options.startAt ?? 0; chunkIndex < options.chunkCount; chunkIndex += 1) {
    options.runtime.scheduler.dispatchNextOutbox({ now: commitAt })
    const successor = parseOutboxSuccessor(options.runtime.scheduler, currentMessageId)
    expect(successor).toEqual(buildCommitPhaseMessage({ workId: successor.phase === 'commit' ? successor.workId : '', chunkIndex }))
    if (successor.phase !== 'commit') throw new Error('expected commit successor')
    const result = await executeCommit({
      runtime: options.runtime,
      messageId: successor.messageId,
      execution,
      now: commitAt,
    })
    expect(result.status).toBe('completed')
    currentMessageId = successor.messageId
    expect(options.runtime.store.listCommittedReferenceRows()).toEqual([])
    expect(
      options.runtime.store.getWatermark(workNetwork, epochId, baseIdentity),
    ).toBeUndefined()
  }
  return {
    lastCommitMessageId: currentMessageId,
    finalizeMessage: parseOutboxSuccessor(options.runtime.scheduler, currentMessageId),
  }
}

describe('R2 parent portable orchestration exit', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('runs sparse scan -> commit -> finalize -> next scan with all seven classes', async () => {
    const runtime = createRuntime()
    const range = fixtureRange()
    const staged = await stageScan({ runtime, range })

    expect(staged.chunkCount).toBe(1)
    expect(runtime.store.listReferenceRowsForWork(staged.workId)).toEqual([])
    expect(runtime.store.listCommittedReferenceRows()).toEqual([])
    expect(runtime.store.getWatermark(workNetwork, epochId, baseIdentity)).toBeUndefined()

    const committed = await runCommits({
      runtime,
      scanMessageId: staged.scan.messageId,
      chunkCount: staged.chunkCount,
    })
    expect(committed.finalizeMessage.phase).toBe('finalize')
    if (committed.finalizeMessage.phase !== 'finalize') {
      throw new Error('expected finalize successor')
    }

    runtime.scheduler.dispatchNextOutbox({ now: finalizeAt })
    const finalized = await executeFinalize({
      runtime,
      messageId: committed.finalizeMessage.messageId,
    })
    expect(finalized.status).toBe('completed')

    const committedRows = runtime.store.listCommittedReferenceRows()
    expect(committedRows).toHaveLength(7)
    expect(new Set(committedRows.map((row) => row.semanticClass))).toEqual(
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
    expect(committedRows.find((row) => row.canonicalKey === 'event:000')).toMatchObject({
      sourceTransactionHash: transactionHash(2),
      objectId: null,
      relationshipIds: ['broker:1', 'vault:1'],
    })
    expect(runtime.store.getWatermark(workNetwork, epochId, baseIdentity)).toMatchObject({
      ledgerIndex,
      ledgerHash,
      workId: staged.workId,
    })

    const nextScan = parseOutboxSuccessor(runtime.scheduler, committed.finalizeMessage.messageId)
    expect(nextScan).toMatchObject({
      phase: 'scan',
      expectedPreviousLedgerIndex: ledgerIndex,
      expectedPreviousLedgerHash: ledgerHash,
      scanSequence: 0,
    })
    runtime.scheduler.dispatchNextOutbox({ now: nextScanAt })
    expect(runtime.scheduler.getMessage(nextScan.messageId)).toMatchObject({ status: 'pending' })
    expect(runtime.scheduler.dispatchNextOutbox({ now: nextScanAt })).toBeUndefined()

    const duplicate = await executeFinalize({
      runtime,
      messageId: committed.finalizeMessage.messageId,
      now: nextScanAt,
    })
    expect(duplicate.status).toBe('duplicate')
    expect(runtime.store.listCommittedReferenceRows()).toHaveLength(7)
  })

  it('resumes a dense multi-chunk chain from staged, committing, and committed exports', async () => {
    const source = createRuntime()
    const range = fixtureRange(40)
    const staged = await stageScan({ runtime: source, range })
    expect(staged.chunkCount).toBeGreaterThan(1)

    let runtime = restoreRuntime(exportPortableCollectorRuntimeState(source.db))
    expect(runtime.store.getWork(staged.workId)?.status).toBe('staged')
    expect(runtime.store.listCommittedReferenceRows()).toEqual([])

    runtime.scheduler.dispatchNextOutbox({ now: commitAt })
    const firstCommit = parseOutboxSuccessor(runtime.scheduler, staged.scan.messageId)
    if (firstCommit.phase !== 'commit') throw new Error('expected first commit')
    const firstResult = await executeCommit({
      runtime,
      messageId: firstCommit.messageId,
      execution: new FixtureExecutionAdapter(fixtureOptions({ retryAvailableAt: commitRetryAt })),
    })
    expect(firstResult.status).toBe('completed')
    expect(runtime.store.getWork(staged.workId)?.status).toBe('committing')
    expect(runtime.store.listCommittedReferenceRows()).toEqual([])

    runtime = restoreRuntime(exportPortableCollectorRuntimeState(runtime.db))
    expect(runtime.store.getWork(staged.workId)?.status).toBe('committing')
    let currentMessageId = firstCommit.messageId
    for (let chunkIndex = 1; chunkIndex < staged.chunkCount; chunkIndex += 1) {
      runtime.scheduler.dispatchNextOutbox({ now: commitAt })
      const message = parseOutboxSuccessor(runtime.scheduler, currentMessageId)
      if (message.phase !== 'commit') throw new Error('expected remaining commit')
      expect(message.chunkIndex).toBe(chunkIndex)
      const result = await executeCommit({
        runtime,
        messageId: message.messageId,
        execution: new FixtureExecutionAdapter(fixtureOptions({ retryAvailableAt: commitRetryAt })),
      })
      expect(result.status).toBe('completed')
      currentMessageId = message.messageId
    }

    const finalizeMessage = parseOutboxSuccessor(runtime.scheduler, currentMessageId)
    if (finalizeMessage.phase !== 'finalize') throw new Error('expected finalize')
    runtime.scheduler.dispatchNextOutbox({ now: finalizeAt })
    const finalized = await executeFinalize({ runtime, messageId: finalizeMessage.messageId })
    expect(finalized.status).toBe('completed')
    expect(runtime.store.listCommitChunks(staged.workId)).toHaveLength(staged.chunkCount)
    expect(runtime.store.listCommittedReferenceRows()).toHaveLength(47)

    const committed = restoreRuntime(exportPortableCollectorRuntimeState(runtime.db))
    expect(committed.store.getWork(staged.workId)?.status).toBe('committed')
    expect(committed.store.listCommittedReferenceRows()).toHaveLength(47)
    expect(committed.store.getWatermark(workNetwork, epochId, baseIdentity)).toMatchObject({
      ledgerIndex,
      ledgerHash,
    })
  })

  it('recovers the same phase identities after scan, commit, and finalize interruptions', async () => {
    const runtime = createRuntime()
    const range = fixtureRange()
    const scan = initialScanMessage()
    runtime.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    const scanExecution = new FixtureExecutionAdapter(
      fixtureOptions({
        range,
        retryAvailableAt: scanRetryAt,
        failures: [
          {
            stage: 'after_scan_staging',
            classification: 'retryable_storage',
            message: 'injected scan interruption',
          },
        ],
      }),
    )

    const failedScan = await executeScan({ runtime, message: scan, execution: scanExecution })
    expect(failedScan).toMatchObject({
      status: 'retry_scheduled',
      messageId: scan.messageId,
    })
    expect(runtime.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
    const completedScan = await executeScan({
      runtime,
      message: scan,
      execution: scanExecution,
      now: scanRetryAt,
    })
    expect(completedScan.status).toBe('completed')
    if (completedScan.status !== 'completed') throw new Error('scan retry did not complete')
    const workId = String(completedScan.result.workId)

    runtime.scheduler.dispatchNextOutbox({ now: commitAt })
    const commitMessage = parseOutboxSuccessor(runtime.scheduler, scan.messageId)
    if (commitMessage.phase !== 'commit') throw new Error('expected commit')
    const commitExecution = new FixtureExecutionAdapter(
      fixtureOptions({
        range,
        retryAvailableAt: commitRetryAt,
        failures: [
          {
            stage: 'after_commit_mutation',
            classification: 'retryable_storage',
            message: 'injected commit interruption',
          },
        ],
      }),
    )
    const failedCommit = await executeCommit({
      runtime,
      messageId: commitMessage.messageId,
      execution: commitExecution,
    })
    expect(failedCommit).toMatchObject({
      status: 'retry_scheduled',
      messageId: commitMessage.messageId,
    })
    expect(runtime.store.listReferenceRowsForWork(workId)).toEqual([])
    expect(runtime.store.listCommitChunks(workId)).toEqual([])
    const completedCommit = await executeCommit({
      runtime,
      messageId: commitMessage.messageId,
      execution: commitExecution,
      now: commitRetryAt,
    })
    expect(completedCommit.status).toBe('completed')

    const finalizeMessage = parseOutboxSuccessor(runtime.scheduler, commitMessage.messageId)
    if (finalizeMessage.phase !== 'finalize') throw new Error('expected finalize')
    runtime.scheduler.dispatchNextOutbox({ now: finalizeAt })
    let finalizeFailures = 1
    const failedFinalize = await executeFinalize({
      runtime,
      messageId: finalizeMessage.messageId,
      execution: finalizeExecution({
        retryAvailableAt: finalizeRetryAt,
        afterFinalizeMutation: () => {
          if (finalizeFailures > 0) {
            finalizeFailures -= 1
            throw new PortableFinalizeExecutionError(
              'retryable_storage',
              'injected finalize interruption',
            )
          }
        },
      }),
    })
    expect(failedFinalize).toMatchObject({
      status: 'retry_scheduled',
      messageId: finalizeMessage.messageId,
    })
    expect(runtime.store.getWork(workId)?.status).toBe('committing')
    expect(runtime.store.listCommittedReferenceRows()).toEqual([])
    expect(runtime.store.getWatermark(workNetwork, epochId, baseIdentity)).toBeUndefined()

    const completedFinalize = await executeFinalize({
      runtime,
      messageId: finalizeMessage.messageId,
      execution: finalizeExecution({
        retryAvailableAt: finalizeRetryAt,
        afterFinalizeMutation: () => {
          if (finalizeFailures > 0) throw new Error('unexpected second failure')
        },
      }),
      now: finalizeRetryAt,
    })
    expect(completedFinalize.status).toBe('completed')
    expect(runtime.store.listCommittedReferenceRows()).toHaveLength(7)
    expect(runtime.store.getWatermark(workNetwork, epochId, baseIdentity)?.ledgerIndex).toBe(
      ledgerIndex,
    )
  })

  it('preserves one scan identity across fresh-lease rejection, stale reclaim, and duplicate delivery', async () => {
    const runtime = createRuntime()
    const scan = initialScanMessage()
    runtime.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    runtime.scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: scanRetryAt,
    })
    const execution = new FixtureExecutionAdapter(fixtureOptions({ range: fixtureRange() }))

    const fresh = await executeScan({
      runtime,
      message: scan,
      execution,
      now: t0,
      leaseOwner: 'worker-b',
    })
    expect(fresh).toMatchObject({ status: 'unavailable', reason: 'fresh_lease' })

    const reclaimed = await executeScan({
      runtime,
      message: scan,
      execution,
      now: scanRetryAt,
      leaseOwner: 'worker-b',
    })
    expect(reclaimed.status).toBe('completed')
    expect(runtime.scheduler.getMessage(scan.messageId)).toMatchObject({
      status: 'completed',
      attemptCount: 2,
    })

    const duplicate = await executeScan({
      runtime,
      message: scan,
      execution,
      now: commitAt,
      leaseOwner: 'worker-c',
    })
    expect(duplicate.status).toBe('duplicate')
    expect(runtime.scheduler.dispatchNextOutbox({ now: commitAt })).toMatchObject({
      status: 'dispatched',
    })
    expect(runtime.scheduler.dispatchNextOutbox({ now: commitAt })).toBeUndefined()
  })

  it.each([
    {
      name: 'reset',
      message: initialScanMessage(),
      options: fixtureOptions({ validatedHeadLedgerIndex: 99, estimates: [] }),
      classification: 'reset_detected',
    },
    {
      name: 'epoch mismatch',
      message: initialScanMessage({ epochId: 'epoch-other' }),
      options: fixtureOptions(),
      classification: 'epoch_mismatch',
    },
    {
      name: 'base mismatch',
      message: initialScanMessage({ baseIdentity: 'base-other' }),
      options: fixtureOptions(),
      classification: 'base_mismatch',
    },
    {
      name: 'stale boundary',
      message: initialScanMessage({ expectedPreviousLedgerIndex: 99 }),
      options: fixtureOptions(),
      classification: 'stale_boundary',
    },
    {
      name: 'parent hash mismatch',
      message: initialScanMessage({ expectedPreviousLedgerHash: 'F'.repeat(64) }),
      options: fixtureOptions(),
      classification: 'parent_hash_mismatch',
    },
    {
      name: 'resource halt',
      message: initialScanMessage(),
      options: fixtureOptions({
        budget: { ...generousBudget, maxTransactions: 1 },
        estimates: [estimate(2)],
      }),
      classification: 'resource_halt',
    },
  ])('halts $name without work, cursor, or successor', async ({ message, options, classification }) => {
    const runtime = createRuntime()
    runtime.scheduler.enqueue(message, { availableAt: t0, createdAt: t0 })
    const result = await executeScan({
      runtime,
      message,
      execution: new FixtureExecutionAdapter(options),
    })

    expect(result).toMatchObject({ status: 'halted', classification })
    expect(runtime.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM collector_work')?.count).toBe(0)
    expect(runtime.store.getWatermark(workNetwork, epochId, baseIdentity)).toBeUndefined()
    expect(runtime.scheduler.getOutbox(message.messageId)).toBeUndefined()
  })

  it('imports only provider-neutral relative modules in the portable runtime surface', () => {
    for (const path of [
      'src/shared/portable-collector-messages.ts',
      'src/shared/portable-collector-planner.ts',
      'src/shared/portable-collector-reference-store.ts',
      'src/shared/portable-collector-scheduler.ts',
      'src/shared/portable-collector-scan-runtime.ts',
      'src/shared/portable-collector-commit-runtime.ts',
      'src/shared/portable-collector-finalize-runtime.ts',
      'src/shared/portable-collector-runtime-state.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
        (match) => match[1],
      )
      expect(specifiers.every((specifier) => specifier?.startsWith('.'))).toBe(true)
    }
  })
})
