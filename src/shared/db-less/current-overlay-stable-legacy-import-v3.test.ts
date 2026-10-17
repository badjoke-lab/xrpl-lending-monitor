import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type {
  DbLessCurrentOverlayCheckpointManifestV2,
  DbLessCurrentOverlayEntryV1,
} from './current-overlay-checkpoint'
import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'
import { compareDbLessCurrentProjectionCanonicalKeys } from './current-projection-identity'
import { prepareDbLessStableD4FromVerifiedV2 } from './current-overlay-stable-legacy-import-v3'

const H = 'A'.repeat(64)
const entries = (): DbLessCurrentOverlayEntryV1[] =>
  Array.from({length:64},(_,n)=>{
    const id = `VAULT-${n}`
    return {
      canonicalKey: `projection:vault:${id}`,
      objectType: 'vault', objectId: id, sourceLedgerIndex: 99,
      sourceLedgerHash: H, sourceTransactionHash: H,
      relationshipIds: [], isTombstone: n%8===0,
      value: n%8===0 ? null : { liquidity: String(n), id },
    }
  })
async function fixture() {
  const items=entries()
  const shardBuckets=new Map<number,number>()
  for (const e of items) {
    const hash=await sha256Hex(utf8(e.canonicalKey))
    const bucket=Number.parseInt(hash.slice(0,8),16)%8
    shardBuckets.set(bucket,(shardBuckets.get(bucket)??0)+1)
  }
  const shards=await Promise.all([...shardBuckets].sort((a,b)=>a[0]-b[0]).map(async ([bucket, records])=>({
    bucket, records, bytes: 1500,
    key: `current-overlay-v1-100-bucket-${String(bucket).padStart(4,'0')}.json`,
    artifactSha256: await sha256Hex(`SOURCE-${bucket}`),
  })))
  const manifest: DbLessCurrentOverlayCheckpointManifestV2 = {
    schemaVersion: 2, network: 'devnet',
    epochId: 'epoch-v2', baseIdentity: 'base-v2',
    throughLedgerIndex: 100, throughLedgerHash: H,
    generationCount: 1, bucketCount: 8,
    entryCount: items.length, tombstoneCount: items.filter(x=>x.isTombstone).length,
    shards,
    sourceGenerationProvenance:
      await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['live-gen-100']}),
  }
  const ordered=[...items].sort((a,b)=>compareDbLessCurrentProjectionCanonicalKeys(a.canonicalKey,b.canonicalKey))
  const sourceSha=await sha256Hex(`${canonicalJson(ordered)}\n`)
  return {items,manifest,sourceSha}
}
describe('D5 v2 fully verified state to v3 stable immutable gzip import',()=>{
  it('keeps the exact D4 v2 state SHA, 64 records, tombstones and provenance',async()=>{
    const a=await fixture()
    const result=await prepareDbLessStableD4FromVerifiedV2({
      manifest:a.manifest,entries:a.items,expectedStateSha256:a.sourceSha,
    })
    expect(result.exactStateMatch).toBe(true)
    expect(result.readbackStateSha256).toBe(a.sourceSha)
    expect(result.candidate.manifest.stateSha256).toBe(a.sourceSha)
    expect(result.candidate.manifest.entryCount).toBe(64)
    expect(result.candidate.manifest.tombstoneCount).toBe(8)
    expect(result.candidate.manifest.generationProvenance).toEqual(a.manifest.sourceGenerationProvenance)
    expect(result.candidate.uploadArtifacts.length).toBe(8)
    expect(result.candidate.retainedReleaseTags).toEqual(['d5-stable-d4-v3-100'])
    console.log('D5_V2_TO_V3_EXACT_IMPORT='+JSON.stringify({
      entryCount:64,tombstones:8,sourceStateSha256:a.sourceSha,
      gzipBytes:result.candidate.uploadArtifacts.reduce((sum,x)=>sum+x.bytes.length,0),
      uploadMutations:0,
    }))
  })
  it('rejects a correct-looking but state-modified source and a false v2 entry count',async()=>{
    const a=await fixture()
    const changed=a.items.map((x,i)=>i===1?{...x,value:{liquidity:'FORGED'}}:x)
    await expect(prepareDbLessStableD4FromVerifiedV2({
      manifest:a.manifest,entries:changed,expectedStateSha256:a.sourceSha,
    })).rejects.toThrow(/source state SHA mismatch/)
    await expect(prepareDbLessStableD4FromVerifiedV2({
      manifest:{...a.manifest,shards:[]},
      entries:a.items,expectedStateSha256:a.sourceSha,
    })).rejects.toThrow(/referenced shard record count mismatch/)
    await expect(prepareDbLessStableD4FromVerifiedV2({
      manifest:{...a.manifest,entryCount:63},
      entries:a.items,expectedStateSha256:a.sourceSha,
    })).rejects.toThrow(/manifest\/entry identity mismatch/)
  })
})
