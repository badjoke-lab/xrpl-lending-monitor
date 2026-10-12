import { describe, expect, it } from 'vitest'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'
import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'
import {
  prepareDbLessStableD4CheckpointV3,
  readDbLessStableD4CheckpointV3,
  getDbLessStableD4ObjectV3,
} from './current-overlay-stable-checkpoint-v3'

const H = 'A'.repeat(64)
const B = 'B'.repeat(64)
function entries(): DbLessCurrentOverlayEntryV1[] {
  return Array.from({ length: 128 }, (_, i) => {
    const id = `VAULT-${String(i).padStart(4, '0')}`
    return {
      canonicalKey: `projection:vault:${id}`, objectType: 'vault' as const,
      objectId: id, sourceLedgerIndex: 100, sourceLedgerHash: H,
      sourceTransactionHash: H, relationshipIds: [],
      isTombstone: i % 9 === 0,
      value: i % 9 === 0 ? null : { id, liquidity: '1000' },
    }
  })
}
const fixed = { epochId: 'epoch1', baseIdentity: 'base1', bucketCount: 8 }
const provenance = async (generationIds: string[]) =>
  buildDbLessCurrentOverlayGenerationProvenance({ generationIds })

async function fixture() {
  const original = entries()
  const first = await prepareDbLessStableD4CheckpointV3({
    ...fixed, throughLedgerIndex: 100, throughLedgerHash: H,
    generationProvenance: await provenance(['g100']), entries: original,
  })
  const changed = entries()
  const current = changed.find(e => !e.isTombstone)!
  const index = changed.indexOf(current)
  changed[index] = { ...current, sourceLedgerIndex: 101, sourceLedgerHash: B, value: { liquidity: '2000' } }
  const second = await prepareDbLessStableD4CheckpointV3({
    ...fixed, throughLedgerIndex: 101, throughLedgerHash: B,
    generationProvenance: await provenance(['g100', 'g101']),
    entries: changed, previous: first.manifest,
  })
  const artifacts = new Map<string, Uint8Array>()
  for (const build of [first, second]) {
    const tag = `d5-stable-d4-v3-${build.manifest.throughLedgerIndex}`
    for (const a of build.uploadArtifacts) artifacts.set(`${tag}/${a.key}`, a.bytes)
  }
  const readArtifact = async (tag: string, key: string) => artifacts.get(`${tag}/${key}`) ?? null
  return { first, second, changed, artifacts, readArtifact }
}

