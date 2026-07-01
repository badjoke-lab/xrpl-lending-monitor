import { describe, expect, it, vi } from 'vitest'

import { executeBootstrapCleanup, planBootstrapCleanup } from './bootstrap-cleanup'

const snapshotId = 'snapshot-1'
const objectPrefix = `current/devnet/${snapshotId}`
const shard1 = `${objectPrefix}/shards/page-00000001.json.gz`
const shard2 = `${objectPrefix}/shards/page-00000002.json.gz`
const manifest = `${objectPrefix}/manifest.json`

describe('bootstrap cleanup', () => {
  it('plans deletion only for unprotected objects under a failed snapshot prefix', () => {
    const plan = planBootstrapCleanup({
      snapshotId,
      objectPrefix,
      listedKeys: [shard2, manifest, shard1, shard1],
      protectedKeys: new Set([manifest]),
      checkpointExists: false,
      snapshotStatus: 'failed',
    })

    expect(plan.objectPrefix).toBe(`${objectPrefix}/`)
    expect(plan.deleteKeys).toEqual([shard1, shard2])
    expect(plan.retainedKeys).toEqual([manifest])
  })

  it('rejects cleanup while a resumable checkpoint exists', () => {
    expect(() =>
      planBootstrapCleanup({
        snapshotId,
        objectPrefix,
        listedKeys: [shard1],
        protectedKeys: new Set(),
        checkpointExists: true,
        snapshotStatus: 'failed',
      }),
    ).toThrow('resumable checkpoint exists')
  })

  it.each(['building', 'active'] as const)('rejects cleanup of a %s snapshot', (snapshotStatus) => {
    expect(() =>
      planBootstrapCleanup({
        snapshotId,
        objectPrefix,
        listedKeys: [shard1],
        protectedKeys: new Set(),
        checkpointExists: false,
        snapshotStatus,
      }),
    ).toThrow(`prohibited for ${snapshotStatus} snapshots`)
  })

  it('rejects a broad prefix that is not scoped to the snapshot', () => {
    expect(() =>
      planBootstrapCleanup({
        snapshotId,
        objectPrefix: 'current/devnet',
        listedKeys: [shard1],
        protectedKeys: new Set(),
        checkpointExists: false,
        snapshotStatus: 'failed',
      }),
    ).toThrow('prefix is not scoped to the snapshot ID')
  })

  it('rejects any listed key outside the approved prefix', () => {
    expect(() =>
      planBootstrapCleanup({
        snapshotId,
        objectPrefix,
        listedKeys: [shard1, 'current/devnet/other-snapshot/manifest.json'],
        protectedKeys: new Set(),
        checkpointExists: false,
        snapshotStatus: 'superseded',
      }),
    ).toThrow('outside the snapshot prefix')
  })

  it('deletes planned objects in bounded batches', async () => {
    const deleteObjects = vi.fn(async (_keys: readonly string[]) => undefined)
    const result = await executeBootstrapCleanup({
      plan: {
        snapshotId,
        objectPrefix: `${objectPrefix}/`,
        deleteKeys: [shard1, shard2, `${objectPrefix}/shards/page-00000003.json.gz`],
        retainedKeys: [manifest],
      },
      deleteObjects,
      batchSize: 2,
    })

    expect(deleteObjects).toHaveBeenNthCalledWith(1, [shard1, shard2])
    expect(deleteObjects).toHaveBeenNthCalledWith(2, [
      `${objectPrefix}/shards/page-00000003.json.gz`,
    ])
    expect(result).toEqual({ deletedObjects: 3 })
  })
})
