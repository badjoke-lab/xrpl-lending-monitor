import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { runD1Bootstrap } from '../bootstrap/d1-bootstrap'
import { beginSnapshot, failSnapshot } from '../repositories/d1-snapshot'
import { executeD1CurrentStateOperator } from './d1-current-state-operator'

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

function metrics(): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 3,
    requestedObjectsPerPage: 80,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }
}

function terminalPage(): CurrentStatePage {
  return {
    pageNumber: 1,
    markerBefore: undefined,
    markerAfter: null,
    firstLedgerIndex: null,
    lastLedgerIndex: null,
    decodedObjects: 80,
    vaults: [],
    loanBrokers: [],
    loans: [],
  }
}

function clock() {
  let value = 0
  return () => new Date(Date.UTC(2026, 6, 3, 0, 0, 0, value++)).toISOString()
}

async function completeSnapshot(snapshotId: string, ledgerIndex: number, ledgerHash: string) {
  const result = await runD1Bootstrap({
    db,
    identity: {
      snapshotId,
      epochId: 'epoch-1',
      endpoint: 'https://devnet.example/',
      ledgerIndex,
      ledgerHash,
      objectPrefix: `d1/${snapshotId}`,
    },
    timeoutMs: 1_000,
    verifyOnComplete: false,
    now: clock(),
    dependencies: {
      scanBatch: async (options) => {
        await options.onPage(terminalPage())
        return {
          endpoint: 'https://devnet.example/',
          ledgerIndex,
          ledgerHash,
          complete: true,
          nextMarker: null,
          metrics: metrics(),
        }
      },
    },
  })
  expect(result.status).toBe('complete')
}

describe('D1 current-state operator integration', () => {
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
         ) VALUES ('epoch-1', 'devnet', 'current', 1, ?1, ?2, ?2, ?2)`,
      )
      .bind('E'.repeat(64), now)
      .run()
    await db
      .prepare(
        `INSERT INTO sync_state (
           network, epoch_id, status, created_at, updated_at
         ) VALUES ('devnet', 'epoch-1', 'uninitialized', ?1, ?1)`,
      )
      .bind(now)
      .run()
  }, 60_000)

  afterAll(async () => {
    await disposePlatform?.()
  })

  it('keeps verification and activation explicit and emits bounded evidence', async () => {
    await completeSnapshot('operator-1', 100, 'A'.repeat(64))

    const beforeVerify = await executeD1CurrentStateOperator({
      db,
      input: { action: 'status', snapshotId: 'operator-1' },
      now: () => '2026-07-03T00:01:00.000Z',
    })
    expect(beforeVerify.result).toMatchObject({
      status: 'building',
      checkpoint: { scanComplete: true, markerPresent: false },
      active: false,
    })
    expect(JSON.stringify(beforeVerify)).not.toContain('nextMarker')

    const measurement = await executeD1CurrentStateOperator({
      db,
      input: { action: 'measure', snapshotId: 'operator-1' },
      now: () => '2026-07-03T00:01:01.000Z',
    })
    expect(measurement.result).toMatchObject({
      snapshotId: 'operator-1',
      status: 'building',
      batchCount: 1,
      relevantObjectCount: 0,
      maximumBatchBytes: 0,
      withinSafetyThreshold: true,
    })

    const verified = await executeD1CurrentStateOperator({
      db,
      input: { action: 'verify', snapshotId: 'operator-1' },
      now: () => '2026-07-03T00:01:02.000Z',
    })
    expect(verified.result).toMatchObject({
      snapshotId: 'operator-1',
      activationPerformed: false,
    })

    const activated = await executeD1CurrentStateOperator({
      db,
      input: { action: 'activate', snapshotId: 'operator-1' },
      now: () => '2026-07-03T00:01:03.000Z',
    })
    expect(activated.result).toEqual({ snapshotId: 'operator-1', rollbackSnapshotId: null })

    await completeSnapshot('operator-2', 200, 'B'.repeat(64))
    await executeD1CurrentStateOperator({
      db,
      input: { action: 'verify', snapshotId: 'operator-2' },
      now: () => '2026-07-03T00:02:00.000Z',
    })
    await expect(
      executeD1CurrentStateOperator({
        db,
        input: { action: 'activate', snapshotId: 'operator-2' },
        now: () => '2026-07-03T00:02:01.000Z',
      }),
    ).resolves.toMatchObject({
      result: { snapshotId: 'operator-2', rollbackSnapshotId: 'operator-1' },
    })
    await expect(
      executeD1CurrentStateOperator({
        db,
        input: { action: 'restore' },
        now: () => '2026-07-03T00:02:02.000Z',
      }),
    ).resolves.toMatchObject({
      result: { snapshotId: 'operator-1', rollbackSnapshotId: 'operator-2' },
    })
  }, 60_000)

  it('guards cleanup through explicit actions', async () => {
    await beginSnapshot(db, {
      id: 'operator-failed',
      network: 'devnet',
      epochId: 'epoch-1',
      ledgerIndex: 300,
      ledgerHash: 'C'.repeat(64),
      endpoint: 'https://devnet.example/',
      startedAt: '2026-07-03T00:03:00.000Z',
    })
    await failSnapshot({
      db,
      snapshotId: 'operator-failed',
      failedAt: '2026-07-03T00:03:01.000Z',
      code: 'operator_test',
      message: 'controlled failure',
    })

    await expect(
      executeD1CurrentStateOperator({
        db,
        input: {
          action: 'mark_cleanup',
          snapshotId: 'operator-failed',
          eligibleAt: '2026-07-03T00:04:00.000Z',
          reason: 'operator integration test',
        },
      }),
    ).resolves.toMatchObject({ action: 'mark_cleanup' })

    await expect(
      executeD1CurrentStateOperator({
        db,
        input: {
          action: 'remove_cleanup',
          snapshotId: 'operator-failed',
          removeAt: '2026-07-03T00:05:00.000Z',
        },
      }),
    ).resolves.toMatchObject({ result: { removed: true } })
  })
})
