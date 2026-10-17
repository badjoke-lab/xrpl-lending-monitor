import { describe, expect, it, vi } from 'vitest'
import { buildDbLessCurrentOverlayGenerationProvenance } from './current-overlay-provenance'
import {
  prepareDbLessStableD4CheckpointV3,
} from './current-overlay-stable-checkpoint-v3'
import { openPublicDbLessStableD4CheckpointV3 } from './current-overlay-stable-github-public-v3'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const HASH = 'A'.repeat(64)
const NEXT = 'B'.repeat(64)
const entries = (): DbLessCurrentOverlayEntryV1[] => Array.from({ length: 64 }, (_, i) => {
  const id = `V-${i}`
  return {
    canonicalKey: `projection:vault:${id}`,objectType:'vault',objectId:id,
    sourceLedgerIndex:100,sourceLedgerHash:HASH,sourceTransactionHash:HASH,
    relationshipIds:[],isTombstone:i%7===0,
    value:i%7===0?null:{id,asset:'XRP'},
  }
})
function response(bytes: Uint8Array, url: string): Response {
  const payload=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer
  const result=new Response(payload, {headers:{'content-length':String(bytes.byteLength)}})
  Object.defineProperty(result,'url',{value:url})
  return result
}
async function setup() {
  const initial=entries()
  const prior=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch1',baseIdentity:'base1',throughLedgerIndex:100,throughLedgerHash:HASH,
    bucketCount:8,entries:initial,
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100']}),
  })
  const updated=entries()
  const current=updated[1]!
  updated[1]={...current,sourceLedgerIndex:101,sourceLedgerHash:NEXT,value:{id:current.objectId,asset:'MPT'}}
  const next=await prepareDbLessStableD4CheckpointV3({
    epochId:'epoch1',baseIdentity:'base1',throughLedgerIndex:101,throughLedgerHash:NEXT,
    bucketCount:8,entries:updated,previous:prior.manifest,
    generationProvenance:await buildDbLessCurrentOverlayGenerationProvenance({generationIds:['g100','g101']}),
  })
  const urls=new Map<string,Uint8Array>()
  for(const [tag,build] of [['d5-stable-d4-v3-100',prior],['d5-stable-d4-v3-101',next]] as const) {
    for(const artifact of build.uploadArtifacts) {
      urls.set(`https://github.com/${REPO}/releases/download/${tag}/${artifact.key}`,artifact.bytes)
    }
  }
  const manifestUrl=`https://github.com/${REPO}/releases/download/d5-stable-d4-v3-101/${next.manifestArtifact.key}`
  urls.set(manifestUrl,next.manifestArtifact.bytes)
  const calls:string[]=[]
  const fetcher=vi.fn(async (input: RequestInfo | URL) => {
    const url=String(input)
    calls.push(url)
    const data=urls.get(url)
    return data
      ? response(data,'https://release-assets.githubusercontent.com/verified-byte-stream')
      : response(new TextEncoder().encode('Not Found'),'https://release-assets.githubusercontent.com/missing')
  }) as unknown as typeof fetch
  return { prior,next,updated,urls,calls,fetcher,manifestUrl }
}

describe('D5 explicit read-only public GitHub v3 checkpoint adapter', () => {
  it('fetches a pinned manifest then at most one source Release bucket for exact Vault', async () => {
    const f=await setup()
    const opened=await openPublicDbLessStableD4CheckpointV3({
      repository:REPO,checkpointReleaseTag:'d5-stable-d4-v3-101',
      throughLedgerIndex:101,manifestSha256:f.next.manifestArtifact.sha256,fetcher:f.fetcher,
    })
    expect(f.calls).toEqual([f.manifestUrl])
    const found=await opened.get('vault','V-1')
    expect(found.item).toEqual(f.updated[1])
    expect(found.shardReads).toBe(1)
    expect(f.calls).toHaveLength(2)
    const tombstone=await opened.get('vault','V-0')
    expect(tombstone.item?.isTombstone).toBe(true)
    expect(tombstone.shardReads).toBe(1)
  })

  it('rejects tampered Release bytes, wrong trusted checkpoint SHA and untrusted response origin', async () => {
    const f=await setup()
    await expect(openPublicDbLessStableD4CheckpointV3({
      repository:REPO,checkpointReleaseTag:'d5-stable-d4-v3-101',
      throughLedgerIndex:101,manifestSha256:'e'.repeat(64),fetcher:f.fetcher,
    })).rejects.toThrow(/manifest SHA/)
    const opened=await openPublicDbLessStableD4CheckpointV3({
      repository:REPO,checkpointReleaseTag:'d5-stable-d4-v3-101',
      throughLedgerIndex:101,manifestSha256:f.next.manifestArtifact.sha256,fetcher:f.fetcher,
    })
    for(const [key,data] of f.urls) {
      if (!key.includes('/current-overlay-stable-v1-')) continue
      const bad=new Uint8Array(data)
      bad[bad.length-1]^=1
      f.urls.set(key,bad)
    }
    await expect(opened.get('vault','V-1')).rejects.toThrow(/missing or tampered/)
    const evil=vi.fn(async () => response(f.next.manifestArtifact.bytes,'https://evil.example/bad')) as unknown as typeof fetch
    await expect(openPublicDbLessStableD4CheckpointV3({
      repository:REPO,checkpointReleaseTag:'d5-stable-d4-v3-101',
      throughLedgerIndex:101,manifestSha256:f.next.manifestArtifact.sha256,fetcher:evil,
    })).rejects.toThrow(/origin/)
    await expect(openPublicDbLessStableD4CheckpointV3({
      repository:REPO,checkpointReleaseTag:'../bad',
      throughLedgerIndex:101,manifestSha256:f.next.manifestArtifact.sha256,fetcher:f.fetcher,
    })).rejects.toThrow(/allowlisted/)
  })
})
