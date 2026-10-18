/**
 * ISOLATED D5 DESIGN PROOF — not a production publisher or D4 v3 manifest.
 * Unchanged Current objects must not be rewritten merely because the
 * checkpoint's throughLedgerIndex advanced. This planner uses stable
 * content-addressed compressed bucket bytes, but makes no claim that
 * Release lifetime/GC and cross-Release browser routing are qualified.
 */
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import type { DbLessCurrentOverlayEntryV1 } from './current-overlay-checkpoint'
import { compressDbLessD4Shard } from './current-overlay-compressed-shard'
import { compareDbLessCurrentProjectionCanonicalKeys } from './current-projection-identity'

export interface DbLessStableD4ShardReferenceV1 {
  bucket: number
  releaseTag: string
  key: string
  sha256: string
  bytes: number
  uncompressedBytes: number
  records: number
}

export interface DbLessStableD4PlanV1 {
  schemaVersion: 1
  epochId: string
  baseIdentity: string
  bucketCount: number
  shards: DbLessStableD4ShardReferenceV1[]
  uploadArtifacts: DbLessArtifact[]
  newShardCount: number
  reusedShardCount: number
  uploadBytes: number
  totalReferencedBytes: number
  retainedReleaseTags: string[]
}

function identity(value: string, field: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256) {
    throw new Error(`D4 stable ${field} is invalid`)
  }
}
function releaseTag(value: string): void {
  identity(value, 'releaseTag')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error('D4 stable Release tag is unsafe')
  }
}
async function bucketFor(key: string, count: number): Promise<number> {
  const hash = await sha256Hex(utf8(key))
  return Number.parseInt(hash.slice(0, 8), 16) % count
}

export async function planDbLessStableD4Shards(options: {
  epochId: string
  baseIdentity: string
  bucketCount: number
  targetReleaseTag: string
  entries: readonly DbLessCurrentOverlayEntryV1[]
  previous?: Pick<DbLessStableD4PlanV1, 'epochId' | 'baseIdentity' | 'bucketCount' | 'shards'>
}): Promise<DbLessStableD4PlanV1> {
  identity(options.epochId, 'epochId')
  identity(options.baseIdentity, 'baseIdentity')
  releaseTag(options.targetReleaseTag)
  if (!Number.isSafeInteger(options.bucketCount)
    || options.bucketCount < 1 || options.bucketCount > 256) {
    throw new Error('D4 stable bucket count is outside bound')
  }
  if (options.entries.length > 1_000_000) {
    throw new Error('D4 stable entry count exceeds bound')
  }
  const previous = options.previous
  if (previous && (previous.epochId !== options.epochId
    || previous.baseIdentity !== options.baseIdentity
    || previous.bucketCount !== options.bucketCount)) {
    throw new Error('D4 stable prior checkpoint context differs')
  }
  const known = new Map<number, DbLessStableD4ShardReferenceV1>()
  for (const shard of previous?.shards ?? []) {
    if (!Number.isSafeInteger(shard.bucket)
      || shard.bucket < 0 || shard.bucket >= options.bucketCount || known.has(shard.bucket)) {
      throw new Error('D4 stable previous bucket identity is invalid')
    }
    releaseTag(shard.releaseTag)
    known.set(shard.bucket, shard)
  }

  const buckets = Array.from({ length: options.bucketCount },
    () => [] as DbLessCurrentOverlayEntryV1[])
  const seen = new Set<string>()
  for (const entry of options.entries) {
    if (!entry || typeof entry.canonicalKey !== 'string' || !entry.canonicalKey
      || seen.has(entry.canonicalKey)) {
      throw new Error('D4 stable input contains a missing or duplicate canonical key')
    }
    seen.add(entry.canonicalKey)
    buckets[await bucketFor(entry.canonicalKey, options.bucketCount)]!.push(entry)
  }

  const shards: DbLessStableD4ShardReferenceV1[] = []
  const uploadArtifacts: DbLessArtifact[] = []
  let reusedShardCount = 0
  for (const [bucket, unsorted] of buckets.entries()) {
    if (unsorted.length === 0) continue
    if (unsorted.length > 50_000) throw new Error('D4 stable bucket record count exceeds bound')
    const records = [...unsorted].sort((a, b) =>
      compareDbLessCurrentProjectionCanonicalKeys(a.canonicalKey, b.canonicalKey))
    const text = `${canonicalJson({
      schemaVersion: 1,
      network: 'devnet',
      epochId: options.epochId,
      baseIdentity: options.baseIdentity,
      bucket,
      bucketCount: options.bucketCount,
      records,
    })}\n`
    const uncompressedBytes = utf8(text).byteLength
    if (uncompressedBytes > 2_000_000) {
      throw new Error('D4 stable uncompressed bucket exceeds byte bound')
    }
    const bytes = await compressDbLessD4Shard(text)
    if (bytes.byteLength > 2_000_000) {
      throw new Error('D4 stable gzip bucket exceeds byte bound')
    }
    const sha256 = await sha256Hex(bytes)
    const key = `current-overlay-stable-v1-b${String(bucket).padStart(4, '0')}-${sha256}.json.gz`
    const existing = known.get(bucket)
    const reuse = existing !== undefined
      && existing.key === key
      && existing.sha256 === sha256
      && existing.bytes === bytes.byteLength
      && existing.uncompressedBytes === uncompressedBytes
      && existing.records === records.length
    const location = reuse ? existing.releaseTag : options.targetReleaseTag
    shards.push({
      bucket, releaseTag: location, key, sha256, bytes: bytes.byteLength,
      uncompressedBytes, records: records.length,
    })
    if (reuse) {
      reusedShardCount += 1
    } else {
      uploadArtifacts.push({
        key, bytes, mediaType: 'application/gzip', sha256, immutable: true,
      })
    }
  }
  return {
    schemaVersion: 1,
    epochId: options.epochId,
    baseIdentity: options.baseIdentity,
    bucketCount: options.bucketCount,
    shards,
    uploadArtifacts,
    newShardCount: uploadArtifacts.length,
    reusedShardCount,
    uploadBytes: uploadArtifacts.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0),
    totalReferencedBytes: shards.reduce((sum, shard) => sum + shard.bytes, 0),
    retainedReleaseTags: [...new Set(shards.map(s => s.releaseTag))].sort(),
  }
}
