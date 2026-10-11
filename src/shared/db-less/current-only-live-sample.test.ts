import { describe, expect, it } from 'vitest'
import { sha256Hex } from '../current-state/canonical-json'
import { decodeAndVerifyNormalizedPayloadChunk } from '../portable-collector-payload'
import type { DbLessLiveDeltaArtifactSet } from './live-delta'
import { assertDbLessLiveDeltaManifest, type DbLessArtifact, type DbLessLiveDeltaManifestV1 } from './live-delta'
import { buildDbLessCurrentOnlyArtifactV1 } from './current-only-artifact'

const REPOSITORY = 'badjoke-lab/xrpl-lending-monitor'
const MAX_SAMPLE_ASSETS = 50
const MAX_SOURCE_BYTES = 12_000_000

async function getBounded(url: string, byteBudget: number): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' })
  if (!response.ok) throw new Error(`Current-only live sample returned HTTP ${response.status}`)
  const length = response.headers.get('content-length')
  if (length && Number(length) > byteBudget) throw new Error('Live sample exceeded byte budget')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > byteBudget) throw new Error('Live sample exceeded byte budget')
  return bytes
}

describe('isolated real D3 Current-only sample (read-only)', () => {
  const probe = process.env.RUN_D5_REAL_CURRENT_SAMPLE === 'true' ? it : it.skip

  probe('reconstructs an immutable generation and measures an exact Current-only artifact', async () => {
    const api = `https://api.github.com/repos/${REPOSITORY}/releases/tags/db-less-live-channel-candidate-v1`
    const release = JSON.parse(new TextDecoder().decode(await getBounded(api, 1_000_000))) as { body: string }
    const channel = JSON.parse(release.body) as {
      currentProjectionTail: {
        generations: Array<{
          generationId: string
          manifestKey: string
          manifestSha256: string
          currentProjectionMutations: number
          location: { provider: string; repository: string; releaseTag: string }
        }>
      }
    }
    const candidate = channel.currentProjectionTail.generations
      .filter(g => g.currentProjectionMutations > 0 && g.location.provider === 'github-release'
        && g.location.repository === REPOSITORY)
      .sort((a, b) => b.currentProjectionMutations - a.currentProjectionMutations)[0]
    if (!candidate) throw Error('No real Current mutation generation to sample')
    const assetUrl = (key: string) =>
      `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(candidate.location.releaseTag)}/${encodeURIComponent(key)}`
    const manifestBytes = await getBounded(assetUrl(candidate.manifestKey), 1_000_000)
    expect(await sha256Hex(manifestBytes)).toBe(candidate.manifestSha256)
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as DbLessLiveDeltaManifestV1
    assertDbLessLiveDeltaManifest(manifest)
    expect(manifest.generationId).toBe(candidate.generationId)
    expect(manifest.semanticCounts.currentProjectionMutations).toBe(candidate.currentProjectionMutations)
    expect(manifest.chunks.length).toBeLessThanOrEqual(MAX_SAMPLE_ASSETS)

    let aggregateSourceBytes = manifestBytes.byteLength
    const sourceChunks = []
    const chunkArtifacts: DbLessArtifact[] = []
    for(const desc of manifest.chunks) {
      const bytes = await getBounded(assetUrl(desc.key), MAX_SOURCE_BYTES - aggregateSourceBytes)
      expect(bytes.byteLength).toBe(desc.bytes)
      expect(await sha256Hex(bytes)).toBe(desc.artifactSha256)
      const chunk = await decodeAndVerifyNormalizedPayloadChunk(bytes, manifest.payloadDigest)
      aggregateSourceBytes += bytes.byteLength
      sourceChunks.push({chunk,encoded:bytes,encodedJson:new TextDecoder().decode(bytes)})
      chunkArtifacts.push({
        key:desc.key, bytes, sha256:desc.artifactSha256, mediaType:'application/json', immutable:true,
      })
    }
    const delta = {
      manifest,
      manifestArtifact: {
        key:candidate.manifestKey,bytes:manifestBytes,sha256:candidate.manifestSha256,
        mediaType:'application/json',immutable:true,
      },
      chunkArtifacts,
      normalized:{chunks:sourceChunks},
    } as DbLessLiveDeltaArtifactSet

    const built=await buildDbLessCurrentOnlyArtifactV1(delta)
    expect(built.manifest.records.length).toBe(candidate.currentProjectionMutations)
    expect(built.artifact.bytes.byteLength).toBeLessThan(2_000_001)
    console.log('D5_REAL_CURRENT_ONLY_SAMPLE='+JSON.stringify({
      generationId:candidate.generationId,
      ledgerStart:manifest.startLedgerIndex,
      ledgerEnd:manifest.endLedgerIndex,
      sourceChunks:manifest.chunks.length,
      sourceAssetRequests:manifest.chunks.length+1,
      sourceBytes:aggregateSourceBytes,
      mutationCount:candidate.currentProjectionMutations,
      newAssetRequests:1,
      newAssetBytes:built.artifact.bytes.byteLength,
      savingsFactor:Math.round(aggregateSourceBytes/built.artifact.bytes.byteLength*100)/100,
      newAssetSha256:built.artifact.sha256,
      publicationMutation:false,
    }))
  }, 120_000)
})
