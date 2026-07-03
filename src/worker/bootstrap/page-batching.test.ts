import { describe, expect, it, vi } from 'vitest'

import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { CurrentStatePage, CurrentStateScanMetrics } from '../../collector/current-state/scan-current-state'
import { persistPageBatches } from './page-batching'

function vault(index: number): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault',
    index: index.toString(16).padStart(64, '0').toUpperCase(),
    BinaryHex: '00',
  }
}

function page(vaults: ScannedLedgerObject[], markerAfter: unknown): CurrentStatePage {
  return {
    pageNumber: 1,
    markerBefore: { cursor: 'before' },
    markerAfter,
    firstLedgerIndex: vaults[0]?.index ?? null,
    lastLedgerIndex: vaults.at(-1)?.index ?? null,
    decodedObjects: 2_048,
    vaults,
    loanBrokers: [],
    loans: [],
  }
}

const metrics: CurrentStateScanMetrics = {
  pages: 1,
  requests: 1,
  decodedObjects: 2_048,
  objects: 81,
  elapsedMs: 0,
  requestedObjectsPerPage: 2_048,
  responseMode: 'binary',
  byType: {
    vault: { objects: 81 },
    loan_broker: { objects: 0 },
    loan: { objects: 0 },
  },
}

describe('D1 bootstrap page batching', () => {
  it('writes 81 relevant objects as two batches and advances the marker last', async () => {
    const writeBatch = vi.fn(async () => ({
      status: 'stored' as const,
      batchHash: 'A'.repeat(64),
      objectCount: 0,
      normalizedBytes: 0,
    }))
    const times = ['2026-07-03T00:00:00.000Z', '2026-07-03T00:00:01.000Z']

    const result = await persistPageBatches({
      db: {} as D1Database,
      snapshotId: 'snapshot-1',
      page: page(Array.from({ length: 81 }, (_, index) => vault(index + 1)), { cursor: 'after' }),
      cumulativeMetrics: metrics,
      nextSequence: 4,
      now: () => times.shift() ?? '2026-07-03T00:00:02.000Z',
      writeBatch,
    })

    expect(result).toEqual({
      nextSequence: 6,
      updatedAt: '2026-07-03T00:00:01.000Z',
    })
    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(writeBatch.mock.calls[0]?.[1]).toMatchObject({
      sequence: 4,
      markerAfter: { cursor: 'before' },
      decodedObjectCount: 0,
      advanceCheckpoint: false,
    })
    expect(writeBatch.mock.calls[0]?.[1].vaults).toHaveLength(80)
    expect(writeBatch.mock.calls[1]?.[1]).toMatchObject({
      sequence: 5,
      markerAfter: { cursor: 'after' },
      decodedObjectCount: 2_048,
      advanceCheckpoint: true,
    })
    expect(writeBatch.mock.calls[1]?.[1].vaults).toHaveLength(1)
  })

  it('writes one final empty batch so an empty page can advance its marker', async () => {
    const writeBatch = vi.fn(async () => ({
      status: 'stored' as const,
      batchHash: 'B'.repeat(64),
      objectCount: 0,
      normalizedBytes: 0,
    }))

    const result = await persistPageBatches({
      db: {} as D1Database,
      snapshotId: 'snapshot-empty',
      page: page([], null),
      cumulativeMetrics: {
        ...metrics,
        objects: 0,
        byType: {
          vault: { objects: 0 },
          loan_broker: { objects: 0 },
          loan: { objects: 0 },
        },
      },
      nextSequence: 1,
      now: () => '2026-07-03T00:00:00.000Z',
      writeBatch,
    })

    expect(result.nextSequence).toBe(2)
    expect(writeBatch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      sequence: 1,
      markerAfter: null,
      decodedObjectCount: 2_048,
      advanceCheckpoint: true,
      vaults: [],
      loanBrokers: [],
      loans: [],
    }))
  })
})
