import { describe, expect, it } from 'vitest'

import { markSnapshotCleanupEligible } from './d1-snapshot-retention'

describe('D1 cleanup eligibility', () => {
  it('rejects active or rollback snapshots', async () => {
    const rows: unknown[] = [
      {
        id: 'snapshot-1',
        network: 'devnet',
        epoch_id: 'epoch-1',
        status: 'failed',
        ledger_index: 1,
        ledger_hash: 'A',
        manifest_hash: null,
      },
      { snapshot_id: 'snapshot-1' },
      null,
    ]
    const db = {
      prepare() {
        return {
          bind() {
            return this
          },
          async first<T>() {
            return (rows.shift() ?? null) as T | null
          },
          async run() {
            return { success: true, meta: { changes: 1 } }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      markSnapshotCleanupEligible({
        db,
        snapshotId: 'snapshot-1',
        eligibleAt: '2026-07-04T00:00:00.000Z',
        reason: 'test',
      }),
    ).rejects.toThrow('cannot become cleanup eligible')
  })

  it('rejects a resumable snapshot with a checkpoint', async () => {
    const rows: unknown[] = [
      {
        id: 'snapshot-2',
        network: 'devnet',
        epoch_id: 'epoch-1',
        status: 'failed',
        ledger_index: 2,
        ledger_hash: 'B',
        manifest_hash: null,
      },
      null,
      { snapshot_id: 'snapshot-2' },
    ]
    const db = {
      prepare() {
        return {
          bind() {
            return this
          },
          async first<T>() {
            return (rows.shift() ?? null) as T | null
          },
          async run() {
            return { success: true, meta: { changes: 1 } }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      markSnapshotCleanupEligible({
        db,
        snapshotId: 'snapshot-2',
        eligibleAt: '2026-07-04T00:00:00.000Z',
        reason: 'test',
      }),
    ).rejects.toThrow('resumable')
  })
})
