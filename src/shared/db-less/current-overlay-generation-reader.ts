import { sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  decodeAndVerifyNormalizedPayloadChunk,
  type NormalizedCandidateV1,
} from '../portable-collector-payload'
import type { DbLessArtifactLocationV1 } from './channel'
import {
  assertDbLessLiveDeltaManifest,
  type DbLessLiveDeltaManifestV1,
} from './live-delta'
import type { DbLessLiveChainDeltaV1 } from './live-chain'
import type { DbLessCurrentOverlayGenerationV1 } from './current-overlay-checkpoint'

export type DbLessLocatedArtifactReader = (
  location: DbLessArtifactLocationV1,
  key: string,
) => Promise<Uint8Array | null>

function assertDeltaPointerMatchesManifest(
  pointer: DbLessLiveChainDeltaV1,
  manifest: DbLessLiveDeltaManifestV1,
): void {
  if (
    pointer.generationId !== manifest.generationId
    || pointer.payloadDigest !== manifest.payloadDigest
    || pointer.previousLedgerIndex !== manifest.previousLedgerIndex
    || pointer.expectedParentHash !== manifest.expectedParentHash
    || pointer.startLedgerIndex !== manifest.startLedgerIndex
    || pointer.startLedgerHash !== manifest.startLedgerHash
    || pointer.endLedgerIndex !== manifest.endLedgerIndex
    || pointer.endLedgerHash !== manifest.endLedgerHash
    || pointer.ledgerCount !== manifest.ledgerCount
  ) {
    throw new Error('Live delta manifest does not match its chain pointer')
  }
}

export async function readDbLessCurrentOverlayGeneration(options: {
  delta: DbLessLiveChainDeltaV1
  readArtifact: DbLessLocatedArtifactReader
}): Promise<DbLessCurrentOverlayGenerationV1> {
  const manifestBytes = await options.readArtifact(
    options.delta.location,
    options.delta.manifestKey,
  )
  if (!manifestBytes) {
    throw new Error(`Missing live delta manifest: ${options.delta.manifestKey}`)
  }
  if (await sha256Hex(manifestBytes) !== options.delta.manifestSha256) {
    throw new Error('Live delta manifest SHA-256 does not match its chain pointer')
  }

  let manifest: DbLessLiveDeltaManifestV1
  try {
    manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as DbLessLiveDeltaManifestV1
  } catch {
    throw new Error('Live delta manifest is not valid JSON')
  }
  assertDbLessLiveDeltaManifest(manifest)
  assertDeltaPointerMatchesManifest(options.delta, manifest)

  const records: NormalizedCandidateV1[] = []
  for (const expected of manifest.chunks) {
    const bytes = await options.readArtifact(options.delta.location, expected.key)
    if (!bytes) throw new Error(`Missing live delta chunk: ${expected.key}`)
    if (bytes.byteLength !== expected.bytes) {
      throw new Error(`Live delta chunk byte count mismatch: ${expected.key}`)
    }
    if (await sha256Hex(bytes) !== expected.artifactSha256) {
      throw new Error(`Live delta chunk SHA-256 mismatch: ${expected.key}`)
    }

    const chunk = await decodeAndVerifyNormalizedPayloadChunk(bytes, manifest.payloadDigest)
    if (
      chunk.chunkIndex !== expected.chunkIndex
      || chunk.totalChunks !== manifest.chunks.length
      || chunk.records.length !== expected.records
      || chunk.chunkDigest !== expected.chunkDigest
    ) {
      throw new Error(`Live delta chunk metadata mismatch: ${expected.key}`)
    }

    for (const record of chunk.records) {
      if (record.semanticClass === 'current-projection') records.push(record)
    }
  }

  if (records.length !== manifest.semanticCounts.currentProjectionMutations) {
    throw new Error('Live delta Current projection count does not match semanticCounts')
  }

  return {
    generationId: manifest.generationId,
    startLedgerIndex: manifest.startLedgerIndex,
    endLedgerIndex: manifest.endLedgerIndex,
    records,
  }
}

export async function encodeDbLessLiveDeltaManifest(
  manifest: DbLessLiveDeltaManifestV1,
): Promise<Uint8Array> {
  assertDbLessLiveDeltaManifest(manifest)
  return utf8(`${canonicalJson(manifest)}\n`)
}
