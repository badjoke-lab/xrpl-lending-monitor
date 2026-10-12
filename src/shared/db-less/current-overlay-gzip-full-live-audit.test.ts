/**
 * Read-only D5 qualification of ALL currently published D4 shards.
 * Not a release builder, not a publisher, and never an activation control.
 * Existing v2 JSON is authenticated by the active channel + per-shard SHA.
 */
import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  compressDbLessD4Shard,
  decompressDbLessD4Shard,
} from './current-overlay-compressed-shard'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const CHANNEL = 'db-less-current-overlay-channel-v1'
const MAX_SHARD_BYTES = 2_000_000
const CONCURRENCY = 3

type Shard = { bucket: number; key: string; records: number; bytes: number; artifactSha256: string }
type Body = {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  bucket: number
  bucketCount: number
  records: Array<{ isTombstone: boolean }>
}
type Result = {
  bucket: number
  rawBytes: number
  gzipBytes: number
  stableGzipBytes: number
  records: number
  tombstones: number
}

async function bounded(url: string, maxBytes: number): Promise<Uint8Array> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let response: Response | null = null
    try {
      response = await fetch(url, {
        redirect: 'follow',
        headers: { Accept: 'application/octet-stream' },
        signal: AbortSignal.timeout(60_000),
      })
    } catch {
      if (attempt === 3) throw new Error('D4 full audit upstream transport exhausted')
    }
    if (!response) continue
    if (!response.ok) {
      if (attempt === 3 || ![429, 500, 502, 503, 504].includes(response.status)) {
        throw new Error(`D4 full audit upstream HTTP ${response.status}: ${url}`)
      }
      continue
    }
    const declared = response.headers.get('content-length')
    if (declared !== null && (!Number.isSafeInteger(Number(declared)) || Number(declared) > maxBytes)) {
      throw new Error('D4 full audit declared bytes exceed strict bound')
    }
    if (!response.body) throw new Error('D4 full audit response has no body')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel()
        throw new Error('D4 full audit streamed bytes exceed strict bound')
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return bytes
  }
  throw new Error('D4 full audit did not receive immutable asset')
}

describe('D5 full active D4 checkpoint gzip economics', () => {
  const audit = process.env.RUN_D5_REAL_D4_FULL_AUDIT === 'true' ? it : it.skip
  audit('SHA-verifies every shard, decompresses losslessly, and measures 256-shard totals', async () => {
    const api = `https://api.github.com/repos/${REPO}/releases/tags/${CHANNEL}`
    const rawChannel = JSON.parse(new TextDecoder().decode(await bounded(api, 1_000_000))) as { body: string }
    const active = JSON.parse(rawChannel.body) as {
      active: { manifestKey: string; manifestSha256: string; location: { releaseTag: string } }
    }
    const asset = (key: string) =>
      `https://github.com/${REPO}/releases/download/${encodeURIComponent(active.active.location.releaseTag)}/${encodeURIComponent(key)}`
    const manifestBytes = await bounded(asset(active.active.manifestKey), 1_000_000)
    expect(await sha256Hex(manifestBytes)).toBe(active.active.manifestSha256)
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as {
      throughLedgerIndex: number
      entryCount: number
      tombstoneCount: number
      bucketCount: number
      shards: Shard[]
    }
    expect(manifest.bucketCount).toBe(256)
    expect(manifest.shards).toHaveLength(256)
    const seen = new Set<string>()
    for (const shard of manifest.shards) {
      if (seen.has(shard.key)) throw new Error('Duplicate D4 published shard')
      seen.add(shard.key)
      expect(shard.bytes).toBeLessThanOrEqual(MAX_SHARD_BYTES)
    }
    const results = new Array<Result>(manifest.shards.length)
    let next = 0
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      for (;;) {
        const index = next++
        if (index >= manifest.shards.length) return
        const shard = manifest.shards[index]!
        const bytes = await bounded(asset(shard.key), MAX_SHARD_BYTES)
        expect(bytes.byteLength).toBe(shard.bytes)
        expect(await sha256Hex(bytes)).toBe(shard.artifactSha256)
        const original = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        const body = JSON.parse(original) as Body
        expect(body.schemaVersion).toBe(1)
        expect(body.network).toBe('devnet')
        expect(body.bucket).toBe(shard.bucket)
        expect(body.bucketCount).toBe(manifest.bucketCount)
        expect(body.throughLedgerIndex).toBe(manifest.throughLedgerIndex)
        expect(body.records).toHaveLength(shard.records)
        const gzip = await compressDbLessD4Shard(original)
        const expanded = await decompressDbLessD4Shard(gzip, bytes.byteLength)
        expect(expanded).toBe(original)
        const stableText = `${canonicalJson({
          schemaVersion: body.schemaVersion,
          network: body.network,
          epochId: body.epochId,
          baseIdentity: body.baseIdentity,
          bucket: body.bucket,
          bucketCount: body.bucketCount,
          records: body.records,
        })}\n`
        const stable = await compressDbLessD4Shard(stableText)
        const stableExpanded = await decompressDbLessD4Shard(stable, utf8(stableText).byteLength)
        expect(stableExpanded).toBe(stableText)
        results[index] = {
          bucket: shard.bucket,
          rawBytes: bytes.byteLength,
          gzipBytes: gzip.byteLength,
          stableGzipBytes: stable.byteLength,
          records: body.records.length,
          tombstones: body.records.filter(r => r.isTombstone).length,
        }
      }
    }))
    const sum = (key: keyof Pick<Result, 'rawBytes' | 'gzipBytes' | 'stableGzipBytes' | 'records' | 'tombstones'>) =>
      results.reduce((total, item) => total + item[key], 0)
    const rawBytes = sum('rawBytes')
    const gzipBytes = sum('gzipBytes')
    const stableGzipBytes = sum('stableGzipBytes')
    expect(sum('records')).toBe(manifest.entryCount)
    expect(sum('tombstones')).toBe(manifest.tombstoneCount)
    expect(gzipBytes).toBeLessThan(rawBytes)
    expect(stableGzipBytes).toBeLessThan(rawBytes)
    console.log('D5_D4_FULL_256_GZIP_AUDIT='+JSON.stringify({
      checkpointLedger: manifest.throughLedgerIndex,
      shardsVerified: results.length,
      entriesVerified: sum('records'),
      tombstonesVerified: sum('tombstones'),
      rawBytes,
      legacyGzipBytes: gzipBytes,
      stableGzipBytes,
      legacyGzipSavingsPercent: Number(((1 - gzipBytes / rawBytes) * 100).toFixed(2)),
      stableGzipSavingsPercent: Number(((1 - stableGzipBytes / rawBytes) * 100).toFixed(2)),
      sampleIsExhaustive: true,
      releaseMutations: 0,
    }))
  }, 900_000)
})
