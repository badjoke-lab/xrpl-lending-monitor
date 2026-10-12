/**
 * D5 isolated v3 format and read-only replay. NO production channel/publisher.
 * Manifest and every referenced shard are immutable + SHA-bound. All references
 * carry an exact Release tag so unchanged buckets survive checkpoint changes.
 */
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'
import { compareDbLessCurrentProjectionCanonicalKeys, buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'
import { decompressDbLessD4Shard } from './current-overlay-compressed-shard'
import {
  planDbLessStableD4Shards,
  type DbLessStableD4ShardReferenceV1,
} from './current-overlay-stable-shard-plan'
import {
  assertDbLessCurrentOverlayGenerationProvenance,
  type DbLessCurrentOverlayGenerationProvenanceV2,
} from './current-overlay-provenance'

const HASH = /^[a-f0-9]{64}$/
const LEDGER_HASH = /^[A-F0-9]{64}$/
const RELEASE_TAG = /^d5-stable-d4-v3-(\d+)$/
const SHARD_KEY = /^current-overlay-stable-v1-b(\d{4})-([a-f0-9]{64})\.json\.gz$/
const MAX_SHARDS = 256
const MAX_BYTES = 2_000_000

export interface DbLessStableD4CheckpointV3 {
  schemaVersion: 3
  network: 'devnet'
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generationProvenance: DbLessCurrentOverlayGenerationProvenanceV2
  bucketCount: number
  entryCount: number
  tombstoneCount: number
  stateSha256: string
  shards: DbLessStableD4ShardReferenceV1[]
}

export type DbLessStableD4ReferencedReaderV3 = (
  releaseTag: string,
  key: string,
) => Promise<Uint8Array | null>

function exactPositive(value: number, field: string, max = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new Error(`D4 v3 ${field} is out of bounds`)
  }
}

function releaseTag(tag: string): number {
  const m = RELEASE_TAG.exec(tag)
  if (!m) throw new Error('D4 v3 source Release tag is not allowlisted')
  const ledger = Number(m[1])
  exactPositive(ledger, 'Release ledger')
  return ledger
}

function verifyEntry(entry: DbLessCurrentOverlayEntryV1, manifest: DbLessStableD4CheckpointV3): void {
  if (!entry || typeof entry !== 'object'
    || (entry.objectType !== 'vault' && entry.objectType !== 'loan_broker' && entry.objectType !== 'loan')
    || typeof entry.objectId !== 'string' || !entry.objectId
    || entry.canonicalKey !== buildDbLessCurrentProjectionCanonicalKey(entry.objectType, entry.objectId)
    || !Number.isSafeInteger(entry.sourceLedgerIndex)
    || entry.sourceLedgerIndex < 1 || entry.sourceLedgerIndex > manifest.throughLedgerIndex
    || !LEDGER_HASH.test(entry.sourceLedgerHash)
    || typeof entry.sourceTransactionHash !== 'string' || !entry.sourceTransactionHash
    || !Array.isArray(entry.relationshipIds)
    || entry.relationshipIds.some(r => typeof r !== 'string')
    || typeof entry.isTombstone !== 'boolean'
    || (entry.isTombstone ? entry.value !== null : entry.value === null)) {
    throw new Error('D4 v3 shard entry identity/provenance is invalid')
  }
}

