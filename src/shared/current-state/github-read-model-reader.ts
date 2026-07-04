import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import { sha256Hex } from './canonical-json'
import { assertAllowedReleaseResponseOrigin } from './http-release-artifact-store'

export type ReadModelKind = 'vault' | 'loan-broker' | 'loan'

export interface ReadModelBrokerRecord {
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
}

export interface ReadModelLoanRecord {
  loan: LoanCurrentProjection
  broker: LoanBrokerCurrentProjection
  vault: VaultCurrentProjection
}

export interface CurrentStateReadModelManifest {
  schemaVersion: 1
  snapshotId: string
  epochId: string
  releaseTag: string
  ledgerIndex: number
  ledgerHash: string
  complete: true
  pageSize: number
  lookupPrefixLength: number
  counts: { vaults: number; loanBrokers: number; loans: number }
  pageCounts: { vaults: number; loanBrokers: number; loans: number }
  manifestSha256: string
}

interface ReadModelChannel {
  schemaVersion: 1
  active: {
    dataCommitSha: string
    manifestPath: 'read-model/manifest.json'
    manifestSha256: string
    releaseTag: string
    snapshotId: string
  }
  updatedAt: string
}

interface ReadModelPage<T> {
  schemaVersion: 1
  kind: ReadModelKind
  page: number
  records: T[]
}

interface LookupReference {
  id: string
  kind: ReadModelKind
  page: number
  offset: number
}

interface LookupBucket {
  schemaVersion: 1
  prefix: string
  records: LookupReference[]
}

interface Cursor {
  v: 1
  snapshot: string
  kind: ReadModelKind
  direction: 'asc' | 'desc'
  scope: string
  page: number
  offset: number
}

export interface ReadModelListOptions<T> {
  limit: number
  cursor?: string
  direction: 'asc' | 'desc'
  scope: string
  maxPageReads?: number
  predicate?: (record: T) => boolean
}

export interface ReadModelListResult<T> {
  items: T[]
  nextCursor: string | null
  pageReads: number
  objectsExamined: number
}

const MAX_JSON_BYTES = 1024 * 1024
const DEFAULT_MAX_PAGE_READS = 4

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
  const parsed = text(value, field)
  if (!/^[a-f0-9]{64}$/.test(parsed)) throw new Error(`${field} must be a SHA-256 digest`)
  return parsed
}

function commitSha(value: unknown): string {
  const parsed = text(value, 'dataCommitSha')
  if (!/^[a-f0-9]{40}$/.test(parsed)) throw new Error('dataCommitSha must be a Git commit SHA')
  return parsed
}

function flatBranch(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('GitHub data branch is invalid')
  return value
}

function repository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) throw new Error('GitHub repository must be owner/name')
  return value
}

function parseChannel(value: unknown): ReadModelChannel {
  const source = record(value, 'channel')
  const active = record(source.active, 'channel.active')
  if (source.schemaVersion !== 1 || active.manifestPath !== 'read-model/manifest.json') throw new Error('Read-model channel schema is invalid')
  const channel: ReadModelChannel = {
    schemaVersion: 1,
    active: {
      dataCommitSha: commitSha(active.dataCommitSha),
      manifestPath: 'read-model/manifest.json',
      manifestSha256: digest(active.manifestSha256, 'channel.active.manifestSha256'),
      releaseTag: text(active.releaseTag, 'channel.active.releaseTag'),
      snapshotId: text(active.snapshotId, 'channel.active.snapshotId'),
    },
    updatedAt: text(source.updatedAt, 'channel.updatedAt'),
  }
  return channel
}

function parseManifest(value: unknown): CurrentStateReadModelManifest {
  const source = record(value, 'manifest')
  const counts = record(source.counts, 'manifest.counts')
  const pageCounts = record(source.pageCounts, 'manifest.pageCounts')
  if (source.schemaVersion !== 1 || source.complete !== true) throw new Error('Read-model manifest schema is invalid')
  return {
    schemaVersion: 1,
    snapshotId: text(source.snapshotId, 'manifest.snapshotId'),
    epochId: text(source.epochId, 'manifest.epochId'),
    releaseTag: text(source.releaseTag, 'manifest.releaseTag'),
    ledgerIndex: integer(source.ledgerIndex, 'manifest.ledgerIndex', 1),
    ledgerHash: text(source.ledgerHash, 'manifest.ledgerHash'),
    complete: true,
    pageSize: integer(source.pageSize, 'manifest.pageSize', 1),
    lookupPrefixLength: integer(source.lookupPrefixLength, 'manifest.lookupPrefixLength', 1),
    counts: {
      vaults: integer(counts.vaults, 'manifest.counts.vaults'),
      loanBrokers: integer(counts.loanBrokers, 'manifest.counts.loanBrokers'),
      loans: integer(counts.loans, 'manifest.counts.loans'),
    },
    pageCounts: {
      vaults: integer(pageCounts.vaults, 'manifest.pageCounts.vaults', 1),
      loanBrokers: integer(pageCounts.loanBrokers, 'manifest.pageCounts.loanBrokers', 1),
      loans: integer(pageCounts.loans, 'manifest.pageCounts.loans', 1),
    },
    manifestSha256: digest(source.manifestSha256, 'manifest.manifestSha256'),
  }
}

