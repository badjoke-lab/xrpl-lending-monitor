import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { getActiveSnapshot } from '../repositories/core-api-repository'
import { listCurrentVaults } from '../repositories/current-state-object-reader'
import { beginSnapshot, failSnapshot } from '../repositories/d1-snapshot'
import {
  markSnapshotCleanupEligible,
  removeEligibleSnapshot,
  restorePreviousSnapshot,
} from '../repositories/d1-snapshot-retention'
import { activateSnapshot } from '../repositories/d1-snapshot-verify'
import { runD1Bootstrap } from './d1-bootstrap'

let db: D1Database
let disposePlatform: (() => Promise<void>) | undefined

function statements(sql: string): string[] {
  return sql.replace(/--.*$/gm, '').split(';').map((value) => value.trim()).filter(Boolean)
}

async function migrate(database: D1Database): Promise<void> {
  const directory = resolve(process.cwd(), 'migrations')
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), 'utf8')
    for (const statement of statements(sql)) await database.prepare(statement).run()
  }
}

function scanMetrics(elapsedMs: number): CurrentStateScanMetrics {
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

function emptyPage(markerBefore: unknown, markerAfter: unknown): CurrentStatePage {
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

function nowFactory() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 6, 3, 0, 0, 0, tick++)).toISOString()
}

const epochId = 'epoch-1'
const endpoint = 'https://devnet.example/'

function snapshotIdentity(snapshotId: string, ledgerIndex: number, ledgerHash: string) {
  return {
    snapshotId,
    epochId,
    endpoint,
    ledgerIndex,
    ledgerHash,
    objectPrefix: 'unused-by-d1',
  }
}

async function verifyTerminalSnapshot(identity: ReturnType<typeof snapshotIdentity>): Promise<void> {
  const result = await runD1Bootstrap({
    db,
    identity,
    timeoutMs: 1_000,
    now: nowFactory(),
    dependencies: {
      scanBatch: async (options) => {
        await options.onPage(emptyPage(undefined, null))
        return {
          endpoint,
          ledgerHash: identity.ledgerHash,
          ledgerIndex: identity.ledgerIndex,
          complete: true,
          nextMarker: null,
          metrics: scanMetrics(4),
        }
      },
    },
  })
  expect(result.status).toBe('verified')
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
    await migrate(db)

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

  it('covers resume, verification, activation, reads, rollback, and cleanup', async () => {
    const first = snapshotIdentity('snapshot-1', 100, 'A'.repeat(64))
    const firstNow = nowFactory()

    const paused = await runD1Bootstrap({
      db,
      identity: first,
      timeoutMs: 1_000,
      now: firstNow,
      dependencies: {
        scanBatch: async (options) => {
          expect(options.startMarker).toBeUndefined()
          await options.onPage(emptyPage(undefined, { cursor: 'next' }))
          return {
            endpoint,
            ledgerHash: first.ledgerHash,
            ledgerIndex: first.ledgerIndex,
            complete: false,
            nextMarker: { cursor: 'next' },
            metrics: scanMetrics(5),
          }
        },
      },
    })
    expect(paused.status).toBe('paused')
    expect(paused.checkpoint.nextMarker).toEqual({ cursor: 'next' })

    await expect(
      runD1Bootstrap({
        db,
        identity: { ...first, ledgerHash: 'B'.repeat(64) },
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('identity does not match')

    const verified = await runD1Bootstrap({
      db,
      identity: first,
      timeoutMs: 1_000,
      now: firstNow,
      dependencies: {
        scanBatch: async (options) => {
          expect(options.startMarker).toEqual({ cursor: 'next' })
          await options.onPage(emptyPage({ cursor: 'next' }, null))
          return {
            endpoint,
            ledgerHash: first.ledgerHash,
            ledgerIndex: first.ledgerIndex,
            complete: true,
            nextMarker: null,
            metrics: scanMetrics(7),
          }
        },
      },
    })
    expect(verified.status).toBe('verified')
    expect(verified.manifest?.batchCount).toBe(2)

    await activateSnapshot({
      db,
      snapshotId: first.snapshotId,
      activatedAt: '2026-07-03T00:01:00.000Z',
    })
    const active = await getActiveSnapshot(db)
    expect(active).toMatchObject({
      id: first.snapshotId,
      ledgerIndex: first.ledgerIndex,
      objectCount: 0,
    })
    await expect(
      listCurrentVaults(db, active!, { limit: 25, sort: 'id_asc' }),
    ).resolves.toMatchObject({ items: [], nextCursor: null })

    const second = snapshotIdentity('snapshot-2', 200, 'C'.repeat(64))
    await verifyTerminalSnapshot(second)
    await expect(
      activateSnapshot({
        db,
        snapshotId: second.snapshotId,
        activatedAt: '2026-07-03T00:02:00.000Z',
      }),
    ).resolves.toEqual({
      snapshotId: second.snapshotId,
      rollbackSnapshotId: first.snapshotId,
    })
    await expect(
      restorePreviousSnapshot({ db, restoredAt: '2026-07-03T00:03:00.000Z' }),
    ).resolves.toEqual({
      snapshotId: first.snapshotId,
      rollbackSnapshotId: second.snapshotId,
    })

    const failed = snapshotIdentity('snapshot-failed', 300, 'D'.repeat(64))
    await beginSnapshot(db, {
      id: failed.snapshotId,
      network: 'devnet',
      epochId,
      ledgerIndex: failed.ledgerIndex,
      ledgerHash: failed.ledgerHash,
      endpoint,
      startedAt: '2026-07-03T00:04:00.000Z',
    })
    await failSnapshot({
      db,
      snapshotId: failed.snapshotId,
      failedAt: '2026-07-03T00:04:01.000Z',
      code: 'controlled_failure',
      message: 'integration cleanup evidence',
    })
    await markSnapshotCleanupEligible({
      db,
      snapshotId: failed.snapshotId,
      eligibleAt: '2026-07-03T00:05:00.000Z',
      reason: 'integration cleanup evidence',
    })
    await expect(
      removeEligibleSnapshot({
        db,
        snapshotId: failed.snapshotId,
        removeAt: '2026-07-03T00:06:00.000Z',
      }),
    ).resolves.toBe(true)
  }, 60_000)
})