export function assertDbLessStableD4CheckpointV3(m: DbLessStableD4CheckpointV3): void {
  if (!m || m.schemaVersion !== 3 || m.network !== 'devnet'
    || typeof m.epochId !== 'string' || !m.epochId
    || typeof m.baseIdentity !== 'string' || !m.baseIdentity
    || !LEDGER_HASH.test(m.throughLedgerHash)
    || !HASH.test(m.stateSha256)) {
    throw new Error('D4 v3 checkpoint identity is invalid')
  }
  exactPositive(m.throughLedgerIndex, 'throughLedgerIndex')
  exactPositive(m.bucketCount, 'bucketCount', MAX_SHARDS)
  exactPositive(m.generationProvenance?.generationCount, 'generationCount')
  assertDbLessCurrentOverlayGenerationProvenance(m.generationProvenance)
  if (!Number.isSafeInteger(m.entryCount) || m.entryCount < 0
    || !Number.isSafeInteger(m.tombstoneCount) || m.tombstoneCount < 0
    || m.tombstoneCount > m.entryCount
    || !Array.isArray(m.shards) || m.shards.length > m.bucketCount) {
    throw new Error('D4 v3 checkpoint counts are invalid')
  }
  let previousBucket = -1
  let totalRecords = 0
  const keys = new Set<string>()
  for (const shard of m.shards) {
    if (!Number.isSafeInteger(shard.bucket) || shard.bucket <= previousBucket
      || shard.bucket >= m.bucketCount || keys.has(shard.key)) {
      throw new Error('D4 v3 bucket must be unique, bounded and ordered')
    }
    previousBucket = shard.bucket
    keys.add(shard.key)
    const originLedger = releaseTag(shard.releaseTag)
    if (originLedger > m.throughLedgerIndex) {
      throw new Error('D4 v3 shard refers to future checkpoint')
    }
    const match = SHARD_KEY.exec(shard.key)
    if (!match || Number(match[1]) !== shard.bucket || match[2] !== shard.sha256 || !HASH.test(shard.sha256)) {
      throw new Error('D4 v3 content-addressed shard identity is invalid')
    }
    exactPositive(shard.bytes, 'shard bytes', MAX_BYTES)
    exactPositive(shard.uncompressedBytes, 'decoded bytes', MAX_BYTES)
    exactPositive(shard.records, 'bucket records', 50_000)
    totalRecords += shard.records
  }
  if (totalRecords !== m.entryCount) {
    throw new Error('D4 v3 manifest entry count does not match referenced shards')
  }
}

export async function prepareDbLessStableD4CheckpointV3(options: {
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generationProvenance: DbLessCurrentOverlayGenerationProvenanceV2
  bucketCount: number
  entries: readonly DbLessCurrentOverlayEntryV1[]
  previous?: DbLessStableD4CheckpointV3
}): Promise<{ manifest: DbLessStableD4CheckpointV3; manifestArtifact: DbLessArtifact; uploadArtifacts: DbLessArtifact[]; retainedReleaseTags: string[] }> {
  const previous = options.previous
  if (previous) {
    assertDbLessStableD4CheckpointV3(previous)
    if (previous.throughLedgerIndex >= options.throughLedgerIndex) {
      throw new Error('D4 v3 checkpoint ledger must move forward')
    }
    if (previous.generationProvenance.generationCount >= options.generationProvenance.generationCount) {
      throw new Error('D4 v3 source generation count must move forward')
    }
  }
  const plan = await planDbLessStableD4Shards({
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    bucketCount: options.bucketCount,
    targetReleaseTag: `d5-stable-d4-v3-${options.throughLedgerIndex}`,
    entries: options.entries,
    previous: previous ?? undefined,
  })
  const ordered = [...options.entries].sort((a, b) =>
    compareDbLessCurrentProjectionCanonicalKeys(a.canonicalKey, b.canonicalKey))
  const manifest: DbLessStableD4CheckpointV3 = {
    schemaVersion: 3, network: 'devnet',
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    throughLedgerIndex: options.throughLedgerIndex,
    throughLedgerHash: options.throughLedgerHash,
    generationProvenance: options.generationProvenance,
    bucketCount: options.bucketCount,
    entryCount: ordered.length,
    tombstoneCount: ordered.filter(item => item.isTombstone).length,
    stateSha256: await sha256Hex(`${canonicalJson(ordered)}\n`),
    shards: plan.shards,
  }
  assertDbLessStableD4CheckpointV3(manifest)
  ordered.forEach(e => verifyEntry(e, manifest))
  const bytes = utf8(`${canonicalJson(manifest)}\n`)
  if (bytes.byteLength > 1_000_000) throw new Error('D4 v3 manifest exceeds browser byte bound')
  const manifestArtifact: DbLessArtifact = {
    key: `current-overlay-v3-${options.throughLedgerIndex}-manifest.json`,
    mediaType: 'application/json', bytes,
    sha256: await sha256Hex(bytes), immutable: true,
  }
  return { manifest, manifestArtifact, uploadArtifacts: plan.uploadArtifacts, retainedReleaseTags: plan.retainedReleaseTags }
}

