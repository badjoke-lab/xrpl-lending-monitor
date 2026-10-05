import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import {
  assertDbLessBaseManifest,
  type DbLessBaseAssetDescriptorV1,
  type DbLessBaseManifestV1,
} from './base-manifest'
import { sha256Hex } from '../current-state/canonical-json'

export type DbLessBaseReadKind = 'vault' | 'loan-broker' | 'loan'

export type DbLessBasePageRecord =
  | VaultCurrentProjection
  | { broker: LoanBrokerCurrentProjection; vault: VaultCurrentProjection }
  | {
      loan: LoanCurrentProjection
      broker: LoanBrokerCurrentProjection
      vault: VaultCurrentProjection
    }

export type DbLessBaseArtifactReader = (key: string) => Promise<Uint8Array | null>

export interface DbLessBaseListOptions<T extends DbLessBasePageRecord> {
  limit: number
  cursor?: string
  direction?: 'asc' | 'desc'
  maxPageReads?: number
  scope?: string
  predicate?: (record: T) => boolean
}

export interface DbLessBaseListResult<T extends DbLessBasePageRecord> {
  items: T[]
  nextCursor: string | null
  pageReads: number
  objectsExamined: number
}

type LookupReference = {
  id: string
  kind: DbLessBaseReadKind
  page: number
  offset: number
}

type LookupBucket = {
  schemaVersion: 1
  prefix: string
  records: LookupReference[]
}

type PageBody = {
  schemaVersion: 1
  kind: DbLessBaseReadKind
  page: number
  records: DbLessBasePageRecord[]
}

type Cursor = {
  v: 1
  generationId: string
  kind: DbLessBaseReadKind
  direction: 'asc' | 'desc'
  scope: string
  page: number
  offset: number
}

const DEFAULT_MAX_PAGE_READS = 4
const DEFAULT_MAX_ASSET_BYTES = 2_000_000

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

function descriptorKind(kind: DbLessBaseReadKind): DbLessBaseAssetDescriptorV1['kind'] {
  if (kind === 'vault') return 'vault-page'
  if (kind === 'loan-broker') return 'loan-broker-page'
  return 'loan-page'
}

function pageCount(manifest: DbLessBaseManifestV1, kind: DbLessBaseReadKind): number {
  if (kind === 'vault') return manifest.pageCounts.vaults
  if (kind === 'loan-broker') return manifest.pageCounts.loanBrokers
  return manifest.pageCounts.loans
}

function pageKey(kind: DbLessBaseReadKind, page: number): string {
  return `${descriptorKind(kind)}-${String(page).padStart(6, '0')}.json.gz`
}

function recordId(kind: DbLessBaseReadKind, record: DbLessBasePageRecord): string {
  if (kind === 'vault') return (record as VaultCurrentProjection).id
  if (kind === 'loan-broker') {
    return (record as { broker: LoanBrokerCurrentProjection }).broker.id
  }
  return (record as { loan: LoanCurrentProjection }).loan.id
}

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(options: {
  value?: string
  generationId: string
  kind: DbLessBaseReadKind
  direction: 'asc' | 'desc'
  scope: string
  initialPage: number
}): Cursor {
  if (!options.value) {
    return {
      v: 1,
      generationId: options.generationId,
      kind: options.kind,
      direction: options.direction,
      scope: options.scope,
      page: options.initialPage,
      offset: 0,
    }
  }
  if (options.value.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(options.value)) {
    throw new Error('DB-less base cursor is invalid')
  }
  const bytes = new Uint8Array(options.value.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(options.value.slice(index * 2, index * 2 + 2), 16)
  }
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Partial<Cursor>
  if (
    parsed.v !== 1
    || parsed.generationId !== options.generationId
    || parsed.kind !== options.kind
    || parsed.direction !== options.direction
    || parsed.scope !== options.scope
  ) {
    throw new Error('DB-less base cursor does not match the query')
  }
  const page = Number(parsed.page)
  const offset = Number(parsed.offset)
  nonNegativeInteger(page, 'cursor.page')
  nonNegativeInteger(offset, 'cursor.offset')
  return {
    v: 1,
    generationId: options.generationId,
    kind: options.kind,
    direction: options.direction,
    scope: options.scope,
    page,
    offset,
  }
}

async function gunzipJson(bytes: Uint8Array): Promise<unknown> {
  const payload = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const stream = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text()) as unknown
}

function safeLookupPrefix(id: string, length: number): string {
  if (id.length < length) throw new Error('DB-less base object ID is shorter than lookup prefix')
  const prefix = id.slice(0, length).toUpperCase()
  if (!/^[A-F0-9]+$/.test(prefix)) {
    throw new Error('DB-less base object ID does not have a hexadecimal lookup prefix')
  }
  return prefix
}

export class DbLessCurrentBaseReader {
  readonly manifest: DbLessBaseManifestV1
  readonly #readArtifact: DbLessBaseArtifactReader
  readonly #maxAssetBytes: number
  readonly #descriptors: Map<string, DbLessBaseAssetDescriptorV1>
  readonly #cache = new Map<string, unknown>()

