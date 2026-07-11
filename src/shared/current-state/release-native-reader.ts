import { decodeGzipNdjsonWithMetadata } from './artifact-reader-codec'
import type { ArtifactStore } from './artifact-metadata'
import { canonicalJson, sha256Hex, utf8 } from './canonical-json'
import type { SnapshotKind } from './snapshot-types'

export interface ReleaseNativeDataAsset {
  assetName: string
  segmentId: string
  sha256: string
  compressedBytes: number
  uncompressedBytes: number
  recordCount: number
  sourcePages: { first: number; last: number; count: number }
  firstObjectId: string | null
  lastObjectId: string | null
  counts: { vaults: number; loanBrokers: number; loans: number }
}

export interface ReleaseNativeIndexAsset {
  assetName: string
  bucket: number
  sha256: string
  compressedBytes: number
  uncompressedBytes: number
  recordCount: number
  firstTerm: string | null
  lastTerm: string | null
}

export interface ReleaseNativeManifest {
  schemaVersion: 2
  network: 'devnet'
  endpoint: string
  epochId: string
  snapshotId: string
  releaseTag: string
  ledgerIndex: number
  ledgerHash: string
  complete: boolean
  sourcePages: number
  decodedObjectCount: number
  relevantObjectCount: number
  counts: { vaults: number; loanBrokers: number; loans: number }
  layout: {
    pagesPerSegment: number
    indexBuckets: number
    dataSegmentCount: number
    hashFunction: 'sha256-first-u32-mod-bucket-count'
  }
  dataAssets: ReleaseNativeDataAsset[]
  indexAssets: ReleaseNativeIndexAsset[]
  totals: {
    dataCompressedBytes: number
    dataUncompressedBytes: number
    indexCompressedBytes: number
    indexUncompressedBytes: number
  }
  manifestSha256: string
}

export interface ReleaseNativeDataRecord {
  schemaVersion: 1
  segmentId: string
  sourcePage: number
  id: string
  kind: SnapshotKind
  valueSha256: string
  value: Record<string, unknown>
}

export interface ReleaseNativeObjectReference {
  segmentId: string
  assetName: string
  id: string
  kind: SnapshotKind
}

export type ReleaseNativeIndexRecord =
  | {
      schemaVersion: 1
      bucket: number
      term: string
      lookupKind: 'object-id'
      value: { reference: ReleaseNativeObjectReference }
    }
  | {
      schemaVersion: 1
      bucket: number
      term: string
      lookupKind: 'account'
      value: {
        field: 'Account' | 'Owner' | 'Borrower'
        reference: ReleaseNativeObjectReference
      }
    }
  | {
      schemaVersion: 1
      bucket: number
      term: string
      lookupKind: 'relationship'
      value: {
        relation: 'vault-loan-broker' | 'loan-broker-loan'
        source: { id: string; kind: 'vault' | 'loan-broker' }
        target: ReleaseNativeObjectReference
      }
    }

export interface ReleaseNativeReadOptions {
  limit?: number
  cursor?: string
  maxAssetReads?: number
}

export interface ReleaseNativeListOptions extends ReleaseNativeReadOptions {
  direction?: 'asc' | 'desc'
}

export interface ReleaseNativeReadResult<T> {
  items: T[]
  nextCursor: string | null
  complete: boolean
  assetReads: number
}

export interface ReleaseNativeLookupResult<T> {
  item: T | null
  complete: boolean
  assetReads: number
}

type Cursor = {
  v: 1
  snapshot: string
  mode: string
  term: string
  asset: number
  line: number
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 50
const DEFAULT_READS = 16
const DEFAULT_DECOMPRESSED = 16 * 1024 * 1024

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function integer(value: unknown, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) throw new Error(`${field} must be a safe integer`)
  return Number(value)
}

function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error(`${field} must be a SHA-256 digest`)
  return value
}

function flatName(value: unknown, field: string): string {
  const name = text(value, field)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`${field} must be a flat release asset name`)
  return name
}

function id(value: unknown, field: string): string {
  const normalized = text(value, field).toUpperCase()
  if (!/^[A-F0-9]{64}$/.test(normalized)) throw new Error(`${field} must be a 64-character object ID`)
  return normalized
}

