import { describe, expect, it } from 'vitest'

import { createR2BootstrapObjectStore } from './bootstrap-object-store'

function fakeBucket() {
  const objects = new Map<string, { size: number; sha256: string }>()
  const puts: string[] = []
  const bucket = {
    async head(key: string) {
      const value = objects.get(key)
      return value
        ? { key, size: value.size, customMetadata: { sha256: value.sha256 } }
        : null
    },
    async put(
      key: string,
      value: Uint8Array,
      options: { customMetadata?: { sha256?: string } },
    ) {
      puts.push(key)
      const sha256 = options.customMetadata?.sha256 ?? ''
      objects.set(key, { size: value.byteLength, sha256 })
      return { key, size: value.byteLength, customMetadata: { sha256 } }
    },
  }
  return { bucket: bucket as unknown as R2Bucket, objects, puts }
}

describe('R2 bootstrap object store', () => {
  it('stores and reuses a matching digest-bound shard', async () => {
    const state = fakeBucket()
    const store = createR2BootstrapObjectStore(state.bucket)
    const key = 'snapshot/shard-1.gz'
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sha256 = 'a'.repeat(64)

    await expect(store.putShard({ key, bytes, sha256 })).resolves.toEqual({ storedBytes: 4 })
    await expect(store.putShard({ key, bytes, sha256 })).resolves.toEqual({ storedBytes: 4 })
    expect(state.puts).toEqual([key])
  })

  it('rejects a reused key with a different digest', async () => {
    const state = fakeBucket()
    const store = createR2BootstrapObjectStore(state.bucket)
    const key = 'snapshot/shard-1.gz'
    const bytes = new Uint8Array([1, 2, 3, 4])

    await store.putShard({ key, bytes, sha256: 'a'.repeat(64) })
    await expect(
      store.putShard({ key, bytes, sha256: 'b'.repeat(64) }),
    ).rejects.toThrow('already contains different content')
  })

  it('verifies manifest digest metadata', async () => {
    const state = fakeBucket()
    const store = createR2BootstrapObjectStore(state.bucket)
    const key = 'snapshot/manifest.json'
    const bytes = new Uint8Array([5, 6, 7])
    const sha256 = 'c'.repeat(64)

    await store.putManifest({ key, bytes, sha256 })
    await expect(store.verifyManifest({ key, sha256 })).resolves.toBe(true)
    await expect(store.verifyManifest({ key, sha256: 'd'.repeat(64) })).resolves.toBe(false)
  })
})
