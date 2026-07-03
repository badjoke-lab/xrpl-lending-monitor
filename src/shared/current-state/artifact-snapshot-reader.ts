import { canonicalJson, sha256Hex } from './canonical-json'
import type { ArtifactStore } from './artifact-metadata'
import {
  decodeArtifactReaderCursor,
  decodeGzipNdjson,
  encodeArtifactReaderCursor,
} from './artifact-reader-codec'
import type {
  AccountIndexValue,
  BoundedLookupResult,
  BoundedReadOptions,
  BoundedReadResult,
  ObjectReference,
  RelationshipIndexValue,
  SearchIndexValue,
  SnapshotIndexRecord,
  SnapshotRecord,
} from './artifact-reader-types'
import type {
  SnapshotCatalogDescriptor,
  SnapshotCatalogEntry,
  SnapshotCatalogKind,
  SnapshotCatalogValue,
} from './snapshot-catalog'
import type { SnapshotIndexDescriptor, SnapshotIndexKind } from './snapshot-index-types'
import type { SnapshotLevelManifest } from './snapshot-level-manifest'
import type { SnapshotIdentity, SnapshotKind, SnapshotShardDescriptor } from './snapshot-types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
const DEFAULT_MAX_SHARD_READS = 16

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertIdentity(expected: SnapshotIdentity, actual: unknown): void {
  if (!isRecord(actual)) throw new Error('Artifact identity is invalid')
  for (const field of ['network', 'epochId', 'snapshotId', 'ledgerIndex', 'ledgerHash'] as const) {
    if (actual[field] !== expected[field]) throw new Error(`Artifact identity mismatch for ${field}`)
  }
}

