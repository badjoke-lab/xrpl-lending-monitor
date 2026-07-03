import { describe, expect, it, vi } from 'vitest'

import type { ScannedLedgerObject } from '../../collector/current-state/scan-ledger-objects'
import type { CurrentStatePage } from '../../collector/current-state/scan-current-state'
import { persistPageBatches } from './page-batching'

function vault(index: number): ScannedLedgerObject {
  return {
    LedgerEntryType: 'Vault',
    index: index.toString(16).padStart(64, '0').toUpperCase(),
    BinaryHex: '00',
  }
}

function page(vaults: ScannedLedgerObject[]): CurrentStatePage {
  return {
    pageNumber: 1,
    markerBefore: { cursor: 'before' },
    markerAfter: { cursor: 'after' },
    firstLedgerIndex: vaults[0]?.index ?? null,
    lastLedgerIndex: vaults.at(-1)?.index ?? null,
    decodedObjects: 2_048,
    vaults,
    loanBrokers: [],
    loans: [],
  }
}

const metrics = {
  pages: 1,
  requests: 1,
  decodedObjects: 2_048,
  objects: 81,
  elapsedMs: 0,
  requestedObjectsPerPage: 2_048,
  responseMode: 'binary' as const,
  byType: {
    vault: { objects: 81 },
    loan_broker: { objects: 0 },
    loan: { objects: 0 },
  },
}

describe('bootstrap page batching', () => {
  it('chunks a large ledger page and advances the marker only after its final chunk', async () => {
    const writeBatch = vi.fn(async () => ({
      status: 'stored' as const,
      batchHash: 'a'.repeat(64),
      objectCount: 0,
      normalizedBytes: 0,
    }))
    const times = ['2026-07-03T00:00:00.000Z', '2026-07-03T00:00:01.000Z', '2026-07-03T00:00:02.000Z']

    const result = await persistPageBatches({
      db: {} as D1Database,
      snapshotId: 'snapshot-1',
      page: page(Array.from({ length: 81 }, (_, index) => vault(index + 1))),
      metrics,
      nextSequence: 4,
      now: () => times.shift() ?? '2026-07-03T00:00:03.000Z',
      writeBatch,
    })

    expect(result.nextSequence).toBe(6)
    expect(writeBatch).toHaveBeenCalledTimes(2)
    expect(writeBatch.mock.calls[0]?.[1]).toMatchObject({
      sequence: 4,
      decodedObjectCount: 0,
      markerAfter: { cursor: 'before' },
      advanceCheckpoint: false,
    })
    expect(writeBatch.mock.calls[0]?.[1].vaults).toHaveLength(80)
    expect(writeBatch.mock.calls[1]?.[1]).toMatchObject({
      sequence: 5,
      decodedObjectCount: 2_048,
      markerAfter: { cursor: 'after' },
      advanceCheckpoint: true,
    })
    expect(writeBatch.mock.calls[1]?.[1].vaults).toHaveLength(1)
  })
})
