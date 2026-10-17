import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import { planDbLessStableD4RetentionV3 } from './current-overlay-stable-retention-v3'
import type { DbLessStableD4CheckpointV3 } from './current-overlay-stable-checkpoint-v3'

const H = 'A'.repeat(64)
const release = (n: number) => ({ id: n, tagName: `d5-stable-d4-v3-${n}`, draft: false, prerelease: true })
async function manifest(n: number, refs: number[]) {
  const data: DbLessStableD4CheckpointV3 = {
    schemaVersion: 3, network: 'devnet',
    epochId:'epoch1', baseIdentity:'base1',
    throughLedgerIndex:n, throughLedgerHash:H,
    generationProvenance: {
      scheme: 'rolling-sha256-v1', generationCount: n,
      firstGenerationId:'g1',lastGenerationId:`g${n}`,digestSha256:'b'.repeat(64),
    },
    bucketCount:8,
    entryCount:refs.length,
    tombstoneCount:0,
    stateSha256:'c'.repeat(64),
    shards:refs.map((origin,i)=>({
      bucket:i, releaseTag:`d5-stable-d4-v3-${origin}`,
      key:`current-overlay-stable-v1-b${String(i).padStart(4,'0')}-${'d'.repeat(64)}.json.gz`,
      sha256:'d'.repeat(64),bytes:100,uncompressedBytes:1000,records:1,
    })),
  }
  const bytes=utf8(`${canonicalJson(data)}\n`)
  return { releaseTag:`d5-stable-d4-v3-${n}`, bytes, sha256:await sha256Hex(bytes) }
}

describe('v3 safe retained-Release references (no mutation)', () => {
  it('pins an old Release referenced by the active head despite falling outside last two checkpoints', async () => {
    const releases=[100,101,102,103,104].map(release)
    const inputs=[await manifest(103,[100,103]),await manifest(104,[100,104])]
    const plan=await planDbLessStableD4RetentionV3({
      releases,activeReleaseTag:'d5-stable-d4-v3-104',manifestInputs:inputs,keepCount:2,
    })
    expect(plan.keepReleaseTags).toEqual(['d5-stable-d4-v3-104','d5-stable-d4-v3-103'])
    expect(plan.pinnedShardReleaseTags).toEqual([
      'd5-stable-d4-v3-100','d5-stable-d4-v3-103','d5-stable-d4-v3-104',
    ])
    expect(plan.deleteCandidateTags).toEqual(['d5-stable-d4-v3-102','d5-stable-d4-v3-101'])
    expect(plan.protectedReleaseTags).toContain('d5-stable-d4-v3-100')
  })

  it('refuses missing verified manifest, changed SHA and missing referenced release', async () => {
    const releases=[100,101,102,103,104].map(release)
    const m103=await manifest(103,[100,103])
    const m104=await manifest(104,[100,104])
    const base={
      releases,activeReleaseTag:'d5-stable-d4-v3-104',
      manifestInputs:[m103,m104],keepCount:2,
    }
    await expect(planDbLessStableD4RetentionV3({...base,manifestInputs:[m104]}))
      .rejects.toThrow(/missing verified kept checkpoint/)
    await expect(planDbLessStableD4RetentionV3({...base,manifestInputs:[m103,{...m104,sha256:'e'.repeat(64)}]}))
      .rejects.toThrow(/manifest SHA/)
    await expect(planDbLessStableD4RetentionV3({...base,releases:releases.filter(r=>r.id!==100)}))
      .rejects.toThrow(/referenced Release is missing/)
  })

  it('refuses a newly published unactivated checkpoint, duplicate IDs and draft active release', async () => {
    const releases=[100,101,102,103,104].map(release)
    const inputs=[await manifest(103,[103]),await manifest(104,[104])]
    const base={
      releases,activeReleaseTag:'d5-stable-d4-v3-104',
      manifestInputs:inputs,keepCount:2,
    }
    await expect(planDbLessStableD4RetentionV3({...base,releases:[...releases,release(105)]}))
      .rejects.toThrow(/unactivated newer/)
    await expect(planDbLessStableD4RetentionV3({...base,releases:[...releases,{...release(98),id:100}]}))
      .rejects.toThrow(/metadata is invalid/)
    await expect(planDbLessStableD4RetentionV3({...base,releases:releases.map(r=>r.id===104?{...r,draft:true}:r)}))
      .rejects.toThrow(/active Release is not published/)
  })
})
