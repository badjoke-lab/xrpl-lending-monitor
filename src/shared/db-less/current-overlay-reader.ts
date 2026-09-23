import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import type {
  DbLessCurrentOverlayCheckpointManifestV1,
  DbLessCurrentOverlayEntryV1,
  DbLessCurrentOverlayObjectTypeV1,
  DbLessCurrentOverlayShardV1,
} from './current-overlay-checkpoint'

const LEDGER_HASH = /^[A-F0-9]{64}$/
const SHA256 = /^[a-f0-9]{64}$/
const SAFE_ASSET_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const DEFAULT_MAX_SHARD_READS = 8

export type DbLessCurrentOverlayArtifactReader = (
  key: string,
) => Promise<Uint8Array | null>

export interface DbLessCurrentOverlayLookupResult {
  item: DbLessCurrentOverlayEntryV1 | null
  shardReads: number
}

export interface DbLessCurrentOverlayListOptions {
  limit?: number
  cursor?: string
  maxShardReads?: number
  includeTombstones?: boolean
}

export interface DbLessCurrentOverlayListResult {
  items: DbLessCurrentOverlayEntryV1[]
  nextCursor: string | null
  complete: boolean
  shardReads: number
}

type CursorV1 = {
  v: 1
  throughLedgerIndex: number
  objectType: DbLessCurrentOverlayObjectTypeV1
  includeTombstones: boolean
  shard: number
  offset: number
}

