import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import { resolveBaseOverlaySnapshotCounts } from './base-overlay-overview'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'BASE',
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'A'.repeat(64),
  vaultCount: 2,
  loanBrokerCount: 3,
  loanCount: 4,
  objectCount: 9,
  shardCount: 1,
  compressedBytes: 0,
  completedAt: '2026-07-04T00:00:00.000Z',
}

function database(deltas: Record<string, { live_created: number; deleted_from_base: number }>): D1Database {
  return {
    prepare() {
      let bindings: unknown[] = []
      const statement = {
        bind(...values: unknown[]) {
          bindings = values
          return statement
        },
        async first<T>() {
          const objectType = String(bindings[2])
          const delta = deltas[objectType] ?? { live_created: 0, deleted_from_base: 0 }
          return {
            object_type: objectType,
            live_created: delta.live_created,
            deleted_from_base: delta.deleted_from_base,
          } as T
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('base plus overlay overview counts', () => {
  it('applies created and deleted deltas without counting modifications', async () => {
    const resolved = await resolveBaseOverlaySnapshotCounts(database({
      vault: { live_created: 1, deleted_from_base: 1 },
      loan_broker: { live_created: 0, deleted_from_base: 1 },
      loan: { live_created: 2, deleted_from_base: 0 },
    }), snapshot)

    expect(resolved.vaultCount).toBe(2)
    expect(resolved.loanBrokerCount).toBe(2)
    expect(resolved.loanCount).toBe(6)
    expect(resolved.objectCount).toBe(10)
  })
})
