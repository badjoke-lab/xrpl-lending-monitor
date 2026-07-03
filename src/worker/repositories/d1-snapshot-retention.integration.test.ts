import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getPlatformProxy } from 'wrangler'

import {
  markSnapshotCleanupEligible,
  removeEligibleSnapshot,
  restorePreviousSnapshot,
} from './d1-snapshot-retention'

let db: D1Database
let disposePlatform: (() => Promise<void>) | undefined

async function applyMigrations(database: D1Database): Promise<void> {
  const directory = resolve(process.cwd(), 'migrations')
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort()
  for (const file of files) {
    await database.exec(await readFile(resolve(directory, file), 'utf8'))
  }
}

async function insertSnapshot(options: {
  id: string
  status: 'verified' | 'failed'
  ledgerIndex: number
  ledgerHash: string
  manifestHash?: string
}): Promise<void> {
  const now = '2026-07-03T00:00:00.000Z'
  await db
    .prepare(
      `INSERT INTO current_state_d1_snapshots (
         id, network, epoch_id, status, ledger_index, ledger_hash, endpoint,
         manifest_hash, started_at, completed_at, verified_at, created_at, updated_at
       ) VALUES (?1, 'devnet', 'epoch-1', ?2, ?3, ?4, 'https://example.invalid',
                 ?5, ?6, ?6, ?7, ?6, ?6)`,
    )
    .bind(
      options.id,
      options.status,
      options.ledgerIndex,
      options.ledgerHash,
      options.manifestHash ?? null,
      now,
      options.status === 'verified' ? now : null,
    )
    .run()

  if (options.manifestHash) {
    await db
      .prepare(
        `INSERT INTO current_state_d1_snapshot_manifests (
           snapshot_id, schema_version, manifest_json, manifest_hash,
           batch_count, object_count, vault_count, loan_broker_count,
           loan_count, normalized_bytes, verified_at, created_at
         ) VALUES (?1, 1, '{}', ?2, 0, 0, 0, 0, 0, 0, ?3, ?3)`,
      )
      .bind(options.id, options.manifestHash, now)
      .run()
  }
}

describe('D1 snapshot retention integration', () => {
  beforeAll(async () => {
    const platform = await getPlatformProxy<{ DB: D1Database }>({
      persist: false,
      remoteBindings: false,
    })
    db = platform.env.DB
    disposePlatform = platform.dispose
    await applyMigrations(db)

    await db
      .prepare(
        `INSERT INTO network_epochs (
           id, network, status, first_ledger_index, first_ledger_hash,
           started_at, created_at, updated_at
         ) VALUES ('epoch-1', 'devnet', 'current', 1, ?1, ?2, ?2, ?2)`,
      )
      .bind('E'.repeat(64), '2026-07-03T00:00:00.000Z')
      .run()

    await db
      .prepare(
        `INSERT INTO sync_state (
           network, epoch_id, last_processed_ledger, last_processed_hash,
           status, created_at, updated_at
         ) VALUES ('devnet', 'epoch-1', 200, ?1, 'healthy', ?2, ?2)`,
      )
      .bind('C'.repeat(64), '2026-07-03T00:00:00.000Z')
      .run()
  }, 60_000)

  afterAll(async () => {
    await disposePlatform?.()
  })

  it('restores a manifest-backed previous snapshot and aligned sync state', async () => {
    await insertSnapshot({
      id: 'current',
      status: 'verified',
      ledgerIndex: 200,
      ledgerHash: 'C'.repeat(64),
      manifestHash: 'c'.repeat(64),
    })
    await insertSnapshot({
      id: 'previous',
      status: 'verified',
      ledgerIndex: 100,
      ledgerHash: 'P'.repeat(64),
      manifestHash: 'p'.repeat(64),
    })

    await db
      .prepare(
        `INSERT INTO current_state_d1_active_snapshots (
           network, epoch_id, snapshot_id, rollback_snapshot_id, activated_at, updated_at
         ) VALUES ('devnet', 'epoch-1', 'current', 'previous', ?1, ?1)`,
      )
      .bind('2026-07-03T00:00:00.000Z')
      .run()

    await expect(
      restorePreviousSnapshot({ db, restoredAt: '2026-07-03T01:00:00.000Z' }),
    ).resolves.toEqual({ snapshotId: 'previous', rollbackSnapshotId: 'current' })

    const pointer = await db
      .prepare(
        `SELECT snapshot_id, rollback_snapshot_id
         FROM current_state_d1_active_snapshots WHERE network = 'devnet'`,
      )
      .first<{ snapshot_id: string; rollback_snapshot_id: string }>()
    expect(pointer).toEqual({ snapshot_id: 'previous', rollback_snapshot_id: 'current' })

    const sync = await db
      .prepare(
        `SELECT epoch_id, last_processed_ledger, last_processed_hash
         FROM sync_state WHERE network = 'devnet'`,
      )
      .first<{
        epoch_id: string
        last_processed_ledger: number
        last_processed_hash: string
      }>()
    expect(sync).toEqual({
      epoch_id: 'epoch-1',
      last_processed_ledger: 100,
      last_processed_hash: 'P'.repeat(64),
    })

    await db
      .prepare(`DELETE FROM current_state_d1_snapshot_manifests WHERE snapshot_id = 'current'`)
      .run()
    await expect(
      restorePreviousSnapshot({ db, restoredAt: '2026-07-03T02:00:00.000Z' }),
    ).rejects.toThrow('matching manifest')
  })

  it('protects resumable attempts and enforces cleanup eligibility time', async () => {
    await insertSnapshot({
      id: 'failed-attempt',
      status: 'failed',
      ledgerIndex: 300,
      ledgerHash: 'F'.repeat(64),
    })

    await db
      .prepare(
        `INSERT INTO current_state_d1_bootstrap_checkpoints (
           snapshot_id, marker_json, next_batch_sequence, scan_complete,
           metrics_json, updated_at
         ) VALUES ('failed-attempt', NULL, 1, 0, '{}', ?1)`,
      )
      .bind('2026-07-03T00:00:00.000Z')
      .run()

    await expect(
      markSnapshotCleanupEligible({
        db,
        snapshotId: 'failed-attempt',
        eligibleAt: '2026-07-05T00:00:00.000Z',
        reason: 'integration-test',
      }),
    ).rejects.toThrow('resumable')

    await db
      .prepare(
        `DELETE FROM current_state_d1_bootstrap_checkpoints
         WHERE snapshot_id = 'failed-attempt'`,
      )
      .run()

    await markSnapshotCleanupEligible({
      db,
      snapshotId: 'failed-attempt',
      eligibleAt: '2026-07-05T00:00:00.000Z',
      reason: 'integration-test',
    })

    await expect(
      removeEligibleSnapshot({
        db,
        snapshotId: 'failed-attempt',
        removeAt: '2026-07-04T00:00:00.000Z',
      }),
    ).resolves.toBe(false)

    await expect(
      removeEligibleSnapshot({
        db,
        snapshotId: 'failed-attempt',
        removeAt: '2026-07-06T00:00:00.000Z',
      }),
    ).resolves.toBe(true)

    const removed = await db
      .prepare(`SELECT id FROM current_state_d1_snapshots WHERE id = 'failed-attempt'`)
      .first<{ id: string }>()
    expect(removed).toBeNull()
  })
})
