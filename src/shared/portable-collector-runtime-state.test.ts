import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildCommitPhaseMessage,
  buildFinalizePhaseMessage,
  buildScanPhaseMessage,
  parsePortablePhaseMessage,
} from './portable-collector-messages'
import {
  exportPortableCollectorRuntimeState,
  restorePortableCollectorRuntimeState,
} from './portable-collector-runtime-state'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'

class NodeSqliteRuntimeDatabase implements PortableSqliteDatabase {
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

function createRuntimeDatabase(): {
  database: DatabaseSync
  adapter: NodeSqliteRuntimeDatabase
  scheduler: PortableCollectorScheduler
  store: PortableCollectorReferenceStore
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
  const adapter = new NodeSqliteRuntimeDatabase(database)
  return {
    database,
    adapter,
    scheduler: new PortableCollectorScheduler(adapter),
    store: new PortableCollectorReferenceStore(adapter),
  }
}

const t0 = '2026-08-01T09:00:00.000Z'
const parentHash = 'A'.repeat(64)
const ledgerHash = 'B'.repeat(64)
const transactionHash = 'C'.repeat(64)
function minute(value: number): string {
  return new Date(Date.parse(t0) + value * 60_000).toISOString()
}

const scan = buildScanPhaseMessage({
  network: 'devnet',
  epochId: 'epoch-1',
  baseIdentity: 'base-100',
  expectedPreviousLedgerIndex: 100,
  expectedPreviousLedgerHash: parentHash,
  scanSequence: 3,
})
const commit = buildCommitPhaseMessage({ workId: 'work-101', chunkIndex: 0 })
const finalize = buildFinalizePhaseMessage({ workId: 'work-other' })

function stageIdentityRow(store: PortableCollectorReferenceStore): void {
  store.beginWork({
    workId: 'work-101',
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: parentHash,
    plannedEndLedgerIndex: 101,
    planJson: '{"runtime":3}',
    createdAt: t0,
  })
  store.stageReferenceRow({
    workId: 'work-101',
    semanticClass: 'object-change',
    canonicalKey: 'change:1',
    sourceLedgerIndex: 101,
    sourceLedgerHash: ledgerHash,
    sourceTransactionHash: transactionHash,
    objectId: 'loan:1',
    relationshipIds: ['vault:1', 'broker:1', 'vault:1'],
    valueJson: '{"changed":true}',
    isTombstone: false,
    createdAt: t0,
  })
}

describe('portable collector complete runtime state', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('restores identity rows, leased messages, and timed outbox entries exactly', () => {
    const source = createRuntimeDatabase()
    stageIdentityRow(source.store)
    source.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    source.scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: minute(5),
    })
    source.scheduler.completeWithSuccessor({
      messageId: scan.messageId,
      leaseOwner: 'worker-a',
      now: minute(1),
      result: { status: 'staged', workId: 'work-101' },
      successor: commit,
      successorAvailableAt: minute(4),
    })

    source.scheduler.enqueue(finalize, { availableAt: minute(1), createdAt: minute(1) })
    source.scheduler.claim(finalize.messageId, {
      leaseOwner: 'worker-b',
      now: minute(1),
      leaseExpiresAt: minute(7),
    })

    const exportedState = exportPortableCollectorRuntimeState(source.adapter)
    expect((JSON.parse(exportedState) as { schemaVersion: number }).schemaVersion).toBe(3)
    const target = createRuntimeDatabase()
    restorePortableCollectorRuntimeState(target.adapter, exportedState)

    expect(exportPortableCollectorRuntimeState(target.adapter)).toBe(exportedState)
    expect(target.store.listReferenceRowsForWork('work-101')).toEqual([
      {
        workId: 'work-101',
        semanticClass: 'object-change',
        canonicalKey: 'change:1',
        sourceLedgerIndex: 101,
        sourceLedgerHash: ledgerHash,
        sourceTransactionHash: transactionHash,
        objectId: 'loan:1',
        relationshipIds: ['broker:1', 'vault:1'],
        valueJson: '{"changed":true}',
        isTombstone: false,
        createdAt: t0,
      },
    ])
    const restoredScan = target.scheduler.getMessage(scan.messageId)
    expect(restoredScan).toMatchObject({
      status: 'completed',
      attemptCount: 1,
    })
    expect(parsePortablePhaseMessage(restoredScan!.payloadJson)).toMatchObject({
      messageId: scan.messageId,
      scanSequence: 3,
    })
    expect(target.scheduler.getMessage(finalize.messageId)).toMatchObject({
      status: 'leased',
      leaseOwner: 'worker-b',
      leaseExpiresAt: minute(7),
      attemptCount: 1,
    })
    expect(target.scheduler.getOutbox(scan.messageId)).toMatchObject({
      status: 'pending',
      successorMessageId: commit.messageId,
      successorAvailableAt: minute(4),
    })
  })

  it('rejects unsupported older runtime exports', () => {
    const source = createRuntimeDatabase()
    const parsed = JSON.parse(exportPortableCollectorRuntimeState(source.adapter)) as Record<
      string,
      unknown
    >
    parsed.schemaVersion = 2
    expect(() =>
      restorePortableCollectorRuntimeState(
        createRuntimeDatabase().adapter,
        JSON.stringify(parsed),
      ),
    ).toThrow('unsupported portable runtime export schema version')
  })

  it('rejects non-empty restore targets without changing existing state', () => {
    const source = createRuntimeDatabase()
    source.scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    const exportedState = exportPortableCollectorRuntimeState(source.adapter)

    const target = createRuntimeDatabase()
    target.scheduler.enqueue(finalize, { availableAt: t0, createdAt: t0 })
    const before = exportPortableCollectorRuntimeState(target.adapter)

    expect(() => restorePortableCollectorRuntimeState(target.adapter, exportedState)).toThrow(
      'runtime restore target is not empty',
    )
    expect(exportPortableCollectorRuntimeState(target.adapter)).toBe(before)
  })
})
