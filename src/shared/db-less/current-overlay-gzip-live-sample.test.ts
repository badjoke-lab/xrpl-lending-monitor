import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../current-state/canonical-json'
import {
  compressDbLessD4Shard,
  decompressDbLessD4Shard,
} from './current-overlay-compressed-shard'

const REPOSITORY = 'badjoke-lab/xrpl-lending-monitor'
const CHANNEL_TAG = 'db-less-current-overlay-channel-v1'

async function getBounded(url: string, limit: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' })
    if (res.ok) {
      const contentLength = res.headers.get('content-length')
      if (contentLength && Number(contentLength) > limit) throw new Error('D4 live sample byte bound exceeded')
      const data = new Uint8Array(await res.arrayBuffer())
      if (data.byteLength > limit) throw new Error('D4 live sample byte bound exceeded')
      return data
    }
    if (attempt === 2 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`D4 live sample HTTP ${res.status}`)
    }
  }
  throw new Error('D4 live sample source exhausted')
}

describe('read-only D4 gzip sample from actual active checkpoint', () => {
  const probe = process.env.RUN_D5_REAL_D4_GZIP_SAMPLE === 'true' ? it : it.skip
  probe('verifies 4 published shards and measures exact decoded-state gzip savings', async () => {
    const api = `https://api.github.com/repos/${REPOSITORY}/releases/tags/${CHANNEL_TAG}`
    const channelRelease = JSON.parse(new TextDecoder().decode(await getBounded(api, 1_000_000))) as { body: string }
    const channel = JSON.parse(channelRelease.body) as {
      active: { manifestKey: string; manifestSha256: string; location: { releaseTag: string } }
    }
    const assetUrl = (key: string) =>
      `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(channel.active.location.releaseTag)}/${encodeURIComponent(key)}`
    const manifestBytes = await getBounded(assetUrl(channel.active.manifestKey), 1_000_000)
    expect(await sha256Hex(manifestBytes)).toBe(channel.active.manifestSha256)
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as {
      throughLedgerIndex: number
      shards: Array<{ key: string; bytes: number; artifactSha256: string }>
    }
    const selected = [...manifest.shards].sort((a, b) => b.bytes - a.bytes).slice(0, 4)
    expect(selected).toHaveLength(4)
    let originalBytes = 0
    let compressedBytes = 0
    for (const shard of selected) {
      const bytes = await getBounded(assetUrl(shard.key), 2_000_000)
      expect(bytes.byteLength).toBe(shard.bytes)
      expect(await sha256Hex(bytes)).toBe(shard.artifactSha256)
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      const compressed = await compressDbLessD4Shard(text)
      const expanded = await decompressDbLessD4Shard(compressed, bytes.byteLength)
      expect(expanded).toBe(text)
      originalBytes += bytes.byteLength
      compressedBytes += compressed.byteLength
    }
    expect(compressedBytes).toBeLessThan(originalBytes)
    console.log('D5_REAL_D4_GZIP_SAMPLE='+JSON.stringify({
      sourceCheckpoint: manifest.throughLedgerIndex,
      totalShardCount: manifest.shards.length,
      sampledShardCount: selected.length,
      originalBytes,
      gzipBytes: compressedBytes,
      savingsPercent: Number(((1 - compressedBytes / originalBytes) * 100).toFixed(2)),
      publicationMutation: false,
    }))
  }, 180_000)
})
