import { describe, expect, it } from 'vitest'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'
import { planDbLessStableD4Shards } from './current-overlay-stable-shard-plan'
import { decompressDbLessD4Shard } from './current-overlay-compressed-shard'
import { sha256Hex } from '../current-state/canonical-json'

const HASH = 'A'.repeat(64)
function entries(): DbLessCurrentOverlayEntryV1[] {
  return Array.from({ length: 512 }, (_, i) => {
    const objectId = `V-${String(i).padStart(5, '0')}`
    return {
      canonicalKey: `projection:vault:${objectId}`,
      objectType: 'vault' as const,
      objectId,
      sourceLedgerIndex: 101,
      sourceLedgerHash: HASH,
      sourceTransactionHash: HASH,
      relationshipIds: [],
      isTombstone: i % 13 === 0,
      value: i % 13 === 0 ? null : { kind: 'vault', owner: 'alice', id: objectId },
    }
  })
}

const base = { epochId: 'epoch-1', baseIdentity: 'base-1', bucketCount: 8 }

describe('isolated reusable D4 gzip content plan', () => {
  it('reuses byte-identical buckets across ledger changes and publishes only changed bucket', async () => {
    const before = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-100', entries: entries(),
    })
    const unchanged = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-101', entries: [...entries()].reverse(),
      previous: before,
    })
    expect(unchanged.newShardCount).toBe(0)
    expect(unchanged.reusedShardCount).toBe(8)
    expect(unchanged.uploadBytes).toBe(0)
    expect(unchanged.shards).toEqual(before.shards)
    expect(unchanged.retainedReleaseTags).toEqual(['d5-spike-100'])

    const updated = entries()
    updated[2] = { ...updated[2]!, sourceLedgerIndex: 102, value: { kind: 'vault', owner: 'bob' } }
    const next = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-102', entries: updated, previous: before,
    })
    expect(next.reusedShardCount).toBe(7)
    expect(next.newShardCount).toBe(1)
    expect(next.uploadBytes).toBeLessThan(before.totalReferencedBytes / 2)
    expect(next.retainedReleaseTags).toEqual(['d5-spike-100', 'd5-spike-102'])
    expect(next.shards.filter(s => s.releaseTag === 'd5-spike-102')).toHaveLength(1)
    for (const artifact of next.uploadArtifacts) {
      expect(await sha256Hex(artifact.bytes)).toBe(artifact.sha256)
      const decoded = JSON.parse(await decompressDbLessD4Shard(artifact.bytes, 2_000_000)) as {
        records: DbLessCurrentOverlayEntryV1[]
        throughLedgerIndex?: number
      }
      expect(decoded.throughLedgerIndex).toBeUndefined()
      expect(decoded.records.some(e => e.objectId === updated[2]!.objectId)).toBe(true)
    }
    console.log('D5_STABLE_D4_SHARD_PLAN='+JSON.stringify({
      beforeShards: before.shards.length,
      unchangedReuse: unchanged.reusedShardCount,
      changedShards: next.newShardCount,
      reusedShards: next.reusedShardCount,
      totalReferencedBytes: next.totalReferencedBytes,
      incrementalUploadBytes: next.uploadBytes,
      published: false,
    }))
  })

  it('rejects cross-epoch/base reuse, unsafe release identities and conflicting keys', async () => {
    const before = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-100', entries: entries(),
    })
    await expect(planDbLessStableD4Shards({
      ...base, baseIdentity: 'different-base', targetReleaseTag: 'd5-spike-102',
      entries: entries(), previous: before,
    })).rejects.toThrow(/prior checkpoint context differs/)
    await expect(planDbLessStableD4Shards({
      ...base, targetReleaseTag: '../unsafe', entries: entries(),
    })).rejects.toThrow(/Release tag is unsafe/)
    const duplicate = entries()
    duplicate.push(duplicate[0]!)
    await expect(planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-101', entries: duplicate,
    })).rejects.toThrow(/duplicate canonical key/)
  })

  it('does not reuse a purported prior bucket with altered SHA metadata', async () => {
    const before = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-100', entries: entries(),
    })
    const tampered = {
      ...before,
      shards: before.shards.map((s, i) => i === 0 ? { ...s, sha256: 'f'.repeat(64) } : s),
    }
    const next = await planDbLessStableD4Shards({
      ...base, targetReleaseTag: 'd5-spike-101', entries: entries(), previous: tampered,
    })
    expect(next.newShardCount).toBe(1)
    expect(next.reusedShardCount).toBe(7)
  })
})
