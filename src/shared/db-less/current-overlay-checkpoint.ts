import type {
  NormalizedCandidateV1,
  PortableJsonValue,
} from '../portable-collector-payload'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'
import {\n  compareDbLessCurrentProjectionCanonicalKeys,\n  parseDbLessCurrentProjectionCanonicalKey,\n} from './current-projection-identity'

const LEDGER_HASH = /^[A-F0-9]{64}$/

export type DbLessCurrentOverlayObjectTypeV1 = 'vault' | 'loan_broker' | 'loan'

export interface DbLessCurrentOverlayGenerationV1 {
  generationId: string
  startLedgerIndex: number
  endLedgerIndex: number
  records: readonly NormalizedCandidateV1[]
}

export interface DbLessCurrentOverlayEntryV1 {
  canonicalKey: string
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string
  relationshipIds: string[]
  isTombstone: boolean
  value: PortableJsonValue
}

export interface DbLessCurrentOverlayShardV1 {
  bucket: number
  key: string
  records: number
  bytes: number
  artifactSha256: string
}

export interface DbLessCurrentOverlayCheckpointManifestV1 {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generationCount: number
  sourceGenerationIds: string[]
  bucketCount: number
  entryCount: number
  tombstoneCount: number
  shards: DbLessCurrentOverlayShardV1[]
}

export interface DbLessCurrentOverlayCheckpointV1 {
  manifest: DbLessCurrentOverlayCheckpointManifestV1
  manifestArtifact: DbLessArtifact
  shardArtifacts: DbLessArtifact[]
}

