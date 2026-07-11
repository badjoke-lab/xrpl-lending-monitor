import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from './core-api-repository'
import { resolveThreeLayerOverviewWatermarks } from './three-layer-overview-watermark'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 100,
  ledgerHash: 'A'.repeat(64),
  objectPrefix: 'read-model/',
  manifestKey: 'read-model/manifest.json',
  manifestSha256: 'B'.repeat(64),
  vaultCount: 2,
  loanBrokerCount: 3,
  loanCount: 5,
  objectCount: 10,
  shardCount: 3,
  compressedBytes: 0,
  completedAt: '2026-07-11T00:00:00.000Z',
}

const overlay = {
  overlayLedgerIndex: 110,
  overlayLedgerHash: 'C'.repeat(64),
  updatedAt: '2026-07-11T00:10:00.000Z',
}

function database(options: {
  fastLedger?: number
  fastHash?: string
  fastStatus?: 'healthy' | 'behind' | 'error'
  boundSnapshotId?: string
} = {}): D1Database {
  return {
    prepare(sql: string) {
      const statement = {
        bind() {
          return statement
        },
        async first<T>() {
          if (sql.includes('FROM fast_lane_shadow_base_binding')) {
            return {
              shadow_epoch_id: 'fast-lane-shadow-devnet',
              base_epoch_id: snapshot.epochId,
              base_snapshot_id: options.boundSnapshotId ?? snapshot.id,
              base_ledger_index: snapshot.ledgerIndex,
              base_ledger_hash: snapshot.ledgerHash,
              bound_at: '2026-07-11T00:01:00.000Z',
            } as T
          }
          if (sql.includes('FROM fast_lane_shadow_state')) {
            const ledger = options.fastLedger ?? 120
            return {
              epoch_id: 'fast-lane-shadow-devnet',
              last_processed_ledger: ledger,
              last_processed_hash: options.fastHash ?? 'D'.repeat(64),
              latest_observed_ledger: ledger,
              latest_observed_hash: options.fastHash ?? 'D'.repeat(64),
              status: options.fastStatus ?? 'healthy',
              updated_at: '2026-07-11T00:15:00.000Z',
            } as T
          }
          return null
        },
      }
      return statement
    },
  } as unknown as D1Database
}

describe('three-layer Overview watermarks', () => {
  it('uses a newer eligible fast-lane head for current state while keeping counts canonical', async () => {
    const result = await resolveThreeLayerOverviewWatermarks({
      db: database(),
      snapshot,
      overlay,
    })

    expect(result.currentState).toMatchObject({
      source: 'fast_lane',
      ledgerIndex: 120,
      ledgerHash: 'D'.repeat(64),
    })
    expect(result.counts).toMatchObject({
      source: 'canonical_overlay',
      ledgerIndex: 110,
      ledgerHash: overlay.overlayLedgerHash,
    })
  })

  it('keeps the canonical overlay watermark when it is ahead of fast lane', async () => {
    const result = await resolveThreeLayerOverviewWatermarks({
      db: database({ fastLedger: 109 }),
      snapshot,
      overlay,
    })
    expect(result.currentState).toMatchObject({
      source: 'canonical_overlay',
      ledgerIndex: 110,
    })
  })

  it('fails closed to canonical overlay for same-ledger hash disagreement', async () => {
    const result = await resolveThreeLayerOverviewWatermarks({
      db: database({ fastLedger: 110, fastHash: 'E'.repeat(64) }),
      snapshot,
      overlay,
    })
    expect(result.currentState).toMatchObject({
      source: 'canonical_overlay',
      ledgerHash: overlay.overlayLedgerHash,
    })
  })

  it('falls back to the base snapshot when fast binding is ineligible and overlay is absent', async () => {
    const result = await resolveThreeLayerOverviewWatermarks({
      db: database({ boundSnapshotId: 'different-snapshot' }),
      snapshot,
      overlay: null,
    })
    expect(result.currentState).toMatchObject({
      source: 'base_snapshot',
      ledgerIndex: 100,
      ledgerHash: snapshot.ledgerHash,
    })
    expect(result.counts).toMatchObject({
      source: 'base_snapshot',
      ledgerIndex: 100,
    })
  })
})
