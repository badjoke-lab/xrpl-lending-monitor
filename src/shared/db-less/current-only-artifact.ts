import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import type { DbLessArtifact, DbLessLiveDeltaArtifactSet } from './live-delta'

const SHA256 = /^[a-f0-9]{64}$/
const MAX_CURRENT_ONLY_RECORDS = 10_000
const MAX_CURRENT_ONLY_BYTES = 2_000_000

export interface DbLessCurrentOnlyArtifactV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  generationId: string
  sourceDeltaManifestSha256: string
  payloadDigest: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  endLedgerIndex: number
  endLedgerHash: string
  currentProjectionMutations: number
  records: NormalizedCandidateV1[]
}

export interface DbLessCurrentOnlyAssetSetV1 {
  manifest: DbLessCurrentOnlyArtifactV1
  artifact: DbLessArtifact
}

function assertIdentity(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Current-only ${field} must be non-empty`)
  }
}

function assertCount(value: number, field: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`Current-only ${field} must be bounded`)
  }
}

export function assertDbLessCurrentOnlyArtifactV1(
  document: DbLessCurrentOnlyArtifactV1,
): void {
  if (!document || document.schemaVersion !== 1 || document.network !== 'devnet') {
    throw new Error('Current-only artifact schema/network is invalid')
  }
  for (const [field, value] of [
    ['epochId', document.epochId],
    ['baseIdentity', document.baseIdentity],
    ['generationId', document.generationId],
  ] as const) assertIdentity(value, field)
  if (!SHA256.test(document.sourceDeltaManifestSha256)) {
    throw new Error('Current-only source delta manifest SHA-256 is invalid')
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(document.payloadDigest)) {
    throw new Error('Current-only payload digest is invalid')
  }
  if (!/^[A-F0-9]{64}$/.test(document.expectedParentHash)
    || !/^[A-F0-9]{64}$/.test(document.endLedgerHash)) {
    throw new Error('Current-only ledger hashes are invalid')
  }
  if (!Number.isSafeInteger(document.previousLedgerIndex)
    || document.previousLedgerIndex < 1
    || !Number.isSafeInteger(document.startLedgerIndex)
    || document.startLedgerIndex !== document.previousLedgerIndex + 1
    || !Number.isSafeInteger(document.endLedgerIndex)
    || document.endLedgerIndex < document.startLedgerIndex) {
    throw new Error('Current-only ledger bounds are invalid')
  }
  if (!Array.isArray(document.records)) {
    throw new Error('Current-only records are missing')
  }
  assertCount(document.records.length, 'records', MAX_CURRENT_ONLY_RECORDS)
  if (document.currentProjectionMutations !== document.records.length) {
    throw new Error('Current-only mutation count does not match records')
  }
  const seen = new Set<string>()
  for (const record of document.records) {
    if (record.semanticClass !== 'current-projection') {
      throw new Error('Current-only artifact contains a non-Current record')
    }
    assertIdentity(record.canonicalKey, 'canonicalKey')
    if (seen.has(record.canonicalKey)) {
      throw new Error('Current-only artifact contains a duplicate canonical key')
    }
    seen.add(record.canonicalKey)
    if (!Number.isSafeInteger(record.sourceLedgerIndex)
      || record.sourceLedgerIndex < document.startLedgerIndex
      || record.sourceLedgerIndex > document.endLedgerIndex) {
      throw new Error('Current-only mutation ledger is outside source generation')
    }
    if (!record.objectId) {
      throw new Error('Current-only mutation is missing its object ID')
    }
    if (record.isTombstone && record.value !== null) {
      throw new Error('Current-only tombstone must have a null value')
    }
  }
}

/**
 * Isolated D5 builder. Does not modify a live channel or publish assets.
 * Every mutation comes from D3's existing normalized chunk memory.
 * Publication must verify/publish this asset BEFORE an optional channel pointer.
 */
export async function buildDbLessCurrentOnlyArtifactV1(
  delta: DbLessLiveDeltaArtifactSet,
): Promise<DbLessCurrentOnlyAssetSetV1> {
  if (await sha256Hex(delta.manifestArtifact.bytes) !== delta.manifestArtifact.sha256) {
    throw new Error('Current-only source delta manifest integrity mismatch')
  }
  const chunks = delta.normalized.chunks
  if (chunks.length !== delta.manifest.chunks.length) {
    throw new Error('Current-only source chunk count mismatch')
  }
  const records: NormalizedCandidateV1[] = []
  for (const [i, built] of chunks.entries()) {
    const descriptor = delta.manifest.chunks[i]!
    if (built.chunk.chunkIndex !== i
      || descriptor.chunkIndex !== i
      || built.chunk.payloadDigest !== delta.manifest.payloadDigest
      || descriptor.records !== built.chunk.records.length
      || descriptor.bytes !== built.encoded.byteLength
      || await sha256Hex(built.encoded) !== descriptor.artifactSha256) {
      throw new Error('Current-only source chunk integrity mismatch')
    }
    records.push(...built.chunk.records.filter((r) => r.semanticClass === 'current-projection'))
  }
  if (records.length !== delta.manifest.semanticCounts.currentProjectionMutations) {
    throw new Error('Current-only source semantic count mismatch')
  }
  const document: DbLessCurrentOnlyArtifactV1 = {
    schemaVersion: 1,
    network: 'devnet',
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
    currentProjectionMutations: records.length,
    records,
  }
  assertDbLessCurrentOnlyArtifactV1(document)
  const bytes = utf8(`${canonicalJson(document)}\n`)
  if (bytes.byteLength > MAX_CURRENT_ONLY_BYTES) {
    throw new Error('Current-only artifact exceeds the bounded browser byte budget')
  }
  const key = `${delta.manifest.generationId}-current-only-v1.json`
  const artifact: DbLessArtifact = {
    key,
    mediaType: 'application/json',
    bytes,
    sha256: await sha256Hex(bytes),
    immutable: true,
  }
  return { manifest: document, artifact }
}

export async function decodeAndVerifyDbLessCurrentOnlyArtifactV1(options: {
  bytes: Uint8Array
  expectedSha256: string
  expected: {
    epochId: string
    baseIdentity: string
    generationId: string
    sourceDeltaManifestSha256: string
    payloadDigest: string
    previousLedgerIndex: number
    expectedParentHash: string
    startLedgerIndex: number
    endLedgerIndex: number
    endLedgerHash: string
    currentProjectionMutations: number
  }
}): Promise<DbLessCurrentOnlyArtifactV1> {
  if (options.bytes.byteLength > MAX_CURRENT_ONLY_BYTES
    || !SHA256.test(options.expectedSha256)
    || await sha256Hex(options.bytes) !== options.expectedSha256) {
    throw new Error('Current-only immutable asset digest or byte bound mismatch')
  }
  const document = JSON.parse(new TextDecoder().decode(options.bytes)) as DbLessCurrentOnlyArtifactV1
  assertDbLessCurrentOnlyArtifactV1(document)
  const expected = options.expected
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    if (document[key] !== expected[key]) {
      throw new Error(`Current-only pointer identity mismatch: ${key}`)
    }
  }
  if (new TextDecoder().decode(options.bytes) !== `${canonicalJson(document)}\n`) {
    throw new Error('Current-only artifact is not canonical')
  }
  return document
}