function kind(value: unknown, field: string): SnapshotKind {
  if (value !== 'vault' && value !== 'loan-broker' && value !== 'loan') throw new Error(`${field} is invalid`)
  return value
}

function counts(value: unknown, field: string): { vaults: number; loanBrokers: number; loans: number } {
  const source = record(value, field)
  return {
    vaults: integer(source.vaults, `${field}.vaults`),
    loanBrokers: integer(source.loanBrokers, `${field}.loanBrokers`),
    loans: integer(source.loans, `${field}.loans`),
  }
}

function parseDataAsset(value: unknown, index: number): ReleaseNativeDataAsset {
  const source = record(value, `dataAssets[${index}]`)
  const pages = record(source.sourcePages, `dataAssets[${index}].sourcePages`)
  const parsedCounts = counts(source.counts, `dataAssets[${index}].counts`)
  const parsed: ReleaseNativeDataAsset = {
    assetName: flatName(source.assetName, `dataAssets[${index}].assetName`),
    segmentId: text(source.segmentId, `dataAssets[${index}].segmentId`),
    sha256: digest(source.sha256, `dataAssets[${index}].sha256`),
    compressedBytes: integer(source.compressedBytes, `dataAssets[${index}].compressedBytes`, 1),
    uncompressedBytes: integer(source.uncompressedBytes, `dataAssets[${index}].uncompressedBytes`),
    recordCount: integer(source.recordCount, `dataAssets[${index}].recordCount`),
    sourcePages: {
      first: integer(pages.first, `dataAssets[${index}].sourcePages.first`, 1),
      last: integer(pages.last, `dataAssets[${index}].sourcePages.last`, 1),
      count: integer(pages.count, `dataAssets[${index}].sourcePages.count`, 1),
    },
    firstObjectId: source.firstObjectId === null ? null : id(source.firstObjectId, `dataAssets[${index}].firstObjectId`),
    lastObjectId: source.lastObjectId === null ? null : id(source.lastObjectId, `dataAssets[${index}].lastObjectId`),
    counts: parsedCounts,
  }
  if (parsed.sourcePages.last - parsed.sourcePages.first + 1 !== parsed.sourcePages.count) throw new Error('Data source page range is inconsistent')
  if (parsedCounts.vaults + parsedCounts.loanBrokers + parsedCounts.loans !== parsed.recordCount) throw new Error('Data object counts are inconsistent')
  return parsed
}

function parseIndexAsset(value: unknown, index: number): ReleaseNativeIndexAsset {
  const source = record(value, `indexAssets[${index}]`)
  return {
    assetName: flatName(source.assetName, `indexAssets[${index}].assetName`),
    bucket: integer(source.bucket, `indexAssets[${index}].bucket`),
    sha256: digest(source.sha256, `indexAssets[${index}].sha256`),
    compressedBytes: integer(source.compressedBytes, `indexAssets[${index}].compressedBytes`, 1),
    uncompressedBytes: integer(source.uncompressedBytes, `indexAssets[${index}].uncompressedBytes`),
    recordCount: integer(source.recordCount, `indexAssets[${index}].recordCount`),
    firstTerm: source.firstTerm === null ? null : text(source.firstTerm, `indexAssets[${index}].firstTerm`),
    lastTerm: source.lastTerm === null ? null : text(source.lastTerm, `indexAssets[${index}].lastTerm`),
  }
}

