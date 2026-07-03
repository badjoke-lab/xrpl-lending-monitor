import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import type {
  CurrentStatePage,
  CurrentStateScanMetrics,
} from '../../collector/current-state/scan-current-state'
import { getActiveSnapshot } from '../repositories/core-api-repository'
import { listCurrentVaults } from '../repositories/current-state-object-reader'
import {
  failSnapshot,
} from '../repositories/d1-snapshot'
import {
  markSnapshotCleanupEligible,
  removeEligibleSnapshot,
  restorePreviousSnapshot,
} from '../repositories/d1-snapshot-retention'
import { activateSnapshot } from '../repositories/d1-snapshot-verify'
import { runD1Bootstrap } from './d1-bootstrap'

let db: D1Database
let disposePlatform: (() => Promise<void>) | undefined

function splitMigrationStatements(sql: string): string[] {
  return sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0)
}

async function applyMigrations(database: D1Database): Promise<void> {
  const directory = resolve(process.cwd(), 'migrations')
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8')
    for (const statement of splitMigrationStatements(sql)) {
      await database.prepare(statement).run()
    }
  }
}

function metrics(elapsedMs: number): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs,
    requestedObjectsPerPage: 80,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

function page(markerBefore: unknown, markerAfter: unknown): CurrentStatePage {
  return {
    pageNumber: 1,
    markerBefore,
    markerAfter,
    firstLedgerIndex: null,
    lastLedgerIndex: null,
    decodedObjects: 80,
    vaults: [],
    loanBrokers: [],
    loans: [],
  }
}

function clock() {
  let tick = 0
  return () => {
    const value = new Date(Date.UTC(2026, 6, 3, 0, 0, 0, tick)).toISOString()
    tick += 1
    return value
  }
}

const endpoint = 'https://devnet.example/'
const epochId = 'epoch-1'

function identity(snapshotId: string, ledgerIndex: number, ledgerHash: string) {
  return {
    snapshotId,
    epochId,
    endpoint,
    ledgerIndex,
    ledgerHash,
    objectPrefix: 'unused-by-d1',
  }
}

