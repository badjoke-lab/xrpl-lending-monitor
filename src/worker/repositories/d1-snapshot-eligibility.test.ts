import { describe, expect, it } from 'vitest'
import { markSnapshotCleanupEligible } from './d1-snapshot-retention'

describe('D1 cleanup eligibility', () => {
  it('rejects protected snapshots', async () => {
    const rows: unknown[] = [
      { id: 's', network: 'devnet', epoch_id: 'e', status: 'failed', ledger_index: 1, ledger_hash: 'A', manifest_hash: null },
      { snapshot_id: 'active' },
    ]
    const db = {
      prepare() {
        return {
          bind() { return this },
          async first<T>() { return (rows.shift() ?? null) as T | null },
          async run() { return { success: true, meta: { changes: 1 } } },
        }
      },
    } as unknown as D1Database

    await expect(markSnapshotCleanupEligible({
      db, snapshotId: 's', eligibleAt: '2026-07-04T00:00:00.000Z', reason: 'test',
    })).rejects.toThrow('cannot become cleanup eligible')
  })
})
