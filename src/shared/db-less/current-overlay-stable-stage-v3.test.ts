import { describe, expect, it, vi } from 'vitest'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'
import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'
import { prepareDbLessStableD4CheckpointV3 } from './current-overlay-stable-checkpoint-v3'
import { stageDbLessStableD4CandidateV3 } from './current-overlay-stable-stage-v3'
import type { DbLessArtifact } from './live-delta'

const H='A'.repeat(64)
const J='B'.repeat(64)
const entries = (): DbLessCurrentOverlayEntryV1[] =>
  Array.from({ length: 64 },(_,i)=>{
    const id=`V-${i}`
    return {
      canonicalKey:`projection:vault:${id}`,objectType:'vault',objectId:id,
      sourceLedgerIndex:100,sourceLedgerHash:H,sourceTransactionHash:H,
      relationshipIds:[],isTombstone:i%7===0,
      value:i%7===0?null:{liquidity:String(i)},
    }
  })
async function fixture(){
  const prior=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch',baseIdentity:'base',bucketCount:8,throughLedgerIndex:100,
    throughLedgerHash:H,entries:entries(),
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100']}),
  })
  const updated=entries()
  updated[1]={...updated[1]!,sourceLedgerIndex:101,sourceLedgerHash:J,value:{liquidity:'UPDATED'}}
  const next=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch',baseIdentity:'base',bucketCount:8,throughLedgerIndex:101,
    throughLedgerHash:J,entries:updated,previous:prior.manifest,
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100','g101']}),
  })
  const bytes=new Map<string,Uint8Array>()
  const readArtifact=async(tag:string,key:string)=>bytes.get(`${tag}/${key}`)??null
  const writeImmutable=vi.fn(async(tag:string,a:DbLessArtifact)=>{
    const key=`${tag}/${a.key}`
    if(bytes.has(key))throw Error('overwrite denied')
    bytes.set(key,a.bytes)
  })
  const opts=(build:typeof prior)=>({
    manifest:build.manifest,manifestArtifact:build.manifestArtifact,
    stagedReleaseTag:`d5-stable-d4-v3-${build.manifest.throughLedgerIndex}`,
    uploadArtifacts:build.uploadArtifacts,
    readArtifact,writeImmutable,
    expectedD3ThroughLedgerIndex:build.manifest.throughLedgerIndex,
    expectedD3ThroughLedgerHash:build.manifest.throughLedgerHash,
    expectedStateSha256:build.manifest.stateSha256,
  })
  return {prior,next,bytes,readArtifact,writeImmutable,opts}
}

describe('D5 v3 immutable candidate staged upload with no channel API',()=>{
  it('stages first snapshot and one changed bucket, verifies old references and is retry-idempotent',async()=>{
    const x=await fixture()
    const first=await stageDbLessStableD4CandidateV3(x.opts(x.prior))
    expect(first.writtenShardAssets).toBe(8)
    expect(first.manifestUploaded).toBe(true)
    expect(first.channelActivationPerformed).toBe(false)
    const next=await stageDbLessStableD4CandidateV3(x.opts(x.next))
    expect(next.writtenShardAssets).toBe(1)
    expect(next.verifiedOldReleaseAssets).toBe(7)
    expect(next.manifestUploaded).toBe(true)
    expect(next.stateSha256).toBe(x.next.manifest.stateSha256)
    const before=x.writeImmutable.mock.calls.length
    const replay=await stageDbLessStableD4CandidateV3(x.opts(x.next))
    expect(replay.writtenShardAssets).toBe(0)
    expect(replay.preexistingVerifiedShardAssets).toBe(1)
    expect(replay.manifestUploaded).toBe(false)
    expect(x.writeImmutable.mock.calls.length).toBe(before)
  })

  it('refuses staging any successor asset when an old referenced shard is absent or corrupt',async()=>{
    const x=await fixture()
    await stageDbLessStableD4CandidateV3(x.opts(x.prior))
    const existing=x.next.manifest.shards.find(s=>s.releaseTag==='d5-stable-d4-v3-100')!
    x.bytes.delete(`${existing.releaseTag}/${existing.key}`)
    const previousWrites=x.writeImmutable.mock.calls.length
    await expect(stageDbLessStableD4CandidateV3(x.opts(x.next)))
      .rejects.toThrow(/missing or tampered/)
    expect(x.writeImmutable.mock.calls.length).toBe(previousWrites)
  })

  it('refuses a corrupt post-write candidate, leaving the manifest unpublished',async()=>{
    const x=await fixture()
    const wrongWrite=vi.fn(async(tag:string,a:DbLessArtifact)=>{
      const altered=new Uint8Array(a.bytes)
      altered[altered.length-1]^=1
      x.bytes.set(`${tag}/${a.key}`,altered)
    })
    await expect(stageDbLessStableD4CandidateV3({
      ...x.opts(x.prior),writeImmutable:wrongWrite,
    })).rejects.toThrow(/mismatched bytes/)
    expect(x.bytes.has(`d5-stable-d4-v3-100/${x.prior.manifestArtifact.key}`)).toBe(false)
  })
})