export function parseReleaseNativeManifest(value: unknown): ReleaseNativeManifest {
  const source = record(value, 'manifest')
  if (source.schemaVersion !== 2 || source.network !== 'devnet' || source.layout === null) throw new Error('Release manifest schema is invalid')
  const layout = record(source.layout, 'layout')
  const totals = record(source.totals, 'totals')
  const dataAssets = Array.isArray(source.dataAssets) ? source.dataAssets.map(parseDataAsset) : []
  const indexAssets = Array.isArray(source.indexAssets) ? source.indexAssets.map(parseIndexAsset) : []
  const parsedCounts = counts(source.counts, 'counts')
  const parsed: ReleaseNativeManifest = {
    schemaVersion: 2,
    network: 'devnet',
    endpoint: text(source.endpoint, 'endpoint'),
    epochId: text(source.epochId, 'epochId'),
    snapshotId: text(source.snapshotId, 'snapshotId'),
    releaseTag: text(source.releaseTag, 'releaseTag'),
    ledgerIndex: integer(source.ledgerIndex, 'ledgerIndex', 1),
    ledgerHash: id(source.ledgerHash, 'ledgerHash'),
    complete: source.complete === true,
    sourcePages: integer(source.sourcePages, 'sourcePages', 1),
    decodedObjectCount: integer(source.decodedObjectCount, 'decodedObjectCount'),
    relevantObjectCount: integer(source.relevantObjectCount, 'relevantObjectCount'),
    counts: parsedCounts,
    layout: {
      pagesPerSegment: integer(layout.pagesPerSegment, 'layout.pagesPerSegment', 1),
      indexBuckets: integer(layout.indexBuckets, 'layout.indexBuckets', 1),
      dataSegmentCount: integer(layout.dataSegmentCount, 'layout.dataSegmentCount', 1),
      hashFunction: layout.hashFunction === 'sha256-first-u32-mod-bucket-count'
        ? 'sha256-first-u32-mod-bucket-count'
        : (() => { throw new Error('Unsupported release hash function') })(),
    },
    dataAssets,
    indexAssets,
    totals: {
      dataCompressedBytes: integer(totals.dataCompressedBytes, 'totals.dataCompressedBytes'),
      dataUncompressedBytes: integer(totals.dataUncompressedBytes, 'totals.dataUncompressedBytes'),
      indexCompressedBytes: integer(totals.indexCompressedBytes, 'totals.indexCompressedBytes'),
      indexUncompressedBytes: integer(totals.indexUncompressedBytes, 'totals.indexUncompressedBytes'),
    },
    manifestSha256: digest(source.manifestSha256, 'manifestSha256'),
  }
  if (dataAssets.length !== parsed.layout.dataSegmentCount || indexAssets.length !== parsed.layout.indexBuckets) throw new Error('Release asset counts are inconsistent')
  if (parsedCounts.vaults + parsedCounts.loanBrokers + parsedCounts.loans !== parsed.relevantObjectCount) throw new Error('Release object counts are inconsistent')
  const names = new Set([...dataAssets, ...indexAssets].map((asset) => asset.assetName))
  if (names.size !== dataAssets.length + indexAssets.length) throw new Error('Duplicate release asset name')
  indexAssets.forEach((asset, index) => { if (asset.bucket !== index) throw new Error('Release index buckets are not complete and ordered') })
  return parsed
}

export function releaseNativeManifestDigest(value: ReleaseNativeManifest): Promise<string> {
  return sha256Hex(`${canonicalJson({ ...value, manifestSha256: null })}\n`)
}

export async function releaseNativeBucket(term: string, bucketCount: number): Promise<number> {
  const value = await sha256Hex(utf8(term))
  return Number.parseInt(value.slice(0, 8), 16) % bucketCount
}

