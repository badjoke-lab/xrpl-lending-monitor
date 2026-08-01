import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildCommitPhaseMessage,
  buildScanPhaseMessage,
} from './portable-collector-messages'
import { PortableCollectorScheduler } from './portable-collector-scheduler'
import type {
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'

class NodeSqliteSchedulerConflictDatabase implements PortableSqliteDatabase {
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

const scan = buildScanPhaseMessage({
  network: 'devnet',
  epochId: 'epoch-1',
  baseIdentity: 'base-100',
  expectedPreviousLedgerIndex: 100,
  expectedPreviousLedgerHash: 'A'.repeat(64),
  scanSequence: 0,
})
const commit = buildCommitPhaseMessage({ workId: 'work-101', chunkIndex: 0 })
const t0 = '2026-08-01T10:00:00.000Z'
function minute(value: number): string {
  return new Date(Date.parse(t0) + value * 60_000).toISOString()
}

describe('portable scheduler timing identity', () => {
  let database: DatabaseSync
  let scheduler: PortableCollectorScheduler

  beforeEach(() => {
    database = new DatabaseSync(':memory:')
    database.exec('PRAGMA foreign_keys = ON')
    database.exec(
      readFileSync(resolve(process.cwd(), 'migrations/10004_portable_collector_work.sql'), 'utf8'),
    )
    database.exec(
      readFileSync(resolve(process.cwd(), 'migrations/10005_portable_scheduler.sql'), 'utf8'),
    )
    scheduler = new PortableCollectorScheduler(
      new NodeSqliteSchedulerConflictDatabase(database),
    )
  })

  afterEach(() => database.close())

  it('rejects re-enqueueing one deterministic message at another time', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })

    expect(() =>
      scheduler.enqueue(scan, { availableAt: minute(1), createdAt: minute(1) }),
    ).toThrow(`scheduler message identity conflict: ${scan.messageId}`)
    expect(scheduler.getMessage(scan.messageId)?.availableAt).toBe(t0)
  })

  it('allows a later logical scan wake-up only through a new sequence identity', () => {
    const nextScan = buildScanPhaseMessage({
      network: scan.network,
      epochId: scan.epochId,
      baseIdentity: scan.baseIdentity,
      expectedPreviousLedgerIndex: scan.expectedPreviousLedgerIndex,
      expectedPreviousLedgerHash: scan.expectedPreviousLedgerHash,
      scanSequence: scan.scanSequence + 1,
    })

    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.enqueue(nextScan, { availableAt: minute(1), createdAt: minute(1) })

    expect(nextScan.messageId).not.toBe(scan.messageId)
    expect(scheduler.getMessage(scan.messageId)?.availableAt).toBe(t0)
    expect(scheduler.getMessage(nextScan.messageId)).toMatchObject({
      availableAt: minute(1),
      status: 'pending',
    })
  })

  it('rejects duplicate completion that changes reserved successor timing', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: minute(5),
    })
    scheduler.completeWithSuccessor({
      messageId: scan.messageId,
      leaseOwner: 'worker-a',
      now: minute(1),
      result: { status: 'staged' },
      successor: commit,
      successorAvailableAt: minute(3),
    })

    expect(() =>
      scheduler.completeWithSuccessor({
        messageId: scan.messageId,
        leaseOwner: 'irrelevant-after-completion',
        now: minute(2),
        result: { status: 'staged' },
        successor: commit,
        successorAvailableAt: minute(4),
      }),
    ).toThrow(`completed scheduler message result conflict: ${scan.messageId}`)
    expect(scheduler.getOutbox(scan.messageId)?.successorAvailableAt).toBe(minute(3))
  })
})