type ShardBodyV1 = {
  schemaVersion: 1
  network: 'devnet'
  epochId: string
  baseIdentity: string
  throughLedgerIndex: number
  bucket: number
  bucketCount: number
  records: DbLessCurrentOverlayEntryV1[]
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer`)
  }
  return value
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
  return value
}

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function objectType(value: unknown, field: string): DbLessCurrentOverlayObjectTypeV1 {
  if (value !== 'vault' && value !== 'loan_broker' && value !== 'loan') {
    throw new Error(`${field} is invalid`)
  }
  return value
}

function canonicalKey(
  type: DbLessCurrentOverlayObjectTypeV1,
  objectId: string,
): string {
  return `projection:${type}:${objectId.toLowerCase()}`
}

async function bucketFor(key: string, bucketCount: number): Promise<number> {
  const digest = await sha256Hex(utf8(key))
  return Number.parseInt(digest.slice(0, 8), 16) % bucketCount
}

function assertManifest(manifest: DbLessCurrentOverlayCheckpointManifestV1): void {
  if (manifest.schemaVersion !== 1 || manifest.network !== 'devnet') {
    throw new Error('D4 Current overlay manifest schema is invalid')
  }
  nonEmpty(manifest.epochId, 'epochId')
  nonEmpty(manifest.baseIdentity, 'baseIdentity')
  positiveInteger(manifest.throughLedgerIndex, 'throughLedgerIndex')
  if (!LEDGER_HASH.test(manifest.throughLedgerHash)) {
    throw new Error('throughLedgerHash must be an uppercase 64-character ledger hash')
  }
  positiveInteger(manifest.generationCount, 'generationCount')
  if (
    manifest.sourceGenerationIds.length !== manifest.generationCount
    || new Set(manifest.sourceGenerationIds).size !== manifest.sourceGenerationIds.length
  ) {
    throw new Error('D4 Current overlay source generation IDs are inconsistent')
  }
  manifest.sourceGenerationIds.forEach((value, index) =>
    nonEmpty(value, `sourceGenerationIds[${index}]`))
  positiveInteger(manifest.bucketCount, 'bucketCount')
  nonNegativeInteger(manifest.entryCount, 'entryCount')
  nonNegativeInteger(manifest.tombstoneCount, 'tombstoneCount')
  if (manifest.tombstoneCount > manifest.entryCount) {
    throw new Error('D4 Current overlay tombstone count exceeds entry count')
  }

  let previousBucket = -1
  let records = 0
  const keys = new Set<string>()
  for (const [index, shard] of manifest.shards.entries()) {
    nonNegativeInteger(shard.bucket, `shards[${index}].bucket`)
    if (shard.bucket >= manifest.bucketCount || shard.bucket <= previousBucket) {
      throw new Error('D4 Current overlay shard buckets must be unique and ordered')
    }
    previousBucket = shard.bucket
    if (!SAFE_ASSET_KEY.test(shard.key) || keys.has(shard.key)) {
      throw new Error('D4 Current overlay shard key is invalid or duplicated')
    }
    keys.add(shard.key)
    positiveInteger(shard.records, `shards[${index}].records`)
    positiveInteger(shard.bytes, `shards[${index}].bytes`)
    if (!SHA256.test(shard.artifactSha256)) {
      throw new Error('D4 Current overlay shard SHA-256 is invalid')
    }
    records += shard.records
  }
  if (records !== manifest.entryCount) {
    throw new Error('D4 Current overlay shard record total does not match entry count')
  }
}

function parseEntry(value: unknown): DbLessCurrentOverlayEntryV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('D4 Current overlay entry must be an object')
  }
  const source = value as Record<string, unknown>
  const parsedType = objectType(source.objectType, 'entry.objectType')
  const objectId = nonEmpty(String(source.objectId ?? ''), 'entry.objectId')
  const key = nonEmpty(String(source.canonicalKey ?? ''), 'entry.canonicalKey')
  if (key !== canonicalKey(parsedType, objectId)) {
    throw new Error('D4 Current overlay entry canonical key is inconsistent')
  }
  const sourceLedgerIndex = Number(source.sourceLedgerIndex)
  positiveInteger(sourceLedgerIndex, 'entry.sourceLedgerIndex')
  const sourceLedgerHash = nonEmpty(String(source.sourceLedgerHash ?? ''), 'entry.sourceLedgerHash')
  if (!LEDGER_HASH.test(sourceLedgerHash)) {
    throw new Error('D4 Current overlay entry ledger hash is invalid')
  }
  const sourceTransactionHash = nonEmpty(
    String(source.sourceTransactionHash ?? ''),
    'entry.sourceTransactionHash',
  )
  if (!Array.isArray(source.relationshipIds) || source.relationshipIds.some((item) => typeof item !== 'string')) {
    throw new Error('D4 Current overlay relationship IDs are invalid')
  }
  if (typeof source.isTombstone !== 'boolean') {
    throw new Error('D4 Current overlay tombstone flag is invalid')
  }
  if (source.isTombstone && source.value !== null) {
    throw new Error('D4 Current overlay tombstone value must be null')
  }
  if (!source.isTombstone && source.value === null) {
    throw new Error('D4 Current overlay upsert value must be non-null')
  }
  return {
    canonicalKey: key,
    objectType: parsedType,
    objectId,
    sourceLedgerIndex,
    sourceLedgerHash,
    sourceTransactionHash,
    relationshipIds: [...source.relationshipIds] as string[],
    isTombstone: source.isTombstone,
    value: source.value as DbLessCurrentOverlayEntryV1['value'],
  }
}

function encodeCursor(cursor: CursorV1): string {
  return Array.from(utf8(canonicalJson(cursor)), (byte) =>
    byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(options: {
  cursor?: string
  manifest: DbLessCurrentOverlayCheckpointManifestV1
  objectType: DbLessCurrentOverlayObjectTypeV1
  includeTombstones: boolean
}): CursorV1 {
  if (!options.cursor) {
    return {
      v: 1,
      throughLedgerIndex: options.manifest.throughLedgerIndex,
      objectType: options.objectType,
      includeTombstones: options.includeTombstones,
      shard: 0,
      offset: 0,
    }
  }
  if (options.cursor.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(options.cursor)) {
    throw new Error('D4 Current overlay cursor is invalid')
  }
  const bytes = new Uint8Array(options.cursor.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(options.cursor.slice(index * 2, index * 2 + 2), 16)
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CursorV1>
  if (
    parsed.v !== 1
    || parsed.throughLedgerIndex !== options.manifest.throughLedgerIndex
    || parsed.objectType !== options.objectType
    || parsed.includeTombstones !== options.includeTombstones
  ) {
    throw new Error('D4 Current overlay cursor does not match the query')
  }
  const shard = Number(parsed.shard)
  const offset = Number(parsed.offset)
  nonNegativeInteger(shard, 'cursor.shard')
  nonNegativeInteger(offset, 'cursor.offset')
  if (shard > options.manifest.shards.length) {
    throw new Error('D4 Current overlay cursor shard is out of range')
  }
  return {
    v: 1,
    throughLedgerIndex: options.manifest.throughLedgerIndex,
    objectType: options.objectType,
    includeTombstones: options.includeTombstones,
    shard,
    offset,
  }
}

export class DbLessCurrentOverlayReader {
  readonly manifest: DbLessCurrentOverlayCheckpointManifestV1
  readonly #readArtifact: DbLessCurrentOverlayArtifactReader
  readonly #maxShardBytes: number
  readonly #cache = new Map<number, DbLessCurrentOverlayEntryV1[]>()

  constructor(options: {
    manifest: DbLessCurrentOverlayCheckpointManifestV1
    readArtifact: DbLessCurrentOverlayArtifactReader
    maxShardBytes?: number
  }) {
    assertManifest(options.manifest)
    this.manifest = options.manifest
    this.#readArtifact = options.readArtifact
    this.#maxShardBytes = positiveInteger(options.maxShardBytes ?? 2_000_000, 'maxShardBytes')
  }

  async #shard(descriptor: DbLessCurrentOverlayShardV1): Promise<{
    records: DbLessCurrentOverlayEntryV1[]
    shardReads: number
  }> {
    const cached = this.#cache.get(descriptor.bucket)
    if (cached) return { records: cached, shardReads: 0 }
    if (descriptor.bytes > this.#maxShardBytes) {
      throw new Error('D4 Current overlay shard exceeds reader byte limit')
    }
    const bytes = await this.#readArtifact(descriptor.key)
    if (!bytes || bytes.byteLength !== descriptor.bytes) {
      throw new Error(`Missing or invalid D4 Current overlay shard: ${descriptor.key}`)
    }
    if (await sha256Hex(bytes) !== descriptor.artifactSha256) {
      throw new Error(`D4 Current overlay shard SHA-256 mismatch: ${descriptor.key}`)
    }

    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as ShardBodyV1
    if (
      decoded.schemaVersion !== 1
      || decoded.network !== 'devnet'
      || decoded.epochId !== this.manifest.epochId
      || decoded.baseIdentity !== this.manifest.baseIdentity
      || decoded.throughLedgerIndex !== this.manifest.throughLedgerIndex
      || decoded.bucket !== descriptor.bucket
      || decoded.bucketCount !== this.manifest.bucketCount
      || !Array.isArray(decoded.records)
      || decoded.records.length !== descriptor.records
    ) {
      throw new Error(`D4 Current overlay shard identity mismatch: ${descriptor.key}`)
    }

    const records: DbLessCurrentOverlayEntryV1[] = []
    let previousKey: string | null = null
    for (const value of decoded.records) {
      const entry = parseEntry(value)
      if (entry.sourceLedgerIndex > this.manifest.throughLedgerIndex) {
        throw new Error('D4 Current overlay entry is newer than its checkpoint')
      }
      if (await bucketFor(entry.canonicalKey, this.manifest.bucketCount) !== descriptor.bucket) {
        throw new Error('D4 Current overlay entry is in the wrong bucket')
      }
      if (previousKey !== null && entry.canonicalKey <= previousKey) {
        throw new Error('D4 Current overlay shard entries must be strictly ordered')
      }
      previousKey = entry.canonicalKey
      records.push(entry)
    }

    if (this.#cache.size >= 4) {
      this.#cache.delete(this.#cache.keys().next().value as number)
    }
    this.#cache.set(descriptor.bucket, records)
    return { records, shardReads: 1 }
  }

  async get(
    type: DbLessCurrentOverlayObjectTypeV1,
    objectId: string,
  ): Promise<DbLessCurrentOverlayLookupResult> {
    const id = nonEmpty(objectId, 'objectId')
    const key = canonicalKey(type, id)
    const bucket = await bucketFor(key, this.manifest.bucketCount)
    const descriptor = this.manifest.shards.find((shard) => shard.bucket === bucket)
    if (!descriptor) return { item: null, shardReads: 0 }

    const loaded = await this.#shard(descriptor)
    const item = loaded.records.find((entry) => entry.canonicalKey === key) ?? null
    return { item, shardReads: loaded.shardReads }
  }

  async list(
    type: DbLessCurrentOverlayObjectTypeV1,
    options: DbLessCurrentOverlayListOptions = {},
  ): Promise<DbLessCurrentOverlayListResult> {
    const limit = positiveInteger(options.limit ?? DEFAULT_LIMIT, 'limit')
    if (limit > MAX_LIMIT) throw new Error(`limit must not exceed ${MAX_LIMIT}`)
    const maxShardReads = positiveInteger(
      options.maxShardReads ?? DEFAULT_MAX_SHARD_READS,
      'maxShardReads',
    )
    const includeTombstones = options.includeTombstones ?? true
    const cursor = decodeCursor({
      cursor: options.cursor,
      manifest: this.manifest,
      objectType: type,
      includeTombstones,
    })

    const items: DbLessCurrentOverlayEntryV1[] = []
    let shardReads = 0
    let shardIndex = cursor.shard
    let offset = cursor.offset

    while (shardIndex < this.manifest.shards.length) {
      const descriptor = this.manifest.shards[shardIndex]!
      const cached = this.#cache.has(descriptor.bucket)
      if (!cached && shardReads >= maxShardReads) {
        return {
          items,
          nextCursor: encodeCursor({ ...cursor, shard: shardIndex, offset }),
          complete: false,
          shardReads,
        }
      }

      const loaded = await this.#shard(descriptor)
      shardReads += loaded.shardReads
      if (offset > loaded.records.length) {
        throw new Error('D4 Current overlay cursor offset is out of range')
      }

      for (let index = offset; index < loaded.records.length; index += 1) {
        const entry = loaded.records[index]!
        if (entry.objectType !== type) continue
        if (!includeTombstones && entry.isTombstone) continue
        items.push(entry)
        if (items.length >= limit) {
          const nextOffset = index + 1
          const nextShard = nextOffset < loaded.records.length
            ? shardIndex
            : shardIndex + 1
          return {
            items,
            nextCursor: nextShard >= this.manifest.shards.length
              ? null
              : encodeCursor({
                  ...cursor,
                  shard: nextShard,
                  offset: nextShard === shardIndex ? nextOffset : 0,
                }),
            complete: nextShard >= this.manifest.shards.length,
            shardReads,
          }
        }
      }

      shardIndex += 1
      offset = 0
    }

    return {
      items,
      nextCursor: null,
      complete: true,
      shardReads,
    }
  }
}