export async function readDbLessStableD4CheckpointV3(options: {
  manifestBytes: Uint8Array
  manifestSha256: string
  readArtifact: DbLessStableD4ReferencedReaderV3
}): Promise<{ manifest: DbLessStableD4CheckpointV3; entries: DbLessCurrentOverlayEntryV1[]; shardReads: number }> {
  if (!HASH.test(options.manifestSha256) || options.manifestBytes.byteLength > 1_000_000
    || await sha256Hex(options.manifestBytes) !== options.manifestSha256) {
    throw new Error('D4 v3 checkpoint manifest SHA or byte bound mismatch')
  }
  const m = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(options.manifestBytes)) as DbLessStableD4CheckpointV3
  assertDbLessStableD4CheckpointV3(m)
  if (new TextDecoder().decode(options.manifestBytes) !== `${canonicalJson(m)}\n`) {
    throw new Error('D4 v3 checkpoint manifest is not canonical JSON')
  }
  const entries: DbLessCurrentOverlayEntryV1[] = []
  const seen = new Set<string>()
  for (const shard of m.shards) {
    const bytes = await options.readArtifact(shard.releaseTag, shard.key)
    if (!bytes || bytes.byteLength !== shard.bytes || await sha256Hex(bytes) !== shard.sha256) {
      throw new Error('D4 v3 referenced immutable shard is missing or tampered')
    }
    const text = await decompressDbLessD4Shard(bytes, shard.uncompressedBytes)
    if (utf8(text).byteLength !== shard.uncompressedBytes) {
      throw new Error('D4 v3 referenced shard decoded byte count mismatch')
    }
    const payload = JSON.parse(text) as {
      schemaVersion: number; network: string; epochId: string; baseIdentity: string;
      bucket: number; bucketCount: number; records: DbLessCurrentOverlayEntryV1[]
    }
    if (text !== `${canonicalJson(payload)}\n`
      || payload.schemaVersion !== 1 || payload.network !== 'devnet'
      || payload.epochId !== m.epochId || payload.baseIdentity !== m.baseIdentity
      || payload.bucket !== shard.bucket || payload.bucketCount !== m.bucketCount
      || !Array.isArray(payload.records) || payload.records.length !== shard.records) {
      throw new Error('D4 v3 referenced shard identity/count is invalid')
    }
    let lastKey = ''
    for (const e of payload.records) {
      verifyEntry(e, m)
      if (seen.has(e.canonicalKey) || (lastKey && e.canonicalKey <= lastKey)) {
        throw new Error('D4 v3 shard records are unsorted or duplicated')
      }
      seen.add(e.canonicalKey)
      lastKey = e.canonicalKey
      const bucketHash = await sha256Hex(utf8(e.canonicalKey))
      if (Number.parseInt(bucketHash.slice(0, 8), 16) % m.bucketCount !== shard.bucket) {
        throw new Error('D4 v3 shard bucket membership mismatch')
      }
      entries.push(e)
    }
  }
  entries.sort((a, b) => compareDbLessCurrentProjectionCanonicalKeys(a.canonicalKey, b.canonicalKey))
  if (entries.length !== m.entryCount
    || entries.filter(e => e.isTombstone).length !== m.tombstoneCount
    || await sha256Hex(`${canonicalJson(entries)}\n`) !== m.stateSha256) {
    throw new Error('D4 v3 whole-checkpoint state equivalence failed')
  }
  return { manifest: m, entries, shardReads: m.shards.length }
}
