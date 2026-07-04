import { sha256Hex } from './canonical-json'
import type { ArtifactMetadata, ArtifactStore } from './artifact-metadata'
import type {
  ReleaseNativeDataAsset,
  ReleaseNativeIndexAsset,
  ReleaseNativeManifest,
} from './release-native-reader'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_IMMUTABLE_TTL_SECONDS = 31_536_000
const ALLOWED_RELEASE_RESPONSE_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
  'release-assets.githubusercontent.com',
])

type NativeAssetDescriptor = ReleaseNativeDataAsset | ReleaseNativeIndexAsset

export interface ReleaseAssetResolver {
  urlFor(assetName: string): string
}

export interface HttpReleaseArtifactStoreOptions {
  releaseTag: string
  manifest: ReleaseNativeManifest
  resolver: ReleaseAssetResolver
  fetcher?: typeof fetch
  cache?: Cache
  timeoutMs?: number
  maxAssetBytes: number
}

function flatAssetName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('Release asset name is invalid')
  return value
}

function repositoryName(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GitHub repository must be owner/name')
  }
  return value
}

function branchName(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) throw new Error('GitHub data branch is invalid')
  return value
}

function safePrefix(value: string): string {
  if (value === '') return ''
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(value)) throw new Error('GitHub data path prefix is invalid')
  return value
}

function descriptorMap(manifest: ReleaseNativeManifest): Map<string, NativeAssetDescriptor> {
  const map = new Map<string, NativeAssetDescriptor>()
  for (const descriptor of [...manifest.dataAssets, ...manifest.indexAssets]) {
    if (map.has(descriptor.assetName)) throw new Error(`Duplicate release asset name ${descriptor.assetName}`)
    map.set(descriptor.assetName, descriptor)
  }
  return map
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

export function assertAllowedReleaseResponseOrigin(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !ALLOWED_RELEASE_RESPONSE_HOSTS.has(url.hostname)) {
    throw new Error('Release asset response origin is not allowed')
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await promise
  } finally {
    clearTimeout(timeout)
  }
}

async function readBoundedResponse(response: Response, expectedBytes: number, field: string): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null) {
    const parsed = Number(length)
    if (!Number.isSafeInteger(parsed) || parsed !== expectedBytes) throw new Error(`${field} content length mismatch`)
  }
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== expectedBytes) throw new Error(`${field} size mismatch`)
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > expectedBytes) {
      await reader.cancel()
      throw new Error(`${field} size mismatch`)
    }
    chunks.push(value)
  }
  if (total !== expectedBytes) throw new Error(`${field} size mismatch`)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export class GithubReleaseAssetResolver implements ReleaseAssetResolver {
  readonly #repository: string
  readonly #releaseTag: string

  constructor(repository: string, releaseTag: string) {
    this.#repository = repositoryName(repository)
    if (releaseTag.length === 0) throw new Error('GitHub release tag is required')
    this.#releaseTag = encodeURIComponent(releaseTag)
  }

  urlFor(assetName: string): string {
    return `https://github.com/${this.#repository}/releases/download/${this.#releaseTag}/${encodeURIComponent(flatAssetName(assetName))}`
  }
}

export class GithubBranchAssetResolver implements ReleaseAssetResolver {
  readonly #repository: string
  readonly #branch: string
  readonly #prefix: string

  constructor(repository: string, branch: string, prefix = '') {
    this.#repository = repositoryName(repository)
    this.#branch = branchName(branch)
    this.#prefix = safePrefix(prefix)
  }

  urlFor(assetName: string): string {
    const suffix = encodeURIComponent(flatAssetName(assetName))
    const path = this.#prefix ? `${this.#prefix}/${suffix}` : suffix
    return `https://raw.githubusercontent.com/${this.#repository}/${this.#branch}/${path}`
  }
}

export class HttpReleaseArtifactStore implements ArtifactStore {
  readonly #releaseTag: string
  readonly #resolver: ReleaseAssetResolver
  readonly #fetcher: typeof fetch
  readonly #cache: Cache | undefined
  readonly #timeoutMs: number
  readonly #maxAssetBytes: number
  readonly #assets: Map<string, NativeAssetDescriptor>

  constructor(options: HttpReleaseArtifactStoreOptions) {
    if (!Number.isSafeInteger(options.maxAssetBytes) || options.maxAssetBytes < 1) {
      throw new Error('maxAssetBytes must be a positive safe integer')
    }
    this.#releaseTag = options.releaseTag
    this.#resolver = options.resolver
    this.#fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.#cache = options.cache
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#maxAssetBytes = options.maxAssetBytes
    this.#assets = descriptorMap(options.manifest)
  }

  write(_key: string, _bytes: Uint8Array, _sha256: string): Promise<void> {
    return Promise.reject(new Error('HTTP release artifacts are immutable and read-only at runtime'))
  }

  async read(key: string): Promise<Uint8Array | null> {
    const descriptor = this.#assets.get(key)
    if (!descriptor) return null
    if (descriptor.compressedBytes > this.#maxAssetBytes) {
      throw new Error(`Release asset ${key} exceeds the configured read limit`)
    }
    const cacheKey = new Request(
      `https://xrpl-lending-monitor.local/current-state-cache/${encodeURIComponent(this.#releaseTag)}/${descriptor.sha256}`,
    )
    if (this.#cache) {
      const cached = await this.#cache.match(cacheKey)
      if (cached) {
        try {
          const cachedBytes = await readBoundedResponse(cached, descriptor.compressedBytes, `Cached release asset ${key}`)
          if (await sha256Hex(cachedBytes) === descriptor.sha256) return cachedBytes
        } catch {
          // Treat an invalid cache entry as a miss. Verified origin bytes replace it below.
        }
      }
    }

    const controller = new AbortController()
    const response = await withTimeout(
      this.#fetcher(this.#resolver.urlFor(descriptor.assetName), {
        redirect: 'follow',
        signal: controller.signal,
      }),
      this.#timeoutMs,
      controller,
    )
    if (!response.ok) throw new Error(`Release asset fetch failed with ${response.status}`)
    assertAllowedReleaseResponseOrigin(response.url)
    const bytes = await readBoundedResponse(response, descriptor.compressedBytes, `Release asset ${key}`)
    if (await sha256Hex(bytes) !== descriptor.sha256) {
      throw new Error(`Release asset ${key} digest mismatch`)
    }
    if (this.#cache) {
      await this.#cache.put(cacheKey, new Response(arrayBuffer(bytes), {
        headers: {
          'cache-control': `public, max-age=${DEFAULT_IMMUTABLE_TTL_SECONDS}, immutable`,
          'content-length': String(bytes.byteLength),
          'x-content-sha256': descriptor.sha256,
        },
      }))
    }
    return bytes
  }

  async inspect(key: string): Promise<ArtifactMetadata | null> {
    const descriptor = this.#assets.get(key)
    return descriptor
      ? { key, size: descriptor.compressedBytes, sha256: descriptor.sha256 }
      : null
  }

  async enumerate(prefix: string): Promise<ArtifactMetadata[]> {
    return [...this.#assets.values()]
      .filter((descriptor) => descriptor.assetName.startsWith(prefix))
      .map((descriptor) => ({
        key: descriptor.assetName,
        size: descriptor.compressedBytes,
        sha256: descriptor.sha256,
      }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }
}