function encodeCursor(value: Cursor): string {
  return Array.from(utf8(canonicalJson(value)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(cursor: string | undefined, base: Omit<Cursor, 'v' | 'asset' | 'line'> & { asset: number }): Cursor {
  if (!cursor) return { v: 1, ...base, line: 0 }
  if (cursor.length % 2 || !/^[a-f0-9]+$/i.test(cursor)) throw new Error('Release cursor is invalid')
  const bytes = new Uint8Array(cursor.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(cursor.slice(index * 2, index * 2 + 2), 16)
  const parsed = record(JSON.parse(new TextDecoder().decode(bytes)) as unknown, 'cursor')
  if (parsed.v !== 1 || parsed.snapshot !== base.snapshot || parsed.mode !== base.mode || parsed.term !== base.term) throw new Error('Release cursor does not match the query')
  return { v: 1, snapshot: base.snapshot, mode: base.mode, term: base.term, asset: integer(parsed.asset, 'cursor.asset'), line: integer(parsed.line, 'cursor.line') }
}

function limits(options: ReleaseNativeReadOptions): { limit: number; maxAssetReads: number } {
  const limit = options.limit ?? DEFAULT_LIMIT
  const maxAssetReads = options.maxAssetReads ?? DEFAULT_READS
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error('Invalid result limit')
  if (!Number.isSafeInteger(maxAssetReads) || maxAssetReads < 1) throw new Error('Invalid asset read limit')
  return { limit, maxAssetReads }
}

function parseReference(value: unknown): ReleaseNativeObjectReference {
  const source = record(value, 'reference')
  return {
    segmentId: text(source.segmentId, 'reference.segmentId'),
    assetName: flatName(source.assetName, 'reference.assetName'),
    id: id(source.id, 'reference.id'),
    kind: kind(source.kind, 'reference.kind'),
  }
}

function parseData(value: unknown, asset: ReleaseNativeDataAsset): ReleaseNativeDataRecord {
  const source = record(value, 'data record')
  const parsed: ReleaseNativeDataRecord = {
    schemaVersion: source.schemaVersion === 1 ? 1 : (() => { throw new Error('Invalid data record schema') })(),
    segmentId: text(source.segmentId, 'data.segmentId'),
    sourcePage: integer(source.sourcePage, 'data.sourcePage', 1),
    id: id(source.id, 'data.id'),
    kind: kind(source.kind, 'data.kind'),
    valueSha256: digest(source.valueSha256, 'data.valueSha256'),
    value: record(source.value, 'data.value'),
  }
  if (parsed.segmentId !== asset.segmentId || parsed.sourcePage < asset.sourcePages.first || parsed.sourcePage > asset.sourcePages.last) throw new Error('Data record is in the wrong segment')
  return parsed
}

function parseIndex(value: unknown, asset: ReleaseNativeIndexAsset): ReleaseNativeIndexRecord {
  const source = record(value, 'index record')
  if (source.schemaVersion !== 1 || source.bucket !== asset.bucket) throw new Error('Invalid index record identity')
  const term = text(source.term, 'index.term')
  const body = record(source.value, 'index.value')
  if (source.lookupKind === 'object-id') return { schemaVersion: 1, bucket: asset.bucket, term, lookupKind: 'object-id', value: { reference: parseReference(body.reference) } }
  if (source.lookupKind === 'account') {
    if (body.field !== 'Account' && body.field !== 'Owner' && body.field !== 'Borrower') throw new Error('Invalid account field')
    return { schemaVersion: 1, bucket: asset.bucket, term, lookupKind: 'account', value: { field: body.field, reference: parseReference(body.reference) } }
  }
  if (source.lookupKind === 'relationship') {
    const relation = body.relation
    if (relation !== 'vault-loan-broker' && relation !== 'loan-broker-loan') throw new Error('Invalid relationship')
    const sourceRef = record(body.source, 'relationship.source')
    const sourceKind = sourceRef.kind
    if (sourceKind !== 'vault' && sourceKind !== 'loan-broker') throw new Error('Invalid relationship source kind')
    return { schemaVersion: 1, bucket: asset.bucket, term, lookupKind: 'relationship', value: { relation, source: { id: id(sourceRef.id, 'relationship.source.id'), kind: sourceKind }, target: parseReference(body.target) } }
  }
  throw new Error('Invalid lookup kind')
}

export class ReleaseNativeReader {
  readonly manifest: ReleaseNativeManifest
  readonly #store: ArtifactStore
  readonly #maxDecompressedBytes: number
  readonly #dataCache = new Map<string, ReleaseNativeDataRecord[]>()
  readonly #indexCache = new Map<number, ReleaseNativeIndexRecord[]>()

  private constructor(store: ArtifactStore, manifest: ReleaseNativeManifest, maxDecompressedBytes: number) {
    this.#store = store
    this.manifest = manifest
    this.#maxDecompressedBytes = maxDecompressedBytes
  }

  static openFromManifest(options: { store: ArtifactStore; manifest: ReleaseNativeManifest; maxDecompressedBytes?: number }): ReleaseNativeReader {
    return new ReleaseNativeReader(options.store, parseReleaseNativeManifest(options.manifest), options.maxDecompressedBytes ?? DEFAULT_DECOMPRESSED)
  }

  async #data(asset: ReleaseNativeDataAsset): Promise<{ records: ReleaseNativeDataRecord[]; reads: number }> {
    const cached = this.#dataCache.get(asset.assetName)
    if (cached) return { records: cached, reads: 0 }
    if (asset.uncompressedBytes > this.#maxDecompressedBytes) throw new Error('Data asset exceeds decompressed size limit')
    const bytes = await this.#store.read(asset.assetName)
    if (!bytes || bytes.byteLength !== asset.compressedBytes) throw new Error(`Missing or invalid data asset ${asset.assetName}`)
    const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: asset.sha256, expectedDecompressedBytes: asset.uncompressedBytes, maxDecompressedBytes: this.#maxDecompressedBytes })
    const records = decoded.records.map((entry) => parseData(entry, asset))
    if (records.length !== asset.recordCount) throw new Error('Data record count mismatch')
    for (const entry of records) if (await sha256Hex(canonicalJson(entry.value)) !== entry.valueSha256) throw new Error(`Data value digest mismatch for ${entry.id}`)
    if (this.#dataCache.size >= 4) this.#dataCache.delete(this.#dataCache.keys().next().value as string)
    this.#dataCache.set(asset.assetName, records)
    return { records, reads: 1 }
  }

  async #index(term: string): Promise<{ records: ReleaseNativeIndexRecord[]; reads: number }> {
    const bucket = await releaseNativeBucket(term, this.manifest.layout.indexBuckets)
    const cached = this.#indexCache.get(bucket)
    if (cached) return { records: cached.filter((entry) => entry.term === term), reads: 0 }
    const asset = this.manifest.indexAssets[bucket]
    if (!asset || asset.uncompressedBytes > this.#maxDecompressedBytes) throw new Error('Index bucket is unavailable or oversized')
    const bytes = await this.#store.read(asset.assetName)
    if (!bytes || bytes.byteLength !== asset.compressedBytes) throw new Error(`Missing or invalid index asset ${asset.assetName}`)
    const decoded = await decodeGzipNdjsonWithMetadata({ bytes, sha256: asset.sha256, expectedDecompressedBytes: asset.uncompressedBytes, maxDecompressedBytes: this.#maxDecompressedBytes })
    const records = decoded.records.map((entry) => parseIndex(entry, asset))
    if (records.length !== asset.recordCount) throw new Error('Index record count mismatch')
    this.#indexCache.set(bucket, records)
    return { records: records.filter((entry) => entry.term === term), reads: 1 }
  }

  async listObjects(kindValue: SnapshotKind, options: ReleaseNativeListOptions = {}, predicate: (record: ReleaseNativeDataRecord) => boolean = () => true): Promise<ReleaseNativeReadResult<ReleaseNativeDataRecord>> {
    const { limit, maxAssetReads } = limits(options)
    const direction = options.direction ?? 'asc'
    const step = direction === 'asc' ? 1 : -1
    const initial = direction === 'asc' ? 0 : this.manifest.dataAssets.length - 1
    const cursor = decodeCursor(options.cursor, { snapshot: this.manifest.snapshotId, mode: `list:${direction}`, term: kindValue, asset: initial })
    const items: ReleaseNativeDataRecord[] = []
    let reads = 0
    for (let assetIndex = cursor.asset; assetIndex >= 0 && assetIndex < this.manifest.dataAssets.length; assetIndex += step) {
      const asset = this.manifest.dataAssets[assetIndex]!
      const kindCount = kindValue === 'vault'
        ? asset.counts.vaults
        : kindValue === 'loan-broker'
          ? asset.counts.loanBrokers
          : asset.counts.loans
      if (kindCount === 0) continue
      const loaded = await this.#data(asset)
      if (reads + loaded.reads > maxAssetReads) return { items, nextCursor: encodeCursor({ ...cursor, asset: assetIndex, line: 0 }), complete: false, assetReads: reads }
      reads += loaded.reads
      const records = direction === 'asc' ? loaded.records : [...loaded.records].reverse()
      const first = assetIndex === cursor.asset ? cursor.line : 0
      if (first > records.length) throw new Error('Release cursor is beyond the asset')
      for (let line = first; line < records.length; line += 1) {
        const entry = records[line]!
        if (entry.kind !== kindValue || !predicate(entry)) continue
        items.push(entry)
        if (items.length === limit) {
          const assetDone = line + 1 === records.length
          const nextAsset = assetDone ? assetIndex + step : assetIndex
          const complete = nextAsset < 0 || nextAsset >= this.manifest.dataAssets.length
          return { items, nextCursor: complete ? null : encodeCursor({ v: 1, snapshot: this.manifest.snapshotId, mode: `list:${direction}`, term: kindValue, asset: nextAsset, line: assetDone ? 0 : line + 1 }), complete, assetReads: reads }
        }
      }
    }
    return { items, nextCursor: null, complete: true, assetReads: reads }
  }

  async #exact(term: string, mode: string, predicate: (entry: ReleaseNativeIndexRecord) => boolean, options: ReleaseNativeReadOptions): Promise<ReleaseNativeReadResult<ReleaseNativeIndexRecord>> {
    const { limit, maxAssetReads } = limits(options)
    const cursor = decodeCursor(options.cursor, { snapshot: this.manifest.snapshotId, mode, term, asset: 0 })
    const loaded = await this.#index(term)
    if (loaded.reads > maxAssetReads) return { items: [], nextCursor: options.cursor ?? null, complete: false, assetReads: 0 }
    const matches = loaded.records.filter(predicate)
    const items = matches.slice(cursor.line, cursor.line + limit)
    const nextLine = cursor.line + items.length
    const complete = nextLine >= matches.length
    return { items, nextCursor: complete ? null : encodeCursor({ v: 1, snapshot: this.manifest.snapshotId, mode, term, asset: 0, line: nextLine }), complete, assetReads: loaded.reads }
  }

  findAccounts(account: string, fields: readonly ('Account' | 'Owner' | 'Borrower')[], options: ReleaseNativeReadOptions = {}): Promise<ReleaseNativeReadResult<ReleaseNativeIndexRecord>> {
    return this.#exact(account, `account:${[...fields].sort().join(',')}`, (entry) => entry.lookupKind === 'account' && fields.includes(entry.value.field), options)
  }

  findRelationships(sourceId: string, relation: 'vault-loan-broker' | 'loan-broker-loan' | null = null, options: ReleaseNativeReadOptions = {}): Promise<ReleaseNativeReadResult<ReleaseNativeIndexRecord>> {
    const normalized = sourceId.toUpperCase()
    return this.#exact(normalized, `relationship:${relation ?? 'all'}`, (entry) => entry.lookupKind === 'relationship' && (relation === null || entry.value.relation === relation), options)
  }

  searchExact(term: string, options: ReleaseNativeReadOptions = {}): Promise<ReleaseNativeReadResult<ReleaseNativeIndexRecord>> {
    const normalized = /^[a-f0-9]{64}$/i.test(term) ? term.toUpperCase() : term
    return this.#exact(normalized, 'search-exact', (entry) => entry.lookupKind === 'object-id' || entry.lookupKind === 'account', options)
  }

  async getObject(objectId: string, options: { maxAssetReads?: number } = {}): Promise<ReleaseNativeLookupResult<ReleaseNativeDataRecord>> {
    const maxAssetReads = options.maxAssetReads ?? DEFAULT_READS
    const normalized = objectId.toUpperCase()
    const index = await this.#exact(normalized, 'object-id', (entry) => entry.lookupKind === 'object-id', { limit: 2, maxAssetReads })
    if (!index.complete) return { item: null, complete: false, assetReads: index.assetReads }
    if (!index.items.length) return { item: null, complete: true, assetReads: index.assetReads }
    if (index.items.length !== 1 || index.items[0]!.lookupKind !== 'object-id') throw new Error('Duplicate object index entry')
    const reference = index.items[0]!.value.reference
    const asset = this.manifest.dataAssets.find((candidate) => candidate.segmentId === reference.segmentId && candidate.assetName === reference.assetName)
    if (!asset) throw new Error('Referenced data segment is missing')
    const loaded = await this.#data(asset)
    if (index.assetReads + loaded.reads > maxAssetReads) return { item: null, complete: false, assetReads: index.assetReads }
    const matches = loaded.records.filter((entry) => entry.id === reference.id && entry.kind === reference.kind)
    if (matches.length !== 1) throw new Error('Referenced object is missing or duplicated')
    return { item: matches[0]!, complete: true, assetReads: index.assetReads + loaded.reads }
  }
}