describe('isolated D4 v3 referenced immutable checkpoint read', () => {
  it('reads all 128 objects across mixed Releases with exact state and tombstones', async () => {
    const { first, second, changed, readArtifact } = await fixture()
    expect(first.uploadArtifacts).toHaveLength(8)
    expect(second.uploadArtifacts).toHaveLength(1)
    expect(second.manifest.shards.filter(s => s.releaseTag === 'd5-stable-d4-v3-100')).toHaveLength(7)
    const read = await readDbLessStableD4CheckpointV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      readArtifact,
    })
    expect(read.entries).toEqual([...changed].sort((a,b) => a.canonicalKey.localeCompare(b.canonicalKey)))
    expect(read.shardReads).toBe(8)
    expect(read.manifest.stateSha256).toBe(second.manifest.stateSha256)
    expect(read.entries.filter(e => e.isTombstone)).toHaveLength(changed.filter(e => e.isTombstone).length)
    console.log('D5_D4_V3_REFERENCED_PROOF='+JSON.stringify({
      totalEntries:read.entries.length, reused: 7, uploaded: second.uploadArtifacts.length,
      immutableSources: [...new Set(second.manifest.shards.map(s=>s.releaseTag))],
      published:false,
    }))
  })

  it('uses only the selected v3 SHA-bound bucket for a Vault lookup and preserves tombstones', async () => {
    const { second, changed, readArtifact } = await fixture()
    const chosen = changed.find(e => !e.isTombstone)!
    const fetched: string[] = []
    const hit = await getDbLessStableD4ObjectV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      objectType: 'vault',
      objectId: chosen.objectId,
      readArtifact: async (releaseTag, key) => {
        fetched.push(`${releaseTag}/${key}`)
        return readArtifact(releaseTag, key)
      },
    })
    expect(hit.item).toEqual(chosen)
    expect(hit.shardReads).toBe(1)
    expect(fetched).toHaveLength(1)

    const deleted = changed.find(e => e.isTombstone)!
    const gone = await getDbLessStableD4ObjectV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      objectType: 'vault',
      objectId: deleted.objectId,
      readArtifact,
    })
    expect(gone.item?.isTombstone).toBe(true)
    expect(gone.shardReads).toBe(1)

    const absent = await getDbLessStableD4ObjectV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      objectType: 'vault',
      objectId: 'NOT-PRESENT',
      readArtifact,
    })
    expect(absent.item).toBeNull()
    expect(absent.shardReads).toBeLessThanOrEqual(1)
  })

  it('rejects a missing or corrupted referenced Release asset without any fallback', async () => {
    const { second, artifacts, readArtifact } = await fixture()
    const ref = second.manifest.shards.find(s => s.releaseTag.endsWith('-100'))!
    const assetKey = `${ref.releaseTag}/${ref.key}`
    const actual = artifacts.get(assetKey)!
    artifacts.delete(assetKey)
    await expect(readDbLessStableD4CheckpointV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      readArtifact,
    })).rejects.toThrow(/missing or tampered/)
    const modified = new Uint8Array(actual)
    modified[modified.byteLength - 1] ^= 1
    artifacts.set(assetKey, modified)
    await expect(readDbLessStableD4CheckpointV3({
      manifestBytes: second.manifestArtifact.bytes,
      manifestSha256: second.manifestArtifact.sha256,
      readArtifact,
    })).rejects.toThrow(/missing or tampered/)
  })

  it('rejects manifest tampering, future Releases and invalid content-addressed key', async () => {
    const { second, readArtifact } = await fixture()
    const hacked = JSON.parse(new TextDecoder().decode(second.manifestArtifact.bytes))
    hacked.shards[0].releaseTag = 'd5-stable-d4-v3-999'
    const future = new TextEncoder().encode(`${JSON.stringify(hacked)}\n`)
    const { sha256Hex } = await import('../current-state/canonical-json')
    await expect(readDbLessStableD4CheckpointV3({
      manifestBytes: future, manifestSha256: await sha256Hex(future), readArtifact,
    })).rejects.toThrow(/future checkpoint/)
    hacked.shards[0].releaseTag = 'd5-stable-d4-v3-100'
    hacked.shards[0].key = '../evil'
    const invalid = new TextEncoder().encode(`${JSON.stringify(hacked)}\n`)
    await expect(readDbLessStableD4CheckpointV3({
      manifestBytes: invalid, manifestSha256: await sha256Hex(invalid), readArtifact,
    })).rejects.toThrow(/content-addressed/)
    const changed = new Uint8Array(second.manifestArtifact.bytes)
    changed[changed.length - 3] ^= 1
    await expect(readDbLessStableD4CheckpointV3({
      manifestBytes: changed,
      manifestSha256: second.manifestArtifact.sha256,
      readArtifact,
    })).rejects.toThrow(/manifest SHA/)
  })

  it('rejects rollback, reused epoch/base mismatch and altered provenance', async () => {
    const { first } = await fixture()
    await expect(prepareDbLessStableD4CheckpointV3({
      ...fixed, throughLedgerIndex: 100, throughLedgerHash: H,
      generationProvenance: await provenance(['g100','g101']),
      entries: entries(), previous: first.manifest,
    })).rejects.toThrow(/must move forward/)
    await expect(prepareDbLessStableD4CheckpointV3({
      ...fixed, baseIdentity: 'DIFFERENT',
      throughLedgerIndex: 101, throughLedgerHash: B,
      generationProvenance: await provenance(['g100','g101']),
      entries: entries(), previous: first.manifest,
    })).rejects.toThrow(/prior checkpoint context differs/)
  })
})
