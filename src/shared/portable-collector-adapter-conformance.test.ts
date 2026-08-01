import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertPortableAdapterSet,
  PortableCollectorAdapterRuntime,
} from './portable-collector-adapter-runtime'
import type {
  PortableCollectorMaintenanceAdapter,
  PortableCollectorPublicationAdapter,
  PortableCollectorRuntimeAdapters,
  PortableMaintenancePlanV1,
  PortablePublicationCandidateV1,
  PortableVerifiedPublicationV1,
} from './portable-collector-adapters'
import {
  PortableFinalizeExecutionError,
} from './portable-collector-finalize-runtime'
import {
  buildScanPhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'
import type { NormalizedCandidateV1, NormalizedSemanticClassV1 } from './portable-collector-payload'
import type { PortableScanBudget } from './portable-collector-planner'
import type {
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  createSqlitePortableCollectorAdapters,
} from './portable-collector-sqlite-adapters'
import { FixtureExecutionAdapter } from './portable-collector-fixture-execution'

class NodeSqliteAdapterDatabase implements PortableSqliteDatabase {
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
const t0 = '2026-08-01T14:00:00.000Z'
const commitAt = '2026-08-01T14:01:00.000Z'
const finalizeAt = '2026-08-01T14:02:00.000Z'
const retryAt = '2026-08-01T14:03:00.000Z'
const nextScanAt = '2026-08-01T14:04:00.000Z'
const leaseExpiresAt = '2026-08-01T14:10:00.000Z'
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
    value: { semanticClass, canonicalKey },
    ...overrides,
  }
}

function execution() {
  return new FixtureExecutionAdapter({
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    immutableBaseLedgerIndex: 100,
    immutableBaseLedgerHash: baseHash,
    validatedHeadLedgerIndex: 101,
    budget,
    estimates: [
      {
        ledgerIndex: 101,
        transactionCount: 6,
        decodedBytes: 1_000,
        normalizedBytes: 1_000,
        payloadBytes: 2_000,
        externalRequests: 1,
      },
    ],
    ranges: [
      {
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        finalLedgerHash: ledgerHash,
        ledgers: [
          candidate('validated-ledger', 'ledger:101', 0, {
            relationshipIds: [],
            value: { ledgerIndex: 101, ledgerHash, parentHash: baseHash },
          }),
        ],
        protocolEvents: [candidate('protocol-event', 'event:1', 1)],
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
          }),
        ],
      },
    ],
    commitSuccessorAvailableAt: commitAt,
    caughtUpSuccessorAvailableAt: nextScanAt,
    retryAvailableAt: retryAt,
  })
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
  const db = new NodeSqliteAdapterDatabase(database)
  const sqlite = createSqlitePortableCollectorAdapters(db)
  return { database, db, ...sqlite }
}

function runtimeOptions(leaseOwner: string, now: string) {
  return { leaseOwner, now, leaseExpiresAt }
}

async function stageAndCommit(options: {
  adapters: PortableCollectorRuntimeAdapters
  runtime: PortableCollectorAdapterRuntime
}) {
  const scan = buildScanPhaseMessage({
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    expectedPreviousLedgerIndex: 100,
    expectedPreviousLedgerHash: baseHash,
    scanSequence: 0,
  })
  options.adapters.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
  const scanResult = await options.runtime.executeScan(
    scan.messageId,
    runtimeOptions('scan-worker', t0),
  )
  expect(scanResult.status).toBe('completed')
  if (scanResult.status !== 'completed') throw new Error('scan did not complete')
  const workId = String(scanResult.result.workId)

  options.adapters.scheduler.dispatchNextOutbox({ now: commitAt })
  const commitMessage = parsePortablePhaseMessage(
    options.adapters.scheduler.getOutbox(scan.messageId)!.successorPayloadJson,
  )
  if (commitMessage.phase !== 'commit') throw new Error('expected commit message')
  const commitResult = await options.runtime.executeCommit(
    commitMessage.messageId,
    runtimeOptions('commit-worker', commitAt),
  )
  expect(commitResult.status).toBe('completed')

  const finalizeMessage = parsePortablePhaseMessage(
    options.adapters.scheduler.getOutbox(commitMessage.messageId)!.successorPayloadJson,
  )
  if (finalizeMessage.phase !== 'finalize') throw new Error('expected finalize message')
  options.adapters.scheduler.dispatchNextOutbox({ now: finalizeAt })
  return { workId, finalizeMessage }
}

