import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  LocalSqliteServiceSupervisor,
  LocalSqliteServiceSupervisorError,
} from './local-sqlite-service-supervisor'
import { buildScanPhaseMessage } from './portable-collector-messages'
import type {
  PortableSqliteDatabase,
  PortableSqliteValue,
} from './portable-collector-reference-store'
import { PortableCollectorScheduler } from './portable-collector-scheduler'

class NodeFileSqliteDatabase implements PortableSqliteDatabase {
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

const temporaryDirectories: string[] = []
const openDatabases: DatabaseSync[] = []
const profileId = 'self-hosted-sqlite-service'
const baseHash = 'A'.repeat(64)

function createDatabasePath(): string {
  const directory = mkdtempSync(join(tmpdir(), 'xrpl-local-service-'))
  temporaryDirectories.push(directory)
  return join(directory, 'collector.sqlite')
}

function openDatabase(path: string, migrate = false) {
  const database = new DatabaseSync(path)
  openDatabases.push(database)
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA synchronous = FULL')
  if (migrate) {
    for (const migration of [
      'migrations/10004_portable_collector_work.sql',
      'migrations/10005_portable_scheduler.sql',
      'migrations/10006_portable_reference_identity.sql',
      'migrations/10007_portable_publication_maintenance.sql',
      'migrations/10008_local_sqlite_service_supervisor.sql',
    ]) {
      database.exec(readFileSync(resolve(process.cwd(), migration), 'utf8'))
    }
  }
  const db = new NodeFileSqliteDatabase(database)
  return {
    database,
    db,
    supervisor: new LocalSqliteServiceSupervisor(db),
    scheduler: new PortableCollectorScheduler(db),
  }
}

function closeDatabase(database: DatabaseSync): void {
  database.close()
  const index = openDatabases.indexOf(database)
  if (index >= 0) openDatabases.splice(index, 1)
}

describe('R4C1 file-backed local SQLite service supervisor', () => {
  afterEach(() => {
    while (openDatabases.length > 0) openDatabases.pop()!.close()
    while (temporaryDirectories.length > 0) {
      rmSync(temporaryDirectories.pop()!, { recursive: true, force: true })
    }
  })

  it('persists scheduler state and reclaims an expired process lease after a crash', () => {
    const path = createDatabasePath()
    const firstProcess = openDatabase(path, true)

    const initialized = firstProcess.supervisor.initialize({
      profileId,
      now: '2026-08-01T15:00:00.000Z',
    })
    expect(initialized).toMatchObject({
      generation: 0,
      status: 'stopped',
      restartCount: 0,
    })
    expect(
      firstProcess.supervisor.initialize({
        profileId,
        now: '2026-08-01T15:00:00.000Z',
      }),
    ).toEqual(initialized)

    const started = firstProcess.supervisor.start({
      profileId,
      ownerId: 'process-a',
      now: '2026-08-01T15:00:01.000Z',
      leaseExpiresAt: '2026-08-01T15:01:00.000Z',
    })
    expect(started).toMatchObject({
      status: 'started',
      snapshot: {
        generation: 1,
        status: 'running',
        ownerId: 'process-a',
        restartCount: 0,
      },
    })
    expect(
      firstProcess.supervisor.start({
        profileId,
        ownerId: 'process-a',
        now: '2026-08-01T15:00:02.000Z',
        leaseExpiresAt: '2026-08-01T15:02:00.000Z',
      }),
    ).toMatchObject({ status: 'duplicate', snapshot: started.snapshot })

    const message = buildScanPhaseMessage({
      network: 'devnet',
      epochId: 'epoch-1',
      baseIdentity: 'base-100',
      expectedPreviousLedgerIndex: 100,
      expectedPreviousLedgerHash: baseHash,
      scanSequence: 0,
    })
    firstProcess.scheduler.enqueue(message, {
      availableAt: '2026-08-01T15:00:10.000Z',
      createdAt: '2026-08-01T15:00:10.000Z',
    })

    closeDatabase(firstProcess.database)

    const secondProcess = openDatabase(path)
    expect(() =>
      secondProcess.supervisor.start({
        profileId,
        ownerId: 'process-b',
        now: '2026-08-01T15:00:30.000Z',
        leaseExpiresAt: '2026-08-01T15:02:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'lease_conflict' }))
    expect(secondProcess.scheduler.getMessage(message.messageId)).toMatchObject({
      status: 'pending',
      attemptCount: 0,
    })

    const reclaimed = secondProcess.supervisor.start({
      profileId,
      ownerId: 'process-b',
      now: '2026-08-01T15:01:00.000Z',
      leaseExpiresAt: '2026-08-01T15:02:00.000Z',
    })
    expect(reclaimed).toMatchObject({
      status: 'reclaimed',
      snapshot: {
        generation: 2,
        status: 'running',
        ownerId: 'process-b',
        restartCount: 1,
      },
    })
    expect(
      secondProcess.supervisor.assertActiveOwner({
        profileId,
        ownerId: 'process-b',
        now: '2026-08-01T15:01:01.000Z',
      }),
    ).toEqual(reclaimed.snapshot)
    expect(
      secondProcess.scheduler.claim(message.messageId, {
        leaseOwner: 'process-b',
        now: '2026-08-01T15:01:01.000Z',
        leaseExpiresAt: '2026-08-01T15:02:00.000Z',
      }),
    ).toMatchObject({ status: 'claimed' })

    const heartbeat = secondProcess.supervisor.heartbeat({
      profileId,
      ownerId: 'process-b',
      now: '2026-08-01T15:01:10.000Z',
      leaseExpiresAt: '2026-08-01T15:03:00.000Z',
    })
    expect(heartbeat).toMatchObject({
      generation: 2,
      lastHeartbeatAt: '2026-08-01T15:01:10.000Z',
      leaseExpiresAt: '2026-08-01T15:03:00.000Z',
    })

    closeDatabase(secondProcess.database)
    const thirdProcess = openDatabase(path)
    expect(thirdProcess.supervisor.get(profileId)).toEqual(heartbeat)
    expect(thirdProcess.scheduler.getMessage(message.messageId)).toMatchObject({
      status: 'processing',
      leaseOwner: 'process-b',
      attemptCount: 1,
    })

    const retry = thirdProcess.supervisor.failRetryable({
      profileId,
      ownerId: 'process-b',
      now: '2026-08-01T15:01:20.000Z',
      nextStartAt: '2026-08-01T15:02:00.000Z',
      errorCode: 'network_unavailable',
      errorMessage: 'XRPL endpoint unavailable',
    })
    expect(retry).toMatchObject({
      status: 'stopped',
      restartCount: 2,
      nextStartAt: '2026-08-01T15:02:00.000Z',
      lastErrorCode: 'network_unavailable',
    })
    expect(() =>
      thirdProcess.supervisor.start({
        profileId,
        ownerId: 'process-c',
        now: '2026-08-01T15:01:59.000Z',
        leaseExpiresAt: '2026-08-01T15:03:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'restart_not_due' }))

    const restarted = thirdProcess.supervisor.start({
      profileId,
      ownerId: 'process-c',
      now: '2026-08-01T15:02:00.000Z',
      leaseExpiresAt: '2026-08-01T15:04:00.000Z',
    })
    expect(restarted).toMatchObject({
      status: 'started',
      snapshot: {
        generation: 3,
        status: 'running',
        ownerId: 'process-c',
        restartCount: 2,
        nextStartAt: null,
        lastErrorCode: null,
      },
    })

    const halted = thirdProcess.supervisor.failTerminal({
      profileId,
      ownerId: 'process-c',
      now: '2026-08-01T15:02:10.000Z',
      errorCode: 'identity_mismatch',
      errorMessage: 'immutable base identity changed',
    })
    expect(halted).toMatchObject({
      status: 'halted',
      ownerId: null,
      nextStartAt: null,
      lastErrorCode: 'identity_mismatch',
    })
    expect(() =>
      thirdProcess.supervisor.start({
        profileId,
        ownerId: 'process-d',
        now: '2026-08-01T15:10:00.000Z',
        leaseExpiresAt: '2026-08-01T15:11:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'terminal_halt' }))

    expect(
      thirdProcess.supervisor.listEvents(profileId).map((event) => event.eventType),
    ).toEqual([
      'initialized',
      'started',
      'reclaimed',
      'heartbeat',
      'retry_scheduled',
      'started',
      'halted',
    ])
  })

  it('supports a graceful stop and a new generation without counting a failure', () => {
    const path = createDatabasePath()
    const state = openDatabase(path, true)
    state.supervisor.initialize({
      profileId,
      now: '2026-08-01T16:00:00.000Z',
    })
    state.supervisor.start({
      profileId,
      ownerId: 'process-a',
      now: '2026-08-01T16:00:01.000Z',
      leaseExpiresAt: '2026-08-01T16:01:00.000Z',
    })
    const stopped = state.supervisor.stop({
      profileId,
      ownerId: 'process-a',
      now: '2026-08-01T16:00:10.000Z',
    })
    expect(stopped).toMatchObject({
      generation: 1,
      status: 'stopped',
      restartCount: 0,
      nextStartAt: null,
    })
    const restarted = state.supervisor.start({
      profileId,
      ownerId: 'process-b',
      now: '2026-08-01T16:00:11.000Z',
      leaseExpiresAt: '2026-08-01T16:01:11.000Z',
    })
    expect(restarted).toMatchObject({
      status: 'started',
      snapshot: {
        generation: 2,
        restartCount: 0,
        ownerId: 'process-b',
      },
    })
    expect(state.supervisor.listEvents(profileId).map((event) => event.eventType)).toEqual([
      'initialized',
      'started',
      'stopped',
      'started',
    ])
  })

  it('fails closed on missing state, wrong owner, expired leases, and invalid timing', () => {
    const path = createDatabasePath()
    const state = openDatabase(path, true)
    expect(() => state.supervisor.get('bad id')).toThrow(
      LocalSqliteServiceSupervisorError,
    )
    expect(() =>
      state.supervisor.start({
        profileId,
        ownerId: 'process-a',
        now: '2026-08-01T17:00:00.000Z',
        leaseExpiresAt: '2026-08-01T17:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'not_initialized' }))

    state.supervisor.initialize({
      profileId,
      now: '2026-08-01T17:00:00.000Z',
    })
    state.supervisor.start({
      profileId,
      ownerId: 'process-a',
      now: '2026-08-01T17:00:01.000Z',
      leaseExpiresAt: '2026-08-01T17:01:00.000Z',
    })
    expect(() =>
      state.supervisor.heartbeat({
        profileId,
        ownerId: 'process-b',
        now: '2026-08-01T17:00:10.000Z',
        leaseExpiresAt: '2026-08-01T17:02:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'lease_lost' }))
    expect(() =>
      state.supervisor.assertActiveOwner({
        profileId,
        ownerId: 'process-a',
        now: '2026-08-01T17:01:00.000Z',
      }),
    ).toThrowError(expect.objectContaining({ code: 'lease_lost' }))
    expect(() =>
      state.supervisor.failRetryable({
        profileId,
        ownerId: 'process-a',
        now: '2026-08-01T17:00:20.000Z',
        nextStartAt: '2026-08-01T17:00:20.000Z',
        errorCode: 'temporary_failure',
        errorMessage: 'temporary failure',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })
})
