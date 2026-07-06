import type { ArtifactMetadata, ArtifactStore } from '../current-state/artifact-metadata'
import { sha256Hex } from '../current-state/canonical-json'
import { assertAllowedReleaseResponseOrigin } from '../current-state/http-release-artifact-store'
import {
  assertHistorySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './publication'
import { HistorySegmentChainReader } from './reader'

export interface HistorySegmentChannel {
  schemaVersion: 1
  active: {
    dataCommitSha: string
    publicationPath: string
    publicationSha256: string
    chainId: string
    epochId: string
  }
  updatedAt: string
}

const MAX_CHANNEL_BYTES = 256 * 1024
const MAX_PUBLICATION_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_ASSET_BYTES = 32 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 8_000
const MAX_MEMORY_CACHE_ENTRIES = 8
const COMMIT_SHA = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be non-empty`)
  return value
}

function safePath(value: unknown, field: string): string {
  const path = text(value, field)
  if (
    path.startsWith('/')
    || path.includes('\\')
    || path.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !/^[A-Za-z0-9._/-]+$/.test(path)
  ) throw new Error(`${field} is unsafe`)
  return path
}

function repository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GitHub repository must be owner/name')
  }
  return value
}

function branch(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('GitHub branch is invalid')
  return value
}

function commitSha(value: unknown): string {
  const parsed = text(value, 'dataCommitSha')
  if (!COMMIT_SHA.test(parsed)) throw new Error('dataCommitSha must be a 40-character lowercase Git commit SHA')
  return parsed
}

function digest(value: unknown, field: string): string {
  const parsed = text(value, field)
  if (!SHA256.test(parsed)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
  return parsed
}

export function parseHistorySegmentChannel(value: unknown): HistorySegmentChannel {
  const source = record(value, 'channel')
  const active = record(source.active, 'channel.active')
  if (source.schemaVersion !== 1) throw new Error('History segment channel schema is invalid')
  return {
    schemaVersion: 1,
    active: {
      dataCommitSha: commitSha(active.dataCommitSha),
      publicationPath: safePath(active.publicationPath, 'channel.active.publicationPath'),
      publicationSha256: digest(active.publicationSha256, 'channel.active.publicationSha256'),
      chainId: text(active.chainId, 'channel.active.chainId'),
      epochId: text(active.epochId, 'channel.active.epochId'),
    },
    updatedAt: text(source.updatedAt, 'channel.updatedAt'),
  }
}

async function boundedResponse(response: Response, maxBytes: number, field: string): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`${field} fetch failed with ${response.status}`)
  assertAllowedReleaseResponseOrigin(response.url)
  const declared = response.headers.get('content-length')
  if (declared !== null && Number(declared) > maxBytes) throw new Error(`${field} exceeds size limit`)
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) throw new Error(`${field} exceeds size limit`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`${field} exceeds size limit`)
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

async function fetchBounded(options: {
  fetcher: typeof fetch
  url: string
  maxBytes: number
  timeoutMs: number
  field: string
}): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetcher(options.url, {
      redirect: 'follow',
      signal: controller.signal,
    })
    return await boundedResponse(response, options.maxBytes, options.field)
  } finally {
    clearTimeout(timeout)
  }
}

class GithubCommitHistoryArtifactStore implements ArtifactStore {
  readonly #repository: string
  readonly #commitSha: string
  readonly #fetcher: typeof fetch
  readonly #timeoutMs: number
  readonly #maxAssetBytes: number
  readonly #cache = new Map<string, Uint8Array>()

  constructor(options: {
    repository: string
    commitSha: string
    fetcher: typeof fetch
    timeoutMs: number
    maxAssetBytes: number
  }) {
    this.#repository = options.repository
    this.#commitSha = options.commitSha
    this.#fetcher = options.fetcher
    this.#timeoutMs = options.timeoutMs
    this.#maxAssetBytes = options.maxAssetBytes
  }

  write(): Promise<void> {
    return Promise.reject(new Error('GitHub history artifacts are immutable and read-only at runtime'))
  }

  async read(key: string): Promise<Uint8Array | null> {
    const path = safePath(key, 'artifact key')
    const cached = this.#cache.get(path)
    if (cached) return cached
    const url = `https://raw.githubusercontent.com/${this.#repository}/${this.#commitSha}/${path}`
    const bytes = await fetchBounded({
      fetcher: this.#fetcher,
      url,
      maxBytes: this.#maxAssetBytes,
      timeoutMs: this.#timeoutMs,
      field: `History artifact ${path}`,
    })
    if (this.#cache.size >= MAX_MEMORY_CACHE_ENTRIES) {
      this.#cache.delete(this.#cache.keys().next().value as string)
    }
    this.#cache.set(path, bytes)
    return bytes
  }

  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const bytes = await this.read(key)
    return bytes ? { key, size: bytes.byteLength, sha256: await sha256Hex(bytes) } : null
  }

  enumerate(): Promise<ArtifactMetadata[]> {
    return Promise.resolve([])
  }
}

export async function openGithubHistorySegmentChain(options: {
  githubRepository: string
  githubBranch: string
  channelPath?: string
  fetcher?: typeof fetch
  timeoutMs?: number
  maxAssetBytes?: number
}): Promise<{
  channel: HistorySegmentChannel
  publication: HistorySegmentChainPublication
  reader: HistorySegmentChainReader
}> {
  const repo = repository(options.githubRepository)
  const branchName = branch(options.githubBranch)
  const channelPath = safePath(options.channelPath ?? 'history-channel.json', 'channelPath')
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('timeoutMs must be positive')
  if (!Number.isSafeInteger(maxAssetBytes) || maxAssetBytes < 1) throw new Error('maxAssetBytes must be positive')

  const channelBytes = await fetchBounded({
    fetcher,
    url: `https://raw.githubusercontent.com/${repo}/${branchName}/${channelPath}`,
    maxBytes: MAX_CHANNEL_BYTES,
    timeoutMs,
    field: 'History segment channel',
  })
  const channel = parseHistorySegmentChannel(JSON.parse(new TextDecoder().decode(channelBytes)))
  const publicationBytes = await fetchBounded({
    fetcher,
    url: `https://raw.githubusercontent.com/${repo}/${channel.active.dataCommitSha}/${channel.active.publicationPath}`,
    maxBytes: MAX_PUBLICATION_BYTES,
    timeoutMs,
    field: 'History segment publication',
  })
  if (await sha256Hex(publicationBytes) !== channel.active.publicationSha256) {
    throw new Error('History segment channel publication digest mismatch')
  }
  const publication = JSON.parse(new TextDecoder().decode(publicationBytes)) as HistorySegmentChainPublication
  await assertHistorySegmentPublicationDigest(publication)
  if (
    publication.chainId !== channel.active.chainId
    || publication.epochId !== channel.active.epochId
  ) throw new Error('History segment channel and publication identity mismatch')

  const store = new GithubCommitHistoryArtifactStore({
    repository: repo,
    commitSha: channel.active.dataCommitSha,
    fetcher,
    timeoutMs,
    maxAssetBytes,
  })
  const reader = await HistorySegmentChainReader.open({ store, publication })
  return { channel, publication, reader }
}