function pageCount(manifest: CurrentStateReadModelManifest, kind: ReadModelKind): number {
  if (kind === 'vault') return manifest.pageCounts.vaults
  if (kind === 'loan-broker') return manifest.pageCounts.loanBrokers
  return manifest.pageCounts.loans
}

function encodeCursor(value: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function decodeCursor(cursor: string | undefined, expected: Omit<Cursor, 'v' | 'page' | 'offset'>, initialPage: number): Cursor {
  if (!cursor) return { v: 1, ...expected, page: initialPage, offset: 0 }
  if (cursor.length % 2 !== 0 || !/^[a-f0-9]+$/i.test(cursor)) throw new Error('Read-model cursor is invalid')
  const bytes = new Uint8Array(cursor.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(cursor.slice(index * 2, index * 2 + 2), 16)
  const source = record(JSON.parse(new TextDecoder().decode(bytes)), 'cursor')
  if (
    source.v !== 1
    || source.snapshot !== expected.snapshot
    || source.kind !== expected.kind
    || source.direction !== expected.direction
    || source.scope !== expected.scope
  ) throw new Error('Read-model cursor does not match the query')
  return {
    v: 1,
    ...expected,
    page: integer(source.page, 'cursor.page'),
    offset: integer(source.offset, 'cursor.offset'),
  }
}

async function readJsonResponse(response: Response, maxBytes: number, field: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${field} fetch failed with ${response.status}`)
  assertAllowedReleaseResponseOrigin(response.url)
  const contentLength = response.headers.get('content-length')
  if (contentLength !== null && Number(contentLength) > maxBytes) throw new Error(`${field} exceeds size limit`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`${field} exceeds size limit`)
  return JSON.parse(new TextDecoder().decode(bytes))
}

async function readGzipJsonResponse(response: Response, field: string): Promise<unknown> {
  if (!response.ok) throw new Error(`${field} fetch failed with ${response.status}`)
  assertAllowedReleaseResponseOrigin(response.url)
  if (!response.body) throw new Error(`${field} response body is unavailable`)
  const stream = response.body.pipeThrough(new DecompressionStream('gzip'))
  return JSON.parse(await new Response(stream).text())
}

export class GithubCurrentStateReadModelReader {
  readonly manifest: CurrentStateReadModelManifest
  readonly updatedAt: string
  readonly #repository: string
  readonly #dataCommitSha: string
  readonly #fetcher: typeof fetch
  readonly #pageCache = new Map<string, unknown[]>()

  private constructor(options: {
    repository: string
    dataCommitSha: string
    manifest: CurrentStateReadModelManifest
    updatedAt: string
    fetcher: typeof fetch
  }) {
    this.#repository = options.repository
    this.#dataCommitSha = options.dataCommitSha
    this.manifest = options.manifest
    this.updatedAt = options.updatedAt
    this.#fetcher = options.fetcher
  }

  static async open(options: {
    githubRepository: string
    githubBranch: string
    fetcher?: typeof fetch
  }): Promise<GithubCurrentStateReadModelReader> {
    const repo = repository(options.githubRepository)
    const branch = flatBranch(options.githubBranch)
    const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    const channelUrl = `https://raw.githubusercontent.com/${repo}/${branch}/channel.json`
    const channel = parseChannel(await readJsonResponse(await fetcher(channelUrl), MAX_JSON_BYTES, 'Read-model channel'))
    const manifestUrl = `https://raw.githubusercontent.com/${repo}/${channel.active.dataCommitSha}/${channel.active.manifestPath}`
    const manifestResponse = await fetcher(manifestUrl)
    if (!manifestResponse.ok) throw new Error(`Read-model manifest fetch failed with ${manifestResponse.status}`)
    assertAllowedReleaseResponseOrigin(manifestResponse.url)
    const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer())
    if (manifestBytes.byteLength > MAX_JSON_BYTES) throw new Error('Read-model manifest exceeds size limit')
    if (await sha256Hex(manifestBytes) !== channel.active.manifestSha256) throw new Error('Read-model manifest digest mismatch')
    const manifest = parseManifest(JSON.parse(new TextDecoder().decode(manifestBytes)))
    if (
      manifest.manifestSha256 !== channel.active.manifestSha256
      || manifest.releaseTag !== channel.active.releaseTag
      || manifest.snapshotId !== channel.active.snapshotId
    ) throw new Error('Read-model channel and manifest identity mismatch')
    return new GithubCurrentStateReadModelReader({
      repository: repo,
      dataCommitSha: channel.active.dataCommitSha,
      manifest,
      updatedAt: channel.updatedAt,
      fetcher,
    })
  }

  #url(path: string): string {
    return `https://raw.githubusercontent.com/${this.#repository}/${this.#dataCommitSha}/${path}`
  }

  async #page<T>(kind: ReadModelKind, page: number): Promise<T[]> {
    const key = `${kind}:${page}`
    const cached = this.#pageCache.get(key)
    if (cached) return cached as T[]
    const path = `read-model/pages/${kind}/${String(page).padStart(8, '0')}.json.gz`
    const payload = record(await readGzipJsonResponse(await this.#fetcher(this.#url(path)), `Read-model page ${key}`), 'page')
    if (payload.schemaVersion !== 1 || payload.kind !== kind || payload.page !== page || !Array.isArray(payload.records)) {
      throw new Error(`Read-model page ${key} identity mismatch`)
    }
    if (this.#pageCache.size >= 4) this.#pageCache.delete(this.#pageCache.keys().next().value as string)
    this.#pageCache.set(key, payload.records)
    return payload.records as T[]
  }

  async list<T>(kind: ReadModelKind, options: ReadModelListOptions<T>): Promise<ReadModelListResult<T>> {
    if (!Number.isSafeInteger(options.limit) || options.limit < 1 || options.limit > 100) throw new Error('Invalid read-model result limit')
    const count = pageCount(this.manifest, kind)
    const direction = options.direction
    const step = direction === 'asc' ? 1 : -1
    const initialPage = direction === 'asc' ? 0 : count - 1
    const cursor = decodeCursor(options.cursor, {
      snapshot: this.manifest.snapshotId,
      kind,
      direction,
      scope: options.scope,
    }, initialPage)
    const predicate = options.predicate ?? (() => true)
    const maxPageReads = options.maxPageReads ?? DEFAULT_MAX_PAGE_READS
    const items: T[] = []
    let pageReads = 0
    let objectsExamined = 0

    for (let pageNo = cursor.page; pageNo >= 0 && pageNo < count && pageReads < maxPageReads; pageNo += step) {
      const source = await this.#page<T>(kind, pageNo)
      pageReads += 1
      const records = direction === 'asc' ? source : [...source].reverse()
      const start = pageNo === cursor.page ? cursor.offset : 0
      if (start > records.length) throw new Error('Read-model cursor is beyond the page')
      for (let offset = start; offset < records.length; offset += 1) {
        const item = records[offset]!
        objectsExamined += 1
        if (!predicate(item)) continue
        items.push(item)
        if (items.length >= options.limit) {
          const pageDone = offset + 1 >= records.length
          const nextPage = pageDone ? pageNo + step : pageNo
          const complete = nextPage < 0 || nextPage >= count
          return {
            items,
            nextCursor: complete ? null : encodeCursor({
              v: 1,
              snapshot: this.manifest.snapshotId,
              kind,
              direction,
              scope: options.scope,
              page: nextPage,
              offset: pageDone ? 0 : offset + 1,
            }),
            pageReads,
            objectsExamined,
          }
        }
      }
    }

    const nextPage = cursor.page + pageReads * step
    const complete = nextPage < 0 || nextPage >= count
    return {
      items,
      nextCursor: complete ? null : encodeCursor({
        v: 1,
        snapshot: this.manifest.snapshotId,
        kind,
        direction,
        scope: options.scope,
        page: nextPage,
        offset: 0,
      }),
      pageReads,
      objectsExamined,
    }
  }

  async get<T>(objectId: string, expectedKind: ReadModelKind): Promise<T | null> {
    const id = objectId.toUpperCase()
    if (!/^[A-F0-9]{64}$/.test(id)) return null
    const prefix = id.slice(0, this.manifest.lookupPrefixLength)
    const path = `read-model/lookup/${prefix}.json.gz`
    const payload = record(await readGzipJsonResponse(await this.#fetcher(this.#url(path)), `Lookup bucket ${prefix}`), 'lookup bucket') as unknown as LookupBucket
    if (payload.schemaVersion !== 1 || payload.prefix !== prefix || !Array.isArray(payload.records)) throw new Error('Lookup bucket identity mismatch')
    const reference = payload.records.find((entry) => entry.id === id)
    if (!reference) return null
    if (reference.kind !== expectedKind) throw new Error('Read-model object kind mismatch')
    const records = await this.#page<T>(expectedKind, reference.page)
    const item = records[reference.offset]
    if (!item) throw new Error('Read-model lookup offset is invalid')
    return item
  }
}
