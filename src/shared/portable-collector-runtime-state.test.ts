import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  buildCommitPhaseMessage,
  buildFinalizePhaseMessage,
  buildScanPhaseMessage,
} from './portable-collector-messages'
import {
  exportPortableCollectorRuntimeState,
  restorePortableCollectorRuntimeState,
} from './portable-collector-runtime-state'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import type {
  PortableSqliteDatabase,
  PortableSqliteValue,
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
} {
  const database = new DatabaseSync(':memory:')
  openDatabases.push(database)
  database.exec('PRAGMA foreign_keys = ON')
  for (const migration of [
    'migrations/10004_portable_collector_work.sql',
    'migrations/10005_portable_scheduler.sql',
  ]) {
    database.exec(readFileSync(resolve(process.cwd(), migration), 'utf8'))
  }
  const adapter = new NodeSqliteRuntimeDatabase(database)
  return {
    database,
    adapter,
    scheduler: new PortableCollectorScheduler(adapter),
  }
}

const t0 = '2026-08-01T09:00:00.000Z'
function minute(value: number): string {
  return new Date(Date.parse(t0) + value * 60_000).toISOString()
}

const scan = buildScanPhaseMessage({
  network: 'devnet',
  epochId: 'epoch-1',
  baseIdentity: 'base-100',
  expectedPreviousLedgerIndex: 100,
  expectedPreviousLedgerHash: 'A'.repeat(64),
})
const commit = buildCommitPhaseMessage({ workId: 'work-101', chunkIndex: 0 })
const finalize = buildFinalizePhaseMessage({ workId: 'work-other' })

describe('portable collector complete runtime state', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
  })

  it('restores leased messages and pending timed outbox entries exactly', () => {
    const source = createRuntimeDatabase()
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
    const target = createRuntimeDatabase()
    restorePortableCollectorRuntimeState(target.adapter, exportedState)

    expect(exportPortableCollectorRuntimeState(target.adapter)).toBe(exportedState)
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

    target.scheduler.dispatchNextOutbox({ now: minute(3) })
    expect(target.scheduler.getMessage(commit.messageId)).toMatchObject({
      status: 'pending',
      availableAt: minute(4),
    })
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