function readOptions(options: BoundedReadOptions): { limit: number; maxShardReads: number } {
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxShardReads = options.maxShardReads ?? DEFAULT_MAX_SHARD_READS
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_LIMIT}`)
  }
  if (!Number.isSafeInteger(maxShardReads) || maxShardReads < 1) {
    throw new Error('maxShardReads must be a positive safe integer')
  }
  return { limit, maxShardReads }
}

function termMatches(firstTerm: string, lastTerm: string, term: string): boolean {
  return compareText(firstTerm, term) <= 0 && compareText(term, lastTerm) <= 0
}

function parseSnapshotManifest(value: unknown): SnapshotLevelManifest {
  if (!isRecord(value) || value.schemaVersion !== 2 || !isRecord(value.identity)) {
    throw new Error('Snapshot manifest schema is invalid')
  }
  if (!Array.isArray(value.catalogs)) throw new Error('Snapshot manifest catalogs are invalid')
  return value as unknown as SnapshotLevelManifest
}

function parseCatalogEntry(value: unknown, catalogKind: SnapshotCatalogKind): SnapshotCatalogEntry {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.catalogKind !== catalogKind) {
    throw new Error('Snapshot catalog entry is invalid')
  }
  if (
    typeof value.firstTerm !== 'string'
    || typeof value.lastTerm !== 'string'
    || !isRecord(value.value)
    || typeof value.value.key !== 'string'
  ) {
    throw new Error('Snapshot catalog entry fields are invalid')
  }
  return value as unknown as SnapshotCatalogEntry
}

function parseIndexRecord<T>(value: unknown, indexKind: SnapshotIndexKind): SnapshotIndexRecord<T> {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.indexKind !== indexKind) {
    throw new Error('Snapshot index record is invalid')
  }
  if (typeof value.term !== 'string' || !('value' in value)) {
    throw new Error('Snapshot index record fields are invalid')
  }
  return value as unknown as SnapshotIndexRecord<T>
}

async function parseSnapshotRecord(
  value: unknown,
  identity: SnapshotIdentity,
): Promise<SnapshotRecord> {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.value)) {
    throw new Error('Snapshot data record is invalid')
  }
  if (
    (value.kind !== 'vault' && value.kind !== 'loan-broker' && value.kind !== 'loan')
    || typeof value.id !== 'string'
    || typeof value.valueSha256 !== 'string'
  ) {
    throw new Error('Snapshot data record fields are invalid')
  }
  assertIdentity(identity, value.identity)
  if (value.value.index !== value.id) throw new Error('Snapshot data record identifier mismatch')
  if (await sha256Hex(canonicalJson(value.value)) !== value.valueSha256) {
    throw new Error('Snapshot data record value digest mismatch')
  }
  return value as unknown as SnapshotRecord
}

function isDataDescriptor(value: SnapshotCatalogValue): value is SnapshotShardDescriptor {
  return 'kind' in value
}

function isIndexDescriptor(value: SnapshotCatalogValue): value is SnapshotIndexDescriptor {
  return 'indexKind' in value
}

export class SnapshotArtifactReader {
  readonly #store: ArtifactStore
  readonly manifest: SnapshotLevelManifest

  private constructor(store: ArtifactStore, manifest: SnapshotLevelManifest) {
    this.#store = store
    this.manifest = manifest
  }

  static async open(options: {
    store: ArtifactStore
    manifestKey: string
    manifestSha256: string
  }): Promise<SnapshotArtifactReader> {
    const bytes = await options.store.read(options.manifestKey)
    if (!bytes) throw new Error(`Missing snapshot manifest ${options.manifestKey}`)
    if (await sha256Hex(bytes) !== options.manifestSha256) {
      throw new Error('Snapshot manifest digest mismatch')
    }
    const manifest = parseSnapshotManifest(JSON.parse(new TextDecoder().decode(bytes)))
    return new SnapshotArtifactReader(options.store, manifest)
  }

  async #catalogValues(options: {
    catalogKind: SnapshotCatalogKind
    term: string
    maxShardReads: number
  }): Promise<{ values: SnapshotCatalogValue[]; shardReads: number }> {
    const descriptors: SnapshotCatalogDescriptor[] = this.manifest.catalogs
      .filter((descriptor) => (
        descriptor.catalogKind === options.catalogKind
        && termMatches(descriptor.firstTerm, descriptor.lastTerm, options.term)
      ))
      .sort((left, right) => compareText(left.key, right.key))
    if (descriptors.length > options.maxShardReads) {
      throw new Error(`Catalog query exceeds maxShardReads for ${options.catalogKind}`)
    }

    const values: SnapshotCatalogValue[] = []
    for (const descriptor of descriptors) {
      const bytes = await this.#store.read(descriptor.key)
      if (!bytes) throw new Error(`Missing snapshot catalog ${descriptor.key}`)
      const records = await decodeGzipNdjson({ bytes, sha256: descriptor.sha256 })
      for (const record of records) {
        const entry = parseCatalogEntry(record, options.catalogKind)
        if (termMatches(entry.firstTerm, entry.lastTerm, options.term)) values.push(entry.value)
      }
    }
    return { values, shardReads: descriptors.length }
  }

  async #readDataShard(descriptor: SnapshotShardDescriptor): Promise<SnapshotRecord[]> {
    const bytes = await this.#store.read(descriptor.key)
    if (!bytes) throw new Error(`Missing snapshot data shard ${descriptor.key}`)
    const records = await decodeGzipNdjson({ bytes, sha256: descriptor.sha256 })
    const parsed: SnapshotRecord[] = []
    for (const record of records) parsed.push(await parseSnapshotRecord(record, this.manifest.identity))
    return parsed
  }

  async #readIndexShard<T>(
    descriptor: SnapshotIndexDescriptor,
    indexKind: SnapshotIndexKind,
  ): Promise<Array<SnapshotIndexRecord<T>>> {
    const bytes = await this.#store.read(descriptor.key)
    if (!bytes) throw new Error(`Missing snapshot index shard ${descriptor.key}`)
    const records = await decodeGzipNdjson({ bytes, sha256: descriptor.sha256 })
    return records.map((record) => parseIndexRecord<T>(record, indexKind))
  }

  async listObjects(
    kind: SnapshotKind,
    options: BoundedReadOptions = {},
  ): Promise<BoundedReadResult<SnapshotRecord>> {
    const { limit, maxShardReads } = readOptions(options)
    const catalog = await this.#catalogValues({ catalogKind: 'data', term: kind, maxShardReads })
    const descriptors = catalog.values.filter(isDataDescriptor)
      .filter((descriptor) => descriptor.kind === kind)
      .sort((left, right) => compareText(left.key, right.key))
    const cursor = decodeArtifactReaderCursor({ cursor: options.cursor, mode: 'list', term: kind })
    if (cursor.descriptorIndex > descriptors.length) throw new Error('Reader cursor is beyond the data catalog')

    const items: SnapshotRecord[] = []
    let shardReads = catalog.shardReads
    for (let descriptorIndex = cursor.descriptorIndex; descriptorIndex < descriptors.length; descriptorIndex += 1) {
      if (shardReads >= maxShardReads) {
        return {
          items,
          nextCursor: encodeArtifactReaderCursor({
            schemaVersion: 1,
            mode: 'list',
            term: kind,
            descriptorIndex,
            lineIndex: 0,
          }),
          complete: false,
          shardReads,
        }
      }
      const records = await this.#readDataShard(descriptors[descriptorIndex]!)
      shardReads += 1
      const firstLine = descriptorIndex === cursor.descriptorIndex ? cursor.lineIndex : 0
      if (firstLine > records.length) throw new Error('Reader cursor is beyond the data shard')
      for (let lineIndex = firstLine; lineIndex < records.length; lineIndex += 1) {
        const record = records[lineIndex]!
        if (record.kind !== kind) throw new Error('Data catalog kind mismatch')
        items.push(record)
        if (items.length === limit) {
          const atShardEnd = lineIndex + 1 >= records.length
          const nextDescriptor = atShardEnd ? descriptorIndex + 1 : descriptorIndex
          const nextLine = atShardEnd ? 0 : lineIndex + 1
          const complete = nextDescriptor >= descriptors.length
          return {
            items,
            nextCursor: complete ? null : encodeArtifactReaderCursor({
              schemaVersion: 1,
              mode: 'list',
              term: kind,
              descriptorIndex: nextDescriptor,
              lineIndex: nextLine,
            }),
            complete,
            shardReads,
          }
        }
      }
    }
    return { items, nextCursor: null, complete: true, shardReads }
  }

  async #exactIndex<T>(
    indexKind: SnapshotIndexKind,
    term: string,
    options: BoundedReadOptions,
    dedupeValues = false,
  ): Promise<BoundedReadResult<T>> {
    const { limit, maxShardReads } = readOptions(options)
    const catalog = await this.#catalogValues({ catalogKind: indexKind, term, maxShardReads })
    const descriptors = catalog.values.filter(isIndexDescriptor)
      .filter((descriptor) => descriptor.indexKind === indexKind && termMatches(
        descriptor.firstTerm,
        descriptor.lastTerm,
        term,
      ))
      .sort((left, right) => compareText(left.key, right.key))
    const cursor = decodeArtifactReaderCursor({ cursor: options.cursor, mode: indexKind, term })
    if (cursor.descriptorIndex > descriptors.length) throw new Error('Reader cursor is beyond the index catalog')

    const items: T[] = []
    const seenValues = new Set<string>()
    let shardReads = catalog.shardReads
    for (let descriptorIndex = cursor.descriptorIndex; descriptorIndex < descriptors.length; descriptorIndex += 1) {
      if (shardReads >= maxShardReads) {
        return {
          items,
          nextCursor: encodeArtifactReaderCursor({
            schemaVersion: 1,
            mode: indexKind,
            term,
            descriptorIndex,
            lineIndex: 0,
          }),
          complete: false,
          shardReads,
        }
      }
      const records = await this.#readIndexShard<T>(descriptors[descriptorIndex]!, indexKind)
      shardReads += 1
      const firstLine = descriptorIndex === cursor.descriptorIndex ? cursor.lineIndex : 0
      if (firstLine > records.length) throw new Error('Reader cursor is beyond the index shard')
      for (let lineIndex = firstLine; lineIndex < records.length; lineIndex += 1) {
        const record = records[lineIndex]!
        if (record.term !== term) continue
        if (dedupeValues) {
          const key = canonicalJson(record.value)
          if (seenValues.has(key)) continue
          seenValues.add(key)
        }
        items.push(record.value)
        if (items.length === limit) {
          const atShardEnd = lineIndex + 1 >= records.length
          const nextDescriptor = atShardEnd ? descriptorIndex + 1 : descriptorIndex
          const nextLine = atShardEnd ? 0 : lineIndex + 1
          const complete = nextDescriptor >= descriptors.length
          return {
            items,
            nextCursor: complete ? null : encodeArtifactReaderCursor({
              schemaVersion: 1,
              mode: indexKind,
              term,
              descriptorIndex: nextDescriptor,
              lineIndex: nextLine,
            }),
            complete,
            shardReads,
          }
        }
      }
    }
    return { items, nextCursor: null, complete: true, shardReads }
  }

  findAccount(
    account: string,
    options: BoundedReadOptions = {},
  ): Promise<BoundedReadResult<AccountIndexValue>> {
    return this.#exactIndex<AccountIndexValue>('account', account, options)
  }

  findRelationships(
    sourceId: string,
    options: BoundedReadOptions = {},
  ): Promise<BoundedReadResult<RelationshipIndexValue>> {
    return this.#exactIndex<RelationshipIndexValue>('relationship', sourceId, options)
  }

  searchExact(
    term: string,
    options: BoundedReadOptions = {},
  ): Promise<BoundedReadResult<SearchIndexValue>> {
    return this.#exactIndex<SearchIndexValue>('search', term, options, true)
  }

  async #objectFromReference(
    reference: ObjectReference,
    maxShardReads: number,
  ): Promise<BoundedLookupResult<SnapshotRecord>> {
    const catalog = await this.#catalogValues({
      catalogKind: 'data',
      term: reference.kind,
      maxShardReads,
    })
    const descriptor = catalog.values.filter(isDataDescriptor).find((candidate) => (
      candidate.kind === reference.kind && candidate.key === reference.dataKey
    ))
    if (!descriptor) throw new Error(`Missing data descriptor ${reference.dataKey}`)
    if (catalog.shardReads >= maxShardReads) {
      return { item: null, complete: false, shardReads: catalog.shardReads }
    }
    const records = await this.#readDataShard(descriptor)
    const matches = records.filter((record) => record.id === reference.id && record.kind === reference.kind)
    if (matches.length > 1) throw new Error(`Duplicate snapshot object ${reference.id}`)
    if (matches.length === 0) throw new Error(`Missing snapshot object ${reference.id}`)
    return { item: matches[0]!, complete: true, shardReads: catalog.shardReads + 1 }
  }

  async getObject(
    id: string,
    options: { maxShardReads?: number } = {},
  ): Promise<BoundedLookupResult<SnapshotRecord>> {
    const maxShardReads = options.maxShardReads ?? DEFAULT_MAX_SHARD_READS
    if (!Number.isSafeInteger(maxShardReads) || maxShardReads < 1) {
      throw new Error('maxShardReads must be a positive safe integer')
    }
    const references = await this.#exactIndex<ObjectReference>('object-id', id, {
      limit: 2,
      maxShardReads,
    })
    if (!references.complete) {
      return { item: null, complete: false, shardReads: references.shardReads }
    }
    if (references.items.length === 0) {
      return { item: null, complete: true, shardReads: references.shardReads }
    }
    if (references.items.length > 1) throw new Error(`Duplicate object-id index entry ${id}`)
    const remaining = maxShardReads - references.shardReads
    if (remaining < 1) {
      return { item: null, complete: false, shardReads: references.shardReads }
    }
    const resolved = await this.#objectFromReference(references.items[0]!, remaining)
    return {
      item: resolved.item,
      complete: resolved.complete,
      shardReads: references.shardReads + resolved.shardReads,
    }
  }
}