function nonEmpty(value: string, field: string): string {
  if (!value.length) throw new Error(`${field} must be non-empty`)
  return value
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function ledgerHash(value: string, field: string): string {
  const normalized = value.toUpperCase()
  if (!LEDGER_HASH.test(normalized)) {
    throw new Error(`${field} must be an uppercase 64-character ledger hash`)
  }
  return normalized
}

function projectionIdentity(candidate: NormalizedCandidateV1): {
  objectType: DbLessCurrentOverlayObjectTypeV1
  objectId: string
} {
  if (candidate.semanticClass !== 'current-projection') {
    throw new Error('D4 Current overlay accepts only current-projection records')
  }
  if (candidate.objectId === null) {
    throw new Error('Current projection record must have an object ID')
  }
  if (candidate.sourceTransactionHash === null) {
    throw new Error('Current projection record must have a source transaction hash')
  }

  return {
    objectType: parseDbLessCurrentProjectionCanonicalKey(
      candidate.canonicalKey,
      candidate.objectId,
    ),
    objectId: candidate.objectId,
  }
}

function entryFromCandidate(candidate: NormalizedCandidateV1): DbLessCurrentOverlayEntryV1 {
  const identity = projectionIdentity(candidate)
  if (candidate.isTombstone && candidate.value !== null) {
    throw new Error('Current projection tombstone value must be null')
  }
  if (!candidate.isTombstone && candidate.value === null) {
    throw new Error('Current projection upsert value must be non-null')
  }
  return {
    canonicalKey: candidate.canonicalKey,
    objectType: identity.objectType,
    objectId: identity.objectId,
    sourceLedgerIndex: candidate.sourceLedgerIndex,
    sourceLedgerHash: ledgerHash(candidate.sourceLedgerHash, 'sourceLedgerHash'),
    sourceTransactionHash: candidate.sourceTransactionHash!,
    relationshipIds: [...candidate.relationshipIds].sort((left, right) => left.localeCompare(right)),
    isTombstone: candidate.isTombstone,
    value: candidate.value,
  }
}

async function bucketFor(key: string, bucketCount: number): Promise<number> {
  const digest = await sha256Hex(utf8(key))
  return Number.parseInt(digest.slice(0, 8), 16) % bucketCount
}

export async function buildDbLessCurrentOverlayCheckpoint(options: {
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  throughLedgerHash: string
  generations: readonly DbLessCurrentOverlayGenerationV1[]
  bucketCount?: number
  maxRecordsPerShard?: number
  maxBytesPerShard?: number
}): Promise<DbLessCurrentOverlayCheckpointV1> {
  const epochId = nonEmpty(options.epochId, 'epochId')
  const baseIdentity = nonEmpty(options.baseIdentity, 'baseIdentity')
  const throughLedgerIndex = positiveInteger(options.throughLedgerIndex, 'throughLedgerIndex')
  const throughLedgerHash = ledgerHash(options.throughLedgerHash, 'throughLedgerHash')
  const bucketCount = positiveInteger(options.bucketCount ?? 256, 'bucketCount')
  const maxRecordsPerShard = positiveInteger(
    options.maxRecordsPerShard ?? 50_000,
    'maxRecordsPerShard',
  )
  const maxBytesPerShard = positiveInteger(options.maxBytesPerShard ?? 2_000_000, 'maxBytesPerShard')

  if (options.generations.length === 0) {
    throw new Error('D4 Current overlay checkpoint requires at least one generation')
  }

  const latest = new Map<string, DbLessCurrentOverlayEntryV1>()
  const sourceGenerationIds: string[] = []
  let previousEnd: number | null = null

  for (const generation of options.generations) {
    nonEmpty(generation.generationId, 'generationId')
    positiveInteger(generation.startLedgerIndex, 'generation.startLedgerIndex')
    positiveInteger(generation.endLedgerIndex, 'generation.endLedgerIndex')
    if (generation.endLedgerIndex < generation.startLedgerIndex) {
      throw new Error('Generation end ledger precedes start ledger')
    }
    if (previousEnd !== null && generation.startLedgerIndex !== previousEnd + 1) {
      throw new Error('D4 Current overlay generations must be contiguous and ordered')
    }
    previousEnd = generation.endLedgerIndex
    sourceGenerationIds.push(generation.generationId)

    const seen = new Set<string>()
    for (const candidate of generation.records) {
      if (
        candidate.sourceLedgerIndex < generation.startLedgerIndex
        || candidate.sourceLedgerIndex > generation.endLedgerIndex
      ) {
        throw new Error('Current projection source ledger is outside its generation')
      }
      if (seen.has(candidate.canonicalKey)) {
        throw new Error('Current projection generation contains duplicate canonical keys')
      }
      seen.add(candidate.canonicalKey)
      latest.set(candidate.canonicalKey, entryFromCandidate(candidate))
    }
  }

  if (previousEnd !== throughLedgerIndex) {
    throw new Error('Checkpoint through ledger must match the final generation end')
  }

  const buckets = Array.from({ length: bucketCount }, () => [] as DbLessCurrentOverlayEntryV1[])
  const entries = [...latest.values()].sort((left, right) =>
    compareDbLessCurrentProjectionCanonicalKeys(
      left.canonicalKey,
      right.canonicalKey,
    ),
  )
  for (const entry of entries) {
    buckets[await bucketFor(entry.canonicalKey, bucketCount)]!.push(entry)
  }

  const shardArtifacts: DbLessArtifact[] = []
  const shards: DbLessCurrentOverlayShardV1[] = []
  for (let bucket = 0; bucket < buckets.length; bucket += 1) {
    const records = buckets[bucket]!
    if (records.length === 0) continue
    if (records.length > maxRecordsPerShard) {
      throw new Error(`D4 Current overlay bucket ${bucket} exceeds the record guard`)
    }

    const body = {
      schemaVersion: 1 as const,
      network: 'devnet' as const,
      epochId,
      baseIdentity,
      throughLedgerIndex,
      bucket,
      bucketCount,
      records,
    }
    const bytes = utf8(`${canonicalJson(body)}\n`)
    if (bytes.byteLength > maxBytesPerShard) {
      throw new Error(`D4 Current overlay bucket ${bucket} exceeds the byte guard`)
    }
    const key = `current-overlay-v1-${throughLedgerIndex}-bucket-${String(bucket).padStart(4, '0')}.json`
    const artifactSha256 = await sha256Hex(bytes)
    shardArtifacts.push({
      key,
      mediaType: 'application/json',
      bytes,
      sha256: artifactSha256,
      immutable: true,
    })
    shards.push({
      bucket,
      key,
      records: records.length,
      bytes: bytes.byteLength,
      artifactSha256,
    })
  }

  const manifest: DbLessCurrentOverlayCheckpointManifestV1 = {
    schemaVersion: 1,
    network: 'devnet',
    epochId,
    baseIdentity,
    throughLedgerIndex,
    throughLedgerHash,
    generationCount: options.generations.length,
    sourceGenerationIds,
    bucketCount,
    entryCount: entries.length,
    tombstoneCount: entries.filter((entry) => entry.isTombstone).length,
    shards,
  }
  const manifestBytes = utf8(`${canonicalJson(manifest)}\n`)
  const manifestArtifact: DbLessArtifact = {
    key: `current-overlay-v1-${throughLedgerIndex}-manifest.json`,
    mediaType: 'application/json',
    bytes: manifestBytes,
    sha256: await sha256Hex(manifestBytes),
    immutable: true,
  }

  return { manifest, manifestArtifact, shardArtifacts }
}
