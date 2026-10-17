import { describe, expect, it } from 'vitest'
import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'
import { prepareDbLessStableD4CheckpointV3 } from './current-overlay-stable-checkpoint-v3'
import { verifyDbLessStableD4PublicationPreflightV3 } from './current-overlay-stable-publication-preflight-v3'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'

const H='A'.repeat(64)
const N='B'.repeat(64)
function records():DbLessCurrentOverlayEntryV1[] {
  return Array.from({length:64},(_,i)=>{
    const id=`VAULT-${i}`
    return {
      canonicalKey:`projection:vault:${id}`,objectType:'vault',objectId:id,
      sourceLedgerIndex:100,sourceLedgerHash:H,sourceTransactionHash:H,
      relationshipIds:[],isTombstone:i%12===0,
      value:i%12===0?null:{id,assets:'100'},
    }
  })
}
async function fixture() {
  const first=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch',baseIdentity:'base',bucketCount:8,
    throughLedgerIndex:100,throughLedgerHash:H,entries:records(),
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100']}),
  })
  const updated=records()
  updated[1]={...updated[1]!,sourceLedgerIndex:101,sourceLedgerHash:N,value:{assets:'200'}}
  const second=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch',baseIdentity:'base',bucketCount:8,
    throughLedgerIndex:101,throughLedgerHash:N,entries:updated,previous:first.manifest,
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100','g101']}),
  })
  const existing=new Map(first.uploadArtifacts.map(a=>[a.key,a.bytes] as const))
  const readExisting=async(tag:string,key:string)=>
    tag==='d5-stable-d4-v3-100'?existing.get(key)??null:null
  return {first,second,readExisting,existing}
}
describe('D5 exact v3 pre-publication immutable graph proof (read-only)',()=>{
  it('verifies new and old Release bytes before allowing hypothetical control-channel update',async()=>{
    const f=await fixture()
    const passed=await verifyDbLessStableD4PublicationPreflightV3({
      manifest:f.second.manifest,manifestArtifact:f.second.manifestArtifact,
      stagedReleaseTag:'d5-stable-d4-v3-101',uploadArtifacts:f.second.uploadArtifacts,
      readExisting:f.readExisting,expectedD3ThroughLedgerIndex:101,
      expectedD3ThroughLedgerHash:N,
      expectedStateSha256:f.second.manifest.stateSha256,
    })
    expect(passed.passed).toBe(true)
    expect(passed.publicationMutation).toBe(false)
    expect(passed.referencedShards).toBe(8)
    expect(passed.newAssets).toBe(1)
    expect(passed.oldAssets).toBe(7)
    expect(passed.retainedReleaseTags).toEqual(['d5-stable-d4-v3-100','d5-stable-d4-v3-101'])
  })
  it('halts if an old immutable Release disappears or its bytes change',async()=>{
    const f=await fixture()
    const opts={
      manifest:f.second.manifest,manifestArtifact:f.second.manifestArtifact,
      stagedReleaseTag:'d5-stable-d4-v3-101',uploadArtifacts:f.second.uploadArtifacts,
      expectedD3ThroughLedgerIndex:101,expectedD3ThroughLedgerHash:N,
      expectedStateSha256:f.second.manifest.stateSha256,
    }
    await expect(verifyDbLessStableD4PublicationPreflightV3({
      ...opts,readExisting:async()=>null,
    })).rejects.toThrow(/missing or tampered/)
    const ref=f.second.manifest.shards.find(s=>s.releaseTag.endsWith('100'))!
    const original=f.existing.get(ref.key)!
    const tampered=new Uint8Array(original)
    tampered[tampered.length-1]^=1
    f.existing.set(ref.key,tampered)
    await expect(verifyDbLessStableD4PublicationPreflightV3({
      ...opts,readExisting:f.readExisting,
    })).rejects.toThrow(/missing or tampered/)
  })
  it('halts if source ledger/digest or byte ceiling is inconsistent',async()=>{
    const f=await fixture()
    const base={
      manifest:f.second.manifest,manifestArtifact:f.second.manifestArtifact,
      stagedReleaseTag:'d5-stable-d4-v3-101',uploadArtifacts:f.second.uploadArtifacts,
      readExisting:f.readExisting,expectedD3ThroughLedgerIndex:101,
      expectedD3ThroughLedgerHash:N,expectedStateSha256:f.second.manifest.stateSha256,
    }
    await expect(verifyDbLessStableD4PublicationPreflightV3({
      ...base,expectedStateSha256:'f'.repeat(64),
    })).rejects.toThrow(/source ledger\/state identity mismatch/)
    await expect(verifyDbLessStableD4PublicationPreflightV3({
      ...base,maxTotalCompressedBytes:1,
    })).rejects.toThrow(/total byte budget/)
    await expect(verifyDbLessStableD4PublicationPreflightV3({
      ...base,uploadArtifacts:[],
    })).rejects.toThrow(/staged assets/)
  })
})
