import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { SpillBucketStore } from './history-exact-index-spill'

interface TestRecord {
  id: number
  value: string
}

const temporaryRoots: string[] = []

async function createStore(maxBufferedRecords = 2) {
  const root = await mkdtemp(join(tmpdir(), 'history-exact-index-spill-'))
  temporaryRoots.push(root)
  const store = new SpillBucketStore<TestRecord>({
    root,
    bucketCount: 3,
    maxBufferedRecords,
    serialize: (value) => JSON.stringify(value),
    parse: (value) => JSON.parse(value) as TestRecord,
  })
  await store.initialize()
  return { root, store }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    const store = new SpillBucketStore<TestRecord>({
      root,
      bucketCount: 1,
      maxBufferedRecords: 1,
      serialize: (value) => JSON.stringify(value),
      parse: (value) => JSON.parse(value) as TestRecord,
    })
    await store.cleanup()
  }))
})

describe('SpillBucketStore', () => {
  it('flushes bounded buffers into compressed chunks without losing bucket order', async () => {
    const { store } = await createStore()

    expect(store.add(1, { id: 1, value: 'first' })).toBe(false)
    expect(store.add(2, { id: 2, value: 'other bucket' })).toBe(true)
    await store.flush()
    expect(store.add(1, { id: 3, value: 'second' })).toBe(false)
    expect(store.add(1, { id: 4, value: 'third' })).toBe(true)
    await store.flush()

    await expect(store.readBucket(0)).resolves.toEqual([])
    await expect(store.readBucket(1)).resolves.toEqual([
      { id: 1, value: 'first' },
      { id: 3, value: 'second' },
      { id: 4, value: 'third' },
    ])
    await expect(store.readBucket(2)).resolves.toEqual([
      { id: 2, value: 'other bucket' },
    ])
  })

  it('removes temporary spill chunks during cleanup', async () => {
    const { root, store } = await createStore(1)
    store.add(0, { id: 1, value: 'record' })
    await store.flush()
    await store.cleanup()

    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects buckets outside the configured range', async () => {
    const { store } = await createStore()
    expect(() => store.add(3, { id: 1, value: 'invalid' })).toThrow('bucket must be between 0 and 2')
    await expect(store.readBucket(-1)).rejects.toThrow('bucket must be between 0 and 2')
  })
})
