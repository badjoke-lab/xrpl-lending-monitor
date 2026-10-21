import { describe, expect, it } from 'vitest'
import { sha256Hex, utf8 } from '../current-state/canonical-json'
import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'
import {
  compressDbLessD4Shard,
  decompressDbLessD4Shard,
} from './current-overlay-compressed-shard'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'
import { buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'

const HASH = 'A'.repeat(64)

function current(id: number, tombstone = false): NormalizedCandidateV1 {
  const objectId = `V-${String(id).padStart(5, '0')}`
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey('vault', objectId),
    sourceLedgerIndex: 101,
    sourceLedgerHash: HASH,
    sourceTransactionHash: 'F'.repeat(64),
    objectId,
    relationshipIds: ['owner:alice'],
    isTombstone: tombstone,
    value: tombstone ? null : { kind: 'vault', assets: '1000', account: 'rAlice', id: objectId },
  }
}

async function checkpoint(gzipShards: boolean) {
  const value = await buildDbLessCurrentOverlayCheckpoint({
    epochId: 'epoch-replay',
    baseIdentity: 'base-replay',
    throughLedgerIndex: 101,
    throughLedgerHash: HASH,
    bucketCount: 8,
    maxBytesPerShard: 2_000_000,
    gzipShards,
    generations: [{
      generationId: 'g1',
      startLedgerIndex: 101,
      endLedgerIndex: 101,
      records: Array.from({ length: 320 }, (_, n) => current(n, n % 20 === 0)),
    }],
  })
  const artifacts = new Map(value.shardArtifacts.map(a => [a.key, a.bytes] as const))
  const reader = new DbLessCurrentOverlayReader({
    manifest: value.manifest,
    readArtifact: async (key) => artifacts.get(key) ?? null,
  })
  return { value, artifacts, reader }
}

describe('isolated D4 gzip checkpoint prototype', () => {
  it('preserves exact state and tombstones with far fewer artifact bytes', async () => {
    const [legacy, compressed] = await Promise.all([checkpoint(false), checkpoint(true)])
    const original = await legacy.reader.readAll()
    const next = await compressed.reader.readAll()
    expect(next.items).toEqual(original.items)
    expect(next.shardReads).toBe(original.shardReads)
    expect(compressed.value.manifest.entryCount).toBe(320)
    expect(compressed.value.manifest.tombstoneCount).toBe(16)
    const before = legacy.value.shardArtifacts.reduce((sum, a) => sum + a.bytes.byteLength, 0)
    const after = compressed.value.shardArtifacts.reduce((sum, a) => sum + a.bytes.byteLength, 0)
    expect(after).toBeLessThan(before / 3)
    expect(compressed.value.manifest.shards.every(s =>
      s.compression === 'gzip' && s.uncompressedBytes! > s.bytes && s.key.endsWith('.json.gz'),
    )).toBe(true)
    expect(legacy.value.manifest.shards.every(s => s.compression === undefined)).toBe(true)
    console.log('D4_GZIP_FIXTURE='+JSON.stringify({
      entryCount: next.items.length, shardCount: compressed.value.shardArtifacts.length,
      beforeBytes: before, gzipBytes: after,
      ratio: Number((before / after).toFixed(2)), published: false,
    }))
  })

  it('rejects malicious compressed payload even if the manifest size/digest are forged', async () => {
    const compressed = await checkpoint(true)
    const descriptor = compressed.value.manifest.shards[0]!
    const changed = await compressDbLessD4Shard('x'.repeat(100_000))
    descriptor.bytes = changed.byteLength
    descriptor.artifactSha256 = await sha256Hex(changed)
    descriptor.uncompressedBytes = 100
    compressed.artifacts.set(descriptor.key, changed)
    const unsafe = new DbLessCurrentOverlayReader({
      manifest: compressed.value.manifest,
      readArtifact: async key => compressed.artifacts.get(key) ?? null,
    })
    await expect(unsafe.readAll()).rejects.toThrow(/decompressed shard exceeds/)
  })

  it('rejects corrupted compressed bytes before decompression', async () => {
    const compressed = await checkpoint(true)
    const descriptor = compressed.value.manifest.shards[0]!
    const data = new Uint8Array(compressed.artifacts.get(descriptor.key)!)
    data[data.length - 1] ^= 0x01
    compressed.artifacts.set(descriptor.key, data)
    const unsafe = new DbLessCurrentOverlayReader({
      manifest: compressed.value.manifest,
      readArtifact: async key => compressed.artifacts.get(key) ?? null,
    })
    await expect(unsafe.readAll()).rejects.toThrow(/SHA-256 mismatch/)
  })

  it('rejects invalid gzip pointer metadata before reading a shard', async () => {
    const compressed = await checkpoint(true)
    const descriptor = compressed.value.manifest.shards[0]!
    delete descriptor.uncompressedBytes
    expect(() => new DbLessCurrentOverlayReader({
      manifest: compressed.value.manifest,
      readArtifact: async () => null,
    })).toThrow(/uncompressedBytes/)
  })

  it('makes corrupt gzip fail closed independently of remote metadata', async () => {
    await expect(decompressDbLessD4Shard(utf8('invalid'), 128)).rejects.toThrow()
    await expect(decompressDbLessD4Shard(new Uint8Array([1, 2]), 2_000_001))
      .rejects.toThrow(/byte guard/)
  })
})
