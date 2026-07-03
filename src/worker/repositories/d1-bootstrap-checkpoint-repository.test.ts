import { describe, expect, it } from 'vitest'

import {
  loadD1BootstrapCheckpoint,
  updateD1BootstrapMetrics,
} from './d1-bootstrap-checkpoint-repository'

function fakeDatabase(firstValue: unknown = null) {
  const prepared: Array<{ sql: string; values: unknown[]; runs: number }> = []
  const db = {
    prepare(sql: string) {
      const record = { sql, values: [] as unknown[], runs: 0 }
      prepared.push(record)
      const statement = {
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async first<T>() {
          return firstValue as T | null
        },
        async run() {
          record.runs += 1
          return { success: true }
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, prepared }
}

const metrics = {
  pages: 2,
  requests: 2,
  decodedObjects: 160,
  objects: 4,
  elapsedMs: 20,
  requestedObjectsPerPage: 80,
  responseMode: 'binary' as const,
  byType: {
    vault: { objects: 1 },
    loan_broker: { objects: 1 },
    loan: { objects: 2 },
  },
}

describe('D1 bootstrap checkpoint repository', () => {
  it('loads the exact opaque marker and validated cumulative metrics', async () => {
    const { db } = fakeDatabase({
      marker_json: '{"cursor":["opaque",2]}',
      next_batch_sequence: 3,
      scan_complete: 0,
      metrics_json: JSON.stringify(metrics),
      updated_at: '2026-07-03T00:00:00.000Z',
    })

    await expect(loadD1BootstrapCheckpoint(db, 'snapshot-1')).resolves.toEqual({
      snapshotId: 'snapshot-1',
      nextMarker: { cursor: ['opaque', 2] },
      nextBatchSequence: 3,
      scanComplete: false,
      metrics,
      updatedAt: '2026-07-03T00:00:00.000Z',
    })
  })

  it('rejects an incomplete checkpoint that lost its continuation marker', async () => {
    const { db } = fakeDatabase({
      marker_json: null,
      next_batch_sequence: 2,
      scan_complete: 0,
      metrics_json: JSON.stringify(metrics),
      updated_at: '2026-07-03T00:00:00.000Z',
    })

    await expect(loadD1BootstrapCheckpoint(db, 'snapshot-1')).rejects.toThrow(
      'must preserve its exact marker',
    )
  })

  it('updates only cumulative metrics and the checkpoint timestamp', async () => {
    const { db, prepared } = fakeDatabase()
    await updateD1BootstrapMetrics({
      db,
      snapshotId: 'snapshot-1',
      metrics,
      updatedAt: '2026-07-03T00:00:01.000Z',
    })

    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.sql).toContain('UPDATE current_state_d1_bootstrap_checkpoints')
    expect(prepared[0]?.values[1]).toBe('2026-07-03T00:00:01.000Z')
    expect(prepared[0]?.values[2]).toBe('snapshot-1')
    expect(prepared[0]?.runs).toBe(1)
  })
})