describe('R3A portable adapter conformance', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('runs the R2 state machine through interface-typed SQLite adapters', async () => {
    const state = createDatabase()
    const adapters = assertPortableAdapterSet({
      storage: state.storage,
      scheduler: state.scheduler,
      execution: execution(),
      finalizeExecution: {
        nextScanAvailableAt: nextScanAt,
        retryAvailableAt: retryAt,
      },
    })
    const runtime = new PortableCollectorAdapterRuntime(adapters)
    const staged = await stageAndCommit({ adapters, runtime })

    expect(adapters.storage.listCommittedReferenceRows()).toEqual([])
    expect(adapters.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()

    const result = await runtime.executeFinalize(
      staged.finalizeMessage.messageId,
      runtimeOptions('finalize-worker', finalizeAt),
    )
    expect(result.status).toBe('completed')
    expect(adapters.storage.listCommittedReferenceRows()).toHaveLength(7)
    expect(adapters.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
      ledgerIndex: 101,
      ledgerHash,
      workId: staged.workId,
    })
    const nextScan = parsePortablePhaseMessage(
      adapters.scheduler.getOutbox(staged.finalizeMessage.messageId)!.successorPayloadJson,
    )
    expect(nextScan).toMatchObject({
      phase: 'scan',
      expectedPreviousLedgerIndex: 101,
      expectedPreviousLedgerHash: ledgerHash,
      scanSequence: 0,
    })
  })

  it('preserves atomic rollback through the interface bridge', async () => {
    const state = createDatabase()
    let failures = 1
    const adapters = assertPortableAdapterSet({
      storage: state.storage,
      scheduler: state.scheduler,
      execution: execution(),
      finalizeExecution: {
        nextScanAvailableAt: nextScanAt,
        retryAvailableAt: retryAt,
        afterFinalizeMutation: () => {
          if (failures > 0) {
            failures -= 1
            throw new PortableFinalizeExecutionError(
              'retryable_storage',
              'injected adapter finalize interruption',
            )
          }
        },
      },
    })
    const runtime = new PortableCollectorAdapterRuntime(adapters)
    const staged = await stageAndCommit({ adapters, runtime })

    const failed = await runtime.executeFinalize(
      staged.finalizeMessage.messageId,
      runtimeOptions('finalize-worker', finalizeAt),
    )
    expect(failed).toMatchObject({
      status: 'retry_scheduled',
      messageId: staged.finalizeMessage.messageId,
    })
    expect(adapters.storage.getWork(staged.workId)?.status).toBe('committing')
    expect(adapters.storage.listCommittedReferenceRows()).toEqual([])
    expect(adapters.storage.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
    expect(adapters.scheduler.getOutbox(staged.finalizeMessage.messageId)).toBeUndefined()

    const completed = await runtime.executeFinalize(
      staged.finalizeMessage.messageId,
      runtimeOptions('finalize-worker', retryAt),
    )
    expect(completed.status).toBe('completed')
    expect(adapters.storage.listCommittedReferenceRows()).toHaveLength(7)
  })

  it('keeps publication and maintenance contracts separate from collection', async () => {
    const publication: PortableCollectorPublicationAdapter = {
      selectCommittedAfter: () => [],
      buildCandidate: async (): Promise<PortablePublicationCandidateV1> => ({
        schemaVersion: 1,
        publicationId: 'publication-1',
        previousPublicationId: null,
        works: [],
        manifestJson: '{"schemaVersion":1}',
        manifestDigest: 'A'.repeat(64),
      }),
      verifyCandidate: async (candidate): Promise<PortableVerifiedPublicationV1> => ({
        ...candidate,
        verifiedAt: t0,
      }),
      advancePublicationWatermark: () => undefined,
    }
    const maintenance: PortableCollectorMaintenanceAdapter = {
      buildPlan: ({ verifiedPublication }): PortableMaintenancePlanV1 => ({
        schemaVersion: 1,
        planId: `plan:${verifiedPublication.publicationId}`,
        verifiedPublicationId: verifiedPublication.publicationId,
        mutations: [],
      }),
      applyPlan: () => ({ appliedMutations: 0 }),
    }

    const candidate = await publication.buildCandidate([])
    const verified = await publication.verifyCandidate(candidate)
    const plan = maintenance.buildPlan({
      verifiedPublication: verified,
      retainCommittedWorks: 2,
      maxMutations: 40,
    })
    expect(plan.verifiedPublicationId).toBe(verified.publicationId)
    expect(maintenance.applyPlan(plan)).toEqual({ appliedMutations: 0 })
  })

  it('imports no hosted-provider SDK in the R3A adapter surface', () => {
    for (const path of [
      'src/shared/portable-collector-adapters.ts',
      'src/shared/portable-collector-sqlite-adapters.ts',
      'src/shared/portable-collector-adapter-runtime.ts',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/gu)].map(
        (match) => match[1],
      )
      expect(specifiers.every((specifier) => specifier?.startsWith('.'))).toBe(true)
      expect(source).not.toMatch(/cloudflare|wrangler|D1Database|Queue/iu)
    }
  })
})