  constructor(options: {
    manifest: DbLessBaseManifestV1
    readArtifact: DbLessBaseArtifactReader
    maxAssetBytes?: number
  }) {
    assertDbLessBaseManifest(options.manifest)
    this.manifest = options.manifest
    this.#readArtifact = options.readArtifact
    this.#maxAssetBytes = positiveInteger(
      options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES,
      'maxAssetBytes',
    )
    this.#descriptors = new Map(
      options.manifest.assets.map((descriptor) => [descriptor.key, descriptor]),
    )
  }

  async #asset(key: string): Promise<unknown> {
    if (this.#cache.has(key)) return this.#cache.get(key)
    const descriptor = this.#descriptors.get(key)
    if (!descriptor) throw new Error(`DB-less base manifest does not contain ${key}`)
    if (descriptor.bytes > this.#maxAssetBytes) {
      throw new Error(`DB-less base asset exceeds byte limit: ${key}`)
    }
    const bytes = await this.#readArtifact(key)
    if (!bytes || bytes.byteLength !== descriptor.bytes) {
      throw new Error(`Missing or invalid DB-less base asset: ${key}`)
    }
    if (await sha256Hex(bytes) !== descriptor.sha256) {
      throw new Error(`DB-less base asset SHA-256 mismatch: ${key}`)
    }
    const value = await gunzipJson(bytes)
    if (this.#cache.size >= 4) {
      this.#cache.delete(this.#cache.keys().next().value as string)
    }
    this.#cache.set(key, value)
    return value
  }

  async #page<T extends DbLessBasePageRecord>(
    kind: DbLessBaseReadKind,
    page: number,
  ): Promise<T[]> {
    const value = await this.#asset(pageKey(kind, page)) as Partial<PageBody>
    if (
      value.schemaVersion !== 1
      || value.kind !== kind
      || value.page !== page
      || !Array.isArray(value.records)
    ) {
      throw new Error('DB-less base page identity mismatch')
    }
    return value.records as T[]
  }

  async get<T extends DbLessBasePageRecord>(
    kind: DbLessBaseReadKind,
    id: string,
  ): Promise<{ item: T | null; assetReads: number }> {
    const prefix = safeLookupPrefix(id, this.manifest.lookupPrefixLength)
    const lookupKey = `lookup-${prefix}.json.gz`
    const lookup = await this.#asset(lookupKey) as Partial<LookupBucket>
    if (
      lookup.schemaVersion !== 1
      || lookup.prefix !== prefix
      || !Array.isArray(lookup.records)
    ) {
      throw new Error('DB-less base lookup bucket identity mismatch')
    }
    const reference = lookup.records.find((entry) =>
      entry.id === id && entry.kind === kind)
    if (!reference) return { item: null, assetReads: 1 }
    nonNegativeInteger(reference.page, 'lookup.page')
    nonNegativeInteger(reference.offset, 'lookup.offset')
    const page = await this.#page<T>(kind, reference.page)
    const item = page[reference.offset]
    if (!item || recordId(kind, item) !== id) {
      throw new Error('DB-less base lookup reference does not match page record')
    }
    return { item, assetReads: 2 }
  }

  async list<T extends DbLessBasePageRecord>(
    kind: DbLessBaseReadKind,
    options: DbLessBaseListOptions<T>,
  ): Promise<DbLessBaseListResult<T>> {
    const limit = positiveInteger(options.limit, 'limit')
    if (limit > 100) throw new Error('limit must not exceed 100')
    const maxPageReads = positiveInteger(
      options.maxPageReads ?? DEFAULT_MAX_PAGE_READS,
      'maxPageReads',
    )
    const direction = options.direction ?? 'asc'
    const scope = options.scope ?? kind
    const count = pageCount(this.manifest, kind)
    if (count === 0) {
      return { items: [], nextCursor: null, pageReads: 0, objectsExamined: 0 }
    }
    const step = direction === 'asc' ? 1 : -1
    const initialPage = direction === 'asc' ? 0 : count - 1
    const cursor = decodeCursor({
      value: options.cursor,
      generationId: this.manifest.generationId,
      kind,
      direction,
      scope,
      initialPage,
    })
    if (cursor.page >= count) throw new Error('DB-less base cursor page is out of range')

    const predicate = options.predicate ?? (() => true)
    const items: T[] = []
    let pageReads = 0
    let objectsExamined = 0
    let pageNo = cursor.page
    let offset = cursor.offset

    while (pageNo >= 0 && pageNo < count && pageReads < maxPageReads) {
      const source = await this.#page<T>(kind, pageNo)
      pageReads += 1
      const records = direction === 'asc' ? source : [...source].reverse()
      if (offset > records.length) throw new Error('DB-less base cursor is beyond page')
      for (let index = offset; index < records.length; index += 1) {
        const item = records[index]!
        objectsExamined += 1
        if (!predicate(item)) continue
        items.push(item)
        if (items.length >= limit) {
          const pageDone = index + 1 >= records.length
          const nextPage = pageDone ? pageNo + step : pageNo
          const complete = nextPage < 0 || nextPage >= count
          return {
            items,
            nextCursor: complete
              ? null
              : encodeCursor({
                  v: 1,
                  generationId: this.manifest.generationId,
                  kind,
                  direction,
                  scope,
                  page: nextPage,
                  offset: pageDone ? 0 : index + 1,
                }),
            pageReads,
            objectsExamined,
          }
        }
      }
      pageNo += step
      offset = 0
    }

    const complete = pageNo < 0 || pageNo >= count
    return {
      items,
      nextCursor: complete
        ? null
        : encodeCursor({
            v: 1,
            generationId: this.manifest.generationId,
            kind,
            direction,
            scope,
            page: pageNo,
            offset: 0,
          }),
      pageReads,
      objectsExamined,
    }
  }
}
