import { describe, expect, it } from 'vitest'
import {
  gzipDbLessCurrentOnlyJson,
  gunzipDbLessCurrentOnlyJson,
  MAX_CURRENT_ONLY_UNCOMPRESSED_BYTES,
} from './current-only-gzip'

describe('D5 Current-only gzip codec bounds', () => {
  it('round trips identical canonical text using Web Streams for Node and browser', async () => {
    const json = `{"records":[${Array.from({ length: 100 }, (_, i) => JSON.stringify({ index: i, type: 'vault' })).join(',')}]}\n`
    const compressed = await gzipDbLessCurrentOnlyJson(json)
    expect(compressed.byteLength).toBeLessThan(new TextEncoder().encode(json).byteLength)
    expect(await gunzipDbLessCurrentOnlyJson(compressed)).toBe(json)
  })

  it('refuses a gzip bomb even when the compressed input is tiny', async () => {
    const compressed = await gzipDbLessCurrentOnlyJson('x'.repeat(150_000))
    expect(compressed.byteLength).toBeLessThan(400)
    await expect(gunzipDbLessCurrentOnlyJson(compressed, 1_024)).rejects.toThrow(/decompressed bytes/)
  })

  it('rejects corrupt gzip and invalid decompression limits', async () => {
    await expect(gunzipDbLessCurrentOnlyJson(new Uint8Array([1, 2, 3]))).rejects.toThrow()
    const compressed = await gzipDbLessCurrentOnlyJson('ok')
    await expect(gunzipDbLessCurrentOnlyJson(compressed, 0)).rejects.toThrow(/bound/)
    expect(MAX_CURRENT_ONLY_UNCOMPRESSED_BYTES).toBe(2_000_000)
  })
})
