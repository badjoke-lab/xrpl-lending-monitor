import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { buildCommitPhaseMessage, buildScanPhaseMessage } from './portable-collector-messages'
import {
  PortableCollectorReferenceStore,
  type PortableSqliteDatabase,
  type PortableSqliteValue,
} from './portable-collector-reference-store'
import {
  exportPortableCollectorRuntimeState,
  restorePortableCollectorRuntimeState,
} from './portable-collector-runtime-state'
import { PortableCollectorScheduler } from './portable-collector-scheduler'

class NodeSqliteResumptionDatabase implements PortableSqliteDatabase {
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
const t0 = '2026-08-01T12:30:00.000Z'
const parentHash = 'A'.repeat(64)
const finalHash = 'B'.repeat(64)
const transactionHash = 'C'.repeat(64)
const workId = 'work-101'

type RuntimeState = 'staged' | 'committing' | 'committed'

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
  const db = new NodeSqliteResumptionDatabase(database)
  return {
    database,
    db,
    store: new PortableCollectorReferenceStore(db),
    scheduler: new PortableCollectorScheduler(db),
  }
}

function createState(state: RuntimeState) {
  const runtime = createDatabase()
  runtime.store.beginWork({
    workId,
    network: 'devnet',
    epochId: 'epoch-1',
    baseIdentity: 'base-100',
    previousLedgerIndex: 100,
    expectedParentHash: parentHash,
    plannedEndLedgerIndex: 101,
    planJson: '{"resume":true}',
    createdAt: t0,
  })
  runtime.store.stagePayloadChunk({
    workId,
    chunkIndex: 0,
    encoding: 'normalized-payload-chunk-json-v1',
    payload: new TextEncoder().encode('{"fixture":true}'),
    payloadDigest: 'chunk-digest',
    recordCount: 1,
    createdAt: t0,
  })
  runtime.store.stageReferenceRow({
    workId,
    semanticClass: 'object-change',
    canonicalKey: 'change:1',
    sourceLedgerIndex: 101,
    sourceLedgerHash: finalHash,
    sourceTransactionHash: transactionHash,
    objectId: 'loan:1',
    relationshipIds: ['vault:1', 'broker:1'],
    valueJson: '{"changed":true}',
    isTombstone: false,
    createdAt: t0,
  })
  runtime.store.sealScan({
    workId,
    scannedEndLedgerIndex: 101,
    finalLedgerHash: finalHash,
    semanticCountsJson: '{"objectChanges":1,"totalRecords":1}',
    payloadDigest: 'payload-digest',
    expectedPayloadChunks: 1,
    expectedCommitChunks: 1,
    updatedAt: t0,
  })

  if (state !== 'staged') {
    runtime.store.completeCommitChunk({
      workId,
      chunkIndex: 0,
      operationCount: 1,
      rowMutationCount: 1,
      chunkDigest: 'chunk-digest',
      completedAt: t0,
    })
  }
  if (state === 'committed') {
    runtime.store.finalizeWork({ workId, committedAt: t0 })
    runtime.scheduler.enqueue(
      buildScanPhaseMessage({
        network: 'devnet',
        epochId: 'epoch-1',
        baseIdentity: 'base-100',
        expectedPreviousLedgerIndex: 101,
        expectedPreviousLedgerHash: finalHash,
        scanSequence: 0,
      }),
      { availableAt: t0, createdAt: t0 },
    )
  } else {
    runtime.scheduler.enqueue(buildCommitPhaseMessage({ workId, chunkIndex: 0 }), {
      availableAt: t0,
      createdAt: t0,
    })
  }
  return runtime
}

describe('portable collector runtime state resumption', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  for (const state of ['staged', 'committing', 'committed'] as const) {
    it(`restores ${state} state without changing visibility or watermark`, () => {
      const source = createState(state)
      const exported = exportPortableCollectorRuntimeState(source.db)
      const target = createDatabase()
      restorePortableCollectorRuntimeState(target.db, exported)

      expect(exportPortableCollectorRuntimeState(target.db)).toBe(exported)
      expect(target.store.getWork(workId)?.status).toBe(state)
      expect(target.store.listReferenceRowsForWork(workId)).toEqual(
        source.store.listReferenceRowsForWork(workId),
      )

      if (state === 'committed') {
        expect(target.store.listCommittedReferenceRows()).toHaveLength(1)
        expect(target.store.getWatermark('devnet', 'epoch-1', 'base-100')).toMatchObject({
          ledgerIndex: 101,
          ledgerHash: finalHash,
          workId,
        })
      } else {
        expect(target.store.listCommittedReferenceRows()).toEqual([])
        expect(target.store.getWatermark('devnet', 'epoch-1', 'base-100')).toBeUndefined()
      }
    })
  }
})
