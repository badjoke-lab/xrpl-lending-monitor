import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  buildCommitPhaseMessage,
  buildScanPhaseMessage,
} from './portable-collector-messages'
import {
  PortableCollectorScheduler,
  PortableSchedulerLeaseLostError,
} from './portable-collector-scheduler'
import type {
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'

class NodeSqliteSchedulerDatabase implements PortableSqliteDatabase {
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
const commit = buildCommitPhaseMessage({ workId: 'work-101-102', chunkIndex: 0 })
const t0 = '2026-08-01T08:00:00.000Z'

function addMinutes(minutes: number): string {
  return new Date(Date.parse(t0) + minutes * 60_000).toISOString()
}

describe('portable collector durable scheduler', () => {
  let database: DatabaseSync
  let adapter: NodeSqliteSchedulerDatabase
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
    database.exec('CREATE TABLE mutation_probe (value TEXT PRIMARY KEY)')
    adapter = new NodeSqliteSchedulerDatabase(database)
    scheduler = new PortableCollectorScheduler(adapter)
  })

  afterEach(() => {
    database.close()
  })

  it('rejects fresh lease theft and reclaims the exact message after expiry', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })

    const first = scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: addMinutes(5),
    })
    expect(first.status).toBe('claimed')
    if (first.status === 'claimed') expect(first.snapshot.attemptCount).toBe(1)

    expect(
      scheduler.claim(scan.messageId, {
        leaseOwner: 'worker-b',
        now: addMinutes(1),
        leaseExpiresAt: addMinutes(6),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'fresh_lease' })

    const reclaimed = scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-b',
      now: addMinutes(5),
      leaseExpiresAt: addMinutes(10),
    })
    expect(reclaimed.status).toBe('claimed')
    if (reclaimed.status === 'claimed') {
      expect(reclaimed.message).toEqual(scan)
      expect(reclaimed.message.phase === 'scan' && reclaimed.message.scanSequence).toBe(0)
      expect(reclaimed.snapshot.leaseOwner).toBe('worker-b')
      expect(reclaimed.snapshot.attemptCount).toBe(2)
    }
  })

  it('atomically completes a phase, reserves one timed successor, and dispatches idempotently', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: addMinutes(5),
    })

    const completion = scheduler.completeWithSuccessor({
      messageId: scan.messageId,
      leaseOwner: 'worker-a',
      now: addMinutes(1),
      result: { status: 'staged', workId: 'work-101-102' },
      successor: commit,
      successorAvailableAt: addMinutes(3),
      mutate: () => {
        adapter.run('INSERT INTO mutation_probe (value) VALUES (?)', ['scan-staged'])
        return 'mutation-applied'
      },
    })

    expect(completion).toEqual({
      status: 'completed',
      mutationResult: 'mutation-applied',
    })
    expect(adapter.get<{ value: string }>('SELECT value FROM mutation_probe')?.value).toBe(
      'scan-staged',
    )
    expect(scheduler.getMessage(commit.messageId)).toBeUndefined()
    expect(scheduler.getOutbox(scan.messageId)).toMatchObject({
      currentMessageId: scan.messageId,
      successorMessageId: commit.messageId,
      successorAvailableAt: addMinutes(3),
      status: 'pending',
    })

    const duplicate = scheduler.completeWithSuccessor({
      messageId: scan.messageId,
      leaseOwner: 'ignored-after-completion',
      now: addMinutes(2),
      result: { status: 'staged', workId: 'work-101-102' },
      successor: commit,
      successorAvailableAt: addMinutes(3),
    })
    expect(duplicate).toEqual({ status: 'duplicate', mutationResult: undefined })

    expect(scheduler.dispatchNextOutbox({ now: addMinutes(2) })).toMatchObject({
      status: 'dispatched',
      successorAvailableAt: addMinutes(3),
    })
    expect(scheduler.getMessage(commit.messageId)).toMatchObject({
      status: 'pending',
      availableAt: addMinutes(3),
      attemptCount: 0,
    })
    expect(scheduler.dispatchNextOutbox({ now: addMinutes(4) })).toBeUndefined()
    expect(
      scheduler.claim(scan.messageId, {
        leaseOwner: 'worker-c',
        now: addMinutes(4),
        leaseExpiresAt: addMinutes(5),
      }),
    ).toMatchObject({ status: 'completed' })
  })

  it('rolls back work mutation and successor reservation together', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: addMinutes(5),
    })

    expect(() =>
      scheduler.completeWithSuccessor({
        messageId: scan.messageId,
        leaseOwner: 'worker-a',
        now: addMinutes(1),
        result: { status: 'staged' },
        successor: commit,
        successorAvailableAt: addMinutes(2),
        mutate: () => {
          adapter.run('INSERT INTO mutation_probe (value) VALUES (?)', ['must-rollback'])
          throw new Error('injected interruption')
        },
      }),
    ).toThrow('injected interruption')

    expect(adapter.get<{ count: number }>('SELECT COUNT(*) AS count FROM mutation_probe')?.count).toBe(
      0,
    )
    expect(scheduler.getOutbox(scan.messageId)).toBeUndefined()
    expect(scheduler.getMessage(scan.messageId)).toMatchObject({
      status: 'leased',
      leaseOwner: 'worker-a',
      successorMessageId: null,
    })
  })

  it('retries the same message identity and sequence after a bounded delay', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: addMinutes(5),
    })
    scheduler.retry({
      messageId: scan.messageId,
      leaseOwner: 'worker-a',
      now: addMinutes(1),
      availableAt: addMinutes(4),
      classification: 'retryable_transport',
      errorMessage: 'temporary fixture transport failure',
    })

    expect(scheduler.getMessage(scan.messageId)).toMatchObject({
      messageId: scan.messageId,
      status: 'pending',
      availableAt: addMinutes(4),
      attemptCount: 1,
      errorClassification: 'retryable_transport',
    })
    expect(
      scheduler.claim(scan.messageId, {
        leaseOwner: 'worker-b',
        now: addMinutes(3),
        leaseExpiresAt: addMinutes(8),
      }),
    ).toMatchObject({ status: 'unavailable', reason: 'not_ready' })

    const retried = scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-b',
      now: addMinutes(4),
      leaseExpiresAt: addMinutes(9),
    })
    expect(retried.status).toBe('claimed')
    if (retried.status === 'claimed') {
      expect(retried.message.messageId).toBe(scan.messageId)
      expect(retried.message.phase === 'scan' && retried.message.scanSequence).toBe(0)
      expect(retried.snapshot.attemptCount).toBe(2)
    }
  })

  it('halts terminal failures without a successor and rejects the wrong lease owner', () => {
    scheduler.enqueue(scan, { availableAt: t0, createdAt: t0 })
    scheduler.claim(scan.messageId, {
      leaseOwner: 'worker-a',
      now: t0,
      leaseExpiresAt: addMinutes(5),
    })

    expect(() =>
      scheduler.failTerminal({
        messageId: scan.messageId,
        leaseOwner: 'worker-b',
        now: addMinutes(1),
        classification: 'parent_hash_mismatch',
        errorMessage: 'wrong owner must not halt another lease',
      }),
    ).toThrow(PortableSchedulerLeaseLostError)

    scheduler.failTerminal({
      messageId: scan.messageId,
      leaseOwner: 'worker-a',
      now: addMinutes(1),
      classification: 'parent_hash_mismatch',
      errorMessage: 'fixture parent hash mismatch',
    })
    expect(scheduler.getMessage(scan.messageId)).toMatchObject({
      status: 'error',
      errorClassification: 'parent_hash_mismatch',
      successorMessageId: null,
    })
    expect(scheduler.getOutbox(scan.messageId)).toBeUndefined()
    expect(
      scheduler.claim(scan.messageId, {
        leaseOwner: 'worker-c',
        now: addMinutes(6),
        leaseExpiresAt: addMinutes(10),
      }),
    ).toMatchObject({ status: 'error' })
  })
})
