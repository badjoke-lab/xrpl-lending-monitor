import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import { serializeOverview } from './core-api'

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

describe('three-layer Overview serializer', () => {
  it('exposes effective current-state and canonical counts watermarks separately', () => {
    const response = serializeOverview({
      state: null,
      epoch: null,
      snapshot,
      overlay: {
        overlayLedgerIndex: 110,
        overlayLedgerHash: 'C'.repeat(64),
        updatedAt: '2026-07-11T00:10:00.000Z',
      },
      watermarks: {
        currentState: {
          source: 'fast_lane',
          ledgerIndex: 120,
          ledgerHash: 'D'.repeat(64),
          updatedAt: '2026-07-11T00:15:00.000Z',
        },
        counts: {
          source: 'canonical_overlay',
          ledgerIndex: 110,
          ledgerHash: 'C'.repeat(64),
          updatedAt: '2026-07-11T00:10:00.000Z',
        },
      },
    })

    expect(response.current_state_watermark).toEqual({
      source: 'fast_lane',
      ledger_index: 120,
      ledger_hash: 'D'.repeat(64),
      updated_at: '2026-07-11T00:15:00.000Z',
    })
    expect(response.counts_watermark).toEqual({
      source: 'canonical_overlay',
      ledger_index: 110,
      ledger_hash: 'C'.repeat(64),
      updated_at: '2026-07-11T00:10:00.000Z',
    })
    expect(response.freshness).toMatchObject({
      current_state_source: 'fast_lane',
      current_state_ledger: 120,
      current_state_hash: 'D'.repeat(64),
    })
  })
})
