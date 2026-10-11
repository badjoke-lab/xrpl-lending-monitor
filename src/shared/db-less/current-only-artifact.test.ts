import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import type { DbLessLiveDeltaArtifactSet } from './live-delta'
import {
  buildDbLessCurrentOnlyArtifactV1,
  decodeAndVerifyDbLessCurrentOnlyArtifactV1,
} from './current-only-artifact'

const HASH = 'A'.repeat(64)
const DIGEST = `sha256:${'b'.repeat(64)}`
const GEN = 'live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc'

const candidate = (
  id: string,
  semanticClass: NormalizedCandidateV1['semanticClass'] = 'current-projection',
  isTombstone = false,
): NormalizedCandidateV1 => ({
  semanticClass,
  canonicalKey: `vault:${id}`,
  sourceLedgerIndex: 102,
  sourceLedgerHash: HASH,
  sourceTransactionHash: 'C'.repeat(64),
  objectId: id,
  relationshipIds: [],
  isTombstone,
  value: isTombstone ? null : { kind: 'vault', id },
})

async function fixture(recordsByChunk: NormalizedCandidateV1[][]) {
  const chunks = []
  const descriptors = []
  for (const [i, records] of recordsByChunk.entries()) {
    const chunk = {
      schemaVersion: 1 as const,
      workId: 'work-1',
      chunkIndex: i,
      totalChunks: recordsByChunk.length,
      payloadDigest: DIGEST,
      records,
      chunkDigest: `sha256:${'c'.repeat(64)}`,
    }
    const encoded = utf8(`${canonicalJson(chunk)}\n`)
    chunks.push({ chunk, encoded, encodedJson: new TextDecoder().decode(encoded) })
    descriptors.push({
      chunkIndex: i,
      key: `${GEN}-chunk-${String(i).padStart(4, '0')}.json`,
      records: records.length,
      bytes: encoded.byteLength,
      artifactSha256: await sha256Hex(encoded),
      chunkDigest: chunk.chunkDigest,
    })
  }
  const manifest = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: 'epoch-1',
    baseIdentity: 'base-1',
    generationId: GEN,
    workId: 'work-1',
    sourceRevision: 'C'.repeat(40),
    generatedAt: '2026-10-11T00:00:00.000Z',
    previousLedgerIndex: 100,
    expectedParentHash: HASH,
    startLedgerIndex: 101,
    startLedgerHash: HASH,
    endLedgerIndex: 102,
    endLedgerHash: HASH,
    ledgerCount: 2,
    payloadDigest: DIGEST,
    semanticCounts: {
      validatedLedgers: 2,
      protocolEvents: recordsByChunk.flat().filter(r => r.semanticClass === 'protocol-event').length,
      objectChanges: 0,
      loanLifecycleEvents: 0,
      archivedObjects: 0,
      balanceHistory: 0,
      currentProjectionMutations: recordsByChunk.flat().filter(r => r.semanticClass === 'current-projection').length,
      totalRecords: recordsByChunk.flat().length,
    },
    chunks: descriptors,
  }
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  return {
    manifest,
    manifestArtifact: {
      key: `${GEN}-manifest.json`,
      bytes: manifestBytes,
      sha256: await sha256Hex(manifestBytes),
      mediaType: 'application/json',
      immutable: true,
    },
    chunkArtifacts: descriptors.map((d, i) => ({
      key: d.key,
      bytes: chunks[i]!.encoded,
      sha256: d.artifactSha256,
      mediaType: 'application/json',
      immutable: true,
    })),
    normalized: { chunks },
  } as DbLessLiveDeltaArtifactSet
}

describe('D5 Current-only D3 artifact prototype', () => {
  it('retains upserts and tombstones without fetching unrelated normalized records', async () => {
    const delta = await fixture([
      [candidate('unrelated', 'protocol-event'), candidate('V1')],
      [candidate('V2', 'current-projection', true)],
    ])
    const result = await buildDbLessCurrentOnlyArtifactV1(delta)
    expect(result.manifest.records.map(r => r.objectId)).toEqual(['V1', 'V2'])
    expect(result.manifest.records[1]?.isTombstone).toBe(true)
    expect(result.manifest.records[1]?.value).toBeNull()
    expect(result.manifest.currentProjectionMutations).toBe(2)
    expect(result.artifact.key).toBe(`${GEN}-current-only-v1.json`)
    const sourceChunkBytes = delta.chunkArtifacts.reduce((a, c) => a + c.bytes.byteLength, 0)
    expect(result.artifact.bytes.byteLength).toBeLessThan(sourceChunkBytes)

    const opened = await decodeAndVerifyDbLessCurrentOnlyArtifactV1({
      bytes: result.artifact.bytes,
      expectedSha256: result.artifact.sha256,
      expected: {
        epochId: delta.manifest.epochId,
        baseIdentity: delta.manifest.baseIdentity,
        generationId: delta.manifest.generationId,
        sourceDeltaManifestSha256: delta.manifestArtifact.sha256,
        payloadDigest: delta.manifest.payloadDigest,
        previousLedgerIndex: delta.manifest.previousLedgerIndex,
        expectedParentHash: delta.manifest.expectedParentHash,
        startLedgerIndex: delta.manifest.startLedgerIndex,
        endLedgerIndex: delta.manifest.endLedgerIndex,
        endLedgerHash: delta.manifest.endLedgerHash,
        currentProjectionMutations: 2,
      },
    })
    expect(opened.records).toEqual(result.manifest.records)
  })

  it('detects mutated bytes or mismatched channel-bound generation fields', async () => {
    const delta = await fixture([[candidate('V1')]])
    const built = await buildDbLessCurrentOnlyArtifactV1(delta)
    const expected = {
      epochId: built.manifest.epochId,
      baseIdentity: built.manifest.baseIdentity,
      generationId: built.manifest.generationId,
      sourceDeltaManifestSha256: built.manifest.sourceDeltaManifestSha256,
      payloadDigest: built.manifest.payloadDigest,
      previousLedgerIndex: built.manifest.previousLedgerIndex,
      expectedParentHash: built.manifest.expectedParentHash,
      startLedgerIndex: built.manifest.startLedgerIndex,
      endLedgerIndex: built.manifest.endLedgerIndex,
      endLedgerHash: built.manifest.endLedgerHash,
      currentProjectionMutations: 1,
    }
    await expect(decodeAndVerifyDbLessCurrentOnlyArtifactV1({
      bytes: new Uint8Array([1, 2, 3]),
      expectedSha256: built.artifact.sha256,
      expected,
    })).rejects.toThrow(/digest/)
    await expect(decodeAndVerifyDbLessCurrentOnlyArtifactV1({
      bytes: built.artifact.bytes,
      expectedSha256: built.artifact.sha256,
      expected: { ...expected, endLedgerIndex: 103 },
    })).rejects.toThrow(/pointer identity/)
  })

  it('fails closed on duplicate Current keys instead of silently changing ordering', async () => {
    const delta = await fixture([[candidate('V1'), candidate('V1')]])
    await expect(buildDbLessCurrentOnlyArtifactV1(delta)).rejects.toThrow(/duplicate canonical key/)
  })

  it('fails closed when normalized chunk content diverges from its manifest digest', async () => {
    const delta = await fixture([[candidate('V1')]])
    delta.normalized.chunks[0]!.encoded[0] = 0
    await expect(buildDbLessCurrentOnlyArtifactV1(delta)).rejects.toThrow(/source chunk integrity/)
  })
})
