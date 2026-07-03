import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { runD1Bootstrap } from '../bootstrap/d1-bootstrap'
import { executeD1CapacityCheck } from './d1-capacity-check'

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

function scanMetrics(): CurrentStateScanMetrics {
  return {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 3,
    requestedObjectsPerPage: 2_048,
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
    decodedObjects: 2_048,
    vaults: [],
    loanBrokers: [],
    loans: [],
  }
}

describe('D1 capacity action integration', () => {
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
         ) VALUES ('epoch-capacity', 'devnet', 'current', 1, ?1, ?2, ?2, ?2)`,
      )
      .bind('E'.repeat(64), now)
      .run()
    await db
      .prepare(
        `INSERT INTO sync_state (
           network, epoch_id, status, created_at, updated_at
         ) VALUES ('devnet', 'epoch-capacity', 'uninitialized', ?1, ?1)`,
      )
      .bind(now)
      .run()

    const result = await runD1Bootstrap({
      db,
      identity: {
        snapshotId: 'capacity-snapshot',
        epochId: 'epoch-capacity',
        endpoint: 'https://devnet.example/',
        ledgerIndex: 100,
        ledgerHash: 'A'.repeat(64),
        objectPrefix: 'd1/capacity-snapshot',
      },
      timeoutMs: 1_000,
      now: () => '2026-07-03T00:01:00.000Z',
      dependencies: {
        scanBatch: async (options) => {
          await options.onPage(terminalPage())
          return {
            endpoint: 'https://devnet.example/',
            ledgerIndex: 100,
            ledgerHash: 'A'.repeat(64),
            complete: true,
            nextMarker: null,
            metrics: scanMetrics(),
          }
        },
      },
    })
    expect(result.status).toBe('verified')
  }, 60_000)

  afterAll(async () => {
    await disposePlatform?.()
  })

  it('uses local D1 size metadata and projects one rollback snapshot', async () => {
    const evidence = await executeD1CapacityCheck({
      db,
      input: {
        action: 'capacity',
        snapshotId: 'capacity-snapshot',
        historyReserveBytes: 50_000_000,
      },
      now: () => '2026-07-03T00:02:00.000Z',
    })

    expect(evidence).toMatchObject({
      schemaVersion: 1,
      action: 'capacity',
      generatedAt: '2026-07-03T00:02:00.000Z',
      result: {
        snapshotId: 'capacity-snapshot',
        snapshotStatus: 'verified',
        additionalSnapshotCount: 1,
        accepted: true,
      },
    })
    expect(evidence.result.currentDatabaseBytes).toBeGreaterThan(0)
    expect(evidence.result.projectedDatabaseBytes).toBeGreaterThan(50_000_000)
  })

  it('rejects an unverified snapshot', async () => {
    await db
      .prepare(
        `INSERT INTO current_state_d1_snapshots (
           id, network, epoch_id, status, ledger_index, ledger_hash, endpoint,
           started_at, created_at, updated_at
         ) VALUES ('capacity-building', 'devnet', 'epoch-capacity', 'building', 101, ?1,
                   'https://devnet.example/', ?2, ?2, ?2)`,
      )
      .bind('B'.repeat(64), '2026-07-03T00:03:00.000Z')
      .run()

    await expect(
      executeD1CapacityCheck({
        db,
        input: {
          action: 'capacity',
          snapshotId: 'capacity-building',
          historyReserveBytes: 0,
        },
      }),
    ).rejects.toThrow('requires a verified snapshot')
  })
})