describe('D1-only local current-state integration', () => {
  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      configPath: resolve(process.cwd(), 'wrangler.d1-test.jsonc'),
      persist: false,
      remoteBindings: false,
    })
    db = platform.env.DB
    disposePlatform = () => platform.dispose()
    await applyMigrations(db)

    const now = '2026-07-03T00:00:00.000Z'
    await db
      .prepare(
        `INSERT INTO network_epochs (
           id, network, status, first_ledger_index, first_ledger_hash,
           started_at, created_at, updated_at
         ) VALUES (?1, 'devnet', 'current', 1, ?2, ?3, ?3, ?3)`,
      )
      .bind(epochId, 'E'.repeat(64), now)
      .run()
    await db
      .prepare(
        `INSERT INTO sync_state (
           network, epoch_id, status, created_at, updated_at
         ) VALUES ('devnet', ?1, 'uninitialized', ?2, ?2)`,
      )
      .bind(epochId, now)
      .run()
  }, 60_000)

  afterAll(async () => {
    await disposePlatform?.()
  })

  it('pauses, resumes, verifies, activates, reads, rolls back, and cleans up safely', async () => {
    const firstIdentity = identity('snapshot-1', 100, 'A'.repeat(64))
    const firstClock = clock()

    const paused = await runD1Bootstrap({
      db,
      identity: firstIdentity,
      timeoutMs: 1_000,
      now: firstClock,
      dependencies: {
        scanBatch: async (options) => {
          expect(options.startMarker).toBeUndefined()
          await options.onPage(page(undefined, { cursor: 'next' }))
          return {
            endpoint,
            ledgerHash: firstIdentity.ledgerHash,
            ledgerIndex: firstIdentity.ledgerIndex,
            complete: false,
            nextMarker: { cursor: 'next' },
            metrics: metrics(5),
          }
        },
      },
    })

    expect(paused.status).toBe('paused')
    expect(paused.checkpoint.nextMarker).toEqual({ cursor: 'next' })

    await expect(
      runD1Bootstrap({
        db,
        identity: { ...firstIdentity, ledgerHash: 'B'.repeat(64) },
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('identity does not match')

    const verifiedFirst = await runD1Bootstrap({
      db,
      identity: firstIdentity,
      timeoutMs: 1_000,
      now: firstClock,
      dependencies: {
        scanBatch: async (options) => {
          expect(options.startMarker).toEqual({ cursor: 'next' })
          await options.onPage(page({ cursor: 'next' }, null))
          return {
            endpoint,
            ledgerHash: firstIdentity.ledgerHash,
            ledgerIndex: firstIdentity.ledgerIndex,
            complete: true,
            nextMarker: null,
            metrics: metrics(7),
          }
        },
      },
    })

    expect(verifiedFirst.status).toBe('verified')
    expect(verifiedFirst.manifest?.batchCount).toBe(2)
    expect(verifiedFirst.manifest?.counts.objects).toBe(0)

    await activateSnapshot({
      db,
      snapshotId: firstIdentity.snapshotId,
      activatedAt: '2026-07-03T00:01:00.000Z',
    })

    const firstActive = await getActiveSnapshot(db)
    expect(firstActive).toMatchObject({
      id: firstIdentity.snapshotId,
      ledger_index: firstIdentity.ledgerIndex,
      object_count: 0,
    })
    await expect(
      listCurrentVaults(db, firstActive!, { limit: 25, sort: 'id_asc' }),
    ).resolves.toMatchObject({ items: [], nextCursor: null })

    const secondIdentity = identity('snapshot-2', 200, 'C'.repeat(64))
    const verifiedSecond = await runD1Bootstrap({
      db,
      identity: secondIdentity,
      timeoutMs: 1_000,
      now: clock(),
      dependencies: {
        scanBatch: async (options) => {
          await options.onPage(page(undefined, null))
          return {
            endpoint,
            ledgerHash: secondIdentity.ledgerHash,
            ledgerIndex: secondIdentity.ledgerIndex,
            complete: true,
            nextMarker: null,
            metrics: metrics(4),
          }
        },
      },
    })
    expect(verifiedSecond.status).toBe('verified')

    await expect(
      activateSnapshot({
        db,
        snapshotId: secondIdentity.snapshotId,
        activatedAt: '2026-07-03T00:02:00.000Z',
      }),
    ).resolves.toEqual({
      snapshotId: secondIdentity.snapshotId,
      rollbackSnapshotId: firstIdentity.snapshotId,
    })

    await expect(
      restorePreviousSnapshot({ db, restoredAt: '2026-07-03T00:03:00.000Z' }),
    ).resolves.toEqual({
      snapshotId: firstIdentity.snapshotId,
      rollbackSnapshotId: secondIdentity.snapshotId,
    })

    const failedIdentity = identity('snapshot-failed', 300, 'D'.repeat(64))
    await runD1Bootstrap({
      db,
      identity: failedIdentity,
      timeoutMs: 1_000,
      now: clock(),
      dependencies: {
        scanBatch: async () => {
          throw new Error('controlled interruption')
        },
      },
    }).catch(() => undefined)
    await failSnapshot({
      db,
      snapshotId: failedIdentity.snapshotId,
      failedAt: '2026-07-03T00:04:00.000Z',
      code: 'controlled_failure',
      message: 'integration cleanup evidence',
    })
    await markSnapshotCleanupEligible({
      db,
      snapshotId: failedIdentity.snapshotId,
      eligibleAt: '2026-07-03T00:05:00.000Z',
      reason: 'integration cleanup evidence',
    })
    await expect(
      removeEligibleSnapshot({
        db,
        snapshotId: failedIdentity.snapshotId,
        removeAt: '2026-07-03T00:06:00.000Z',
      }),
    ).resolves.toBe(true)
  }, 60_000)
})
