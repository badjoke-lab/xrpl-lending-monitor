import { describe, expect, it } from 'vitest'

import { removeEligibleSnapshot } from './d1-snapshot-retention'

describe('D1 snapshot retention', () => {
  it('keeps cleanup guarded by status, time, pointers, and checkpoints', async () => {
    const statements: string[] = []
    const db = {
      prepare(sql: string) {
        statements.push(sql)
        return {
          bind() {
            return this
          },
          async run() {
            return { success: true, meta: { changes: 0 } }
          },
        }
      },
    } as unknown as D1Database

    await expect(
      removeEligibleSnapshot({
        db,
        snapshotId: 'snapshot-1',
        removeAt: '2026-07-05T00:00:00.000Z',
      }),
    ).resolves.toBe(false)

    expect(statements[0]).toContain("status IN ('failed', 'superseded')")
    expect(statements[0]).toContain('eligible_at <=')
    expect(statements[0]).toContain('current_state_d1_active_snapshots')
    expect(statements[0]).toContain('current_state_d1_bootstrap_checkpoints')
  })
})
