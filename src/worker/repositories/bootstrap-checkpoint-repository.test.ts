import { describe, expect, it } from 'vitest'

import type { BootstrapCheckpoint } from '../../collector/current-state/bootstrap-runner'
import { createD1BootstrapCheckpointStore } from './bootstrap-checkpoint-repository'

interface RecordedStatement {
  sql: string
  values: unknown[]
  runCount: number
  firstCount: number
}

function fakeDatabase(firstRow: unknown = null) {
  const prepared: RecordedStatement[] = []
  const db = {
    prepare(sql: string) {
      const record: RecordedStatement = {
        sql,
        values: [],
        runCount: 0,
        firstCount: 0,
      }
      prepared.push(record)
      const statement = {
        bind(...values: unknown[]) {
          record.values = values
          return statement
        },
        async run() {
          record.runCount += 1
          return { success: true }
        },
        async first<T>() {
          record.firstCount += 1
          return firstRow as T | null
        },
      }
      return statement
    },
  }
  return { db: db as unknown as D1Database, prepared }
}

function checkpoint(): BootstrapCheckpoint {
  return {
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    epochId: 'epoch-1',
    endpoint: 'https://devnet.example',
    ledgerIndex: 123,
    ledgerHash: 'A'.repeat(64),
    objectPrefix: 'current/devnet/epoch-1/snapshot-1',
    nextMarker: 'marker-1',
    nextPageNumber: 2,
    scanComplete: false,
    metrics: {
      pages: 1,
      requests: 1,
      decodedObjects: 2_048,
      objects: 3,
      elapsedMs: 100,
      requestedObjectsPerPage: 2_048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 1 },
        loan: { objects: 1 },
      },
    },
    shards: [
      {
        key: 'current/devnet/epoch-1/snapshot-1/shards/page-00000001.json.gz',
        pageNumber: 1,
        firstLedgerIndex: '0001',
        lastLedgerIndex: '0002',
        decodedObjects: 2_048,
        vaultCount: 1,
        loanBrokerCount: 1,
        loanCount: 1,
        compressedBytes: 100,
        sha256: 'a'.repeat(64),
      },
    ],
  }
}

describe('D1 bootstrap checkpoint store', () => {
  it('upserts the complete checkpoint JSON and operational columns', async () => {
    const { db, prepared } = fakeDatabase()
    const store = createD1BootstrapCheckpointStore(db, () => '2026-07-01T00:00:00.000Z')
    const value = checkpoint()

    await store.save(value)

    expect(prepared).toHaveLength(1)
    expect(prepared[0]?.sql).toContain('ON CONFLICT(snapshot_id) DO UPDATE')
    expect(prepared[0]?.values).toEqual([
      value.snapshotId,
      JSON.stringify(value),
      2,
      0,
      '2026-07-01T00:00:00.000Z',
    ])
    expect(prepared[0]?.runCount).toBe(1)
  })

  it('loads and validates a checkpoint row', async () => {
    const value = checkpoint()
    const { db, prepared } = fakeDatabase({ checkpoint_json: JSON.stringify(value) })
    const store = createD1BootstrapCheckpointStore(db)

    await expect(store.load(value.snapshotId)).resolves.toEqual(value)
    expect(prepared[0]?.values).toEqual([value.snapshotId])
    expect(prepared[0]?.firstCount).toBe(1)
  })

  it('rejects malformed checkpoint JSON', async () => {
    const { db } = fakeDatabase({ checkpoint_json: '{broken' })
    const store = createD1BootstrapCheckpointStore(db)

    await expect(store.load('snapshot-1')).rejects.toThrow('Bootstrap checkpoint JSON is invalid')
  })

  it('clears a checkpoint only by snapshot ID', async () => {
    const { db, prepared } = fakeDatabase()
    const store = createD1BootstrapCheckpointStore(db)

    await store.clear('snapshot-1')

    expect(prepared[0]?.sql).toContain('DELETE FROM current_state_bootstrap_checkpoints')
    expect(prepared[0]?.values).toEqual(['snapshot-1'])
    expect(prepared[0]?.runCount).toBe(1)
  })
})
