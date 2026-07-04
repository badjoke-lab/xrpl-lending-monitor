import { sha256Hex } from './canonical-json'
import {
  GithubBranchAssetResolver,
  GithubReleaseAssetResolver,
  HttpReleaseArtifactStore,
  assertAllowedReleaseResponseOrigin,
  type ReleaseAssetResolver,
} from './http-release-artifact-store'
import {
  parseReleaseChannel,
  type CurrentStateReleaseChannel,
} from './release-format'
import {
  parseReleaseNativeManifest,
  releaseNativeManifestDigest,
  ReleaseNativeReader,
  type ReleaseNativeManifest,
} from './release-native-reader'

export interface OpenReleaseSnapshotReaderOptions {
  channelTag?: string
  githubRepository: string
  githubBranch?: string | null
  fetcher?: typeof fetch
  cache?: Cache
  timeoutMs?: number
  maxAssetBytes: number
  maxDecompressedBytes: number
}

export interface ReleaseSnapshotReader {
  channel: CurrentStateReleaseChannel
  manifest: ReleaseNativeManifest
  reader: ReleaseNativeReader
  rollback: CurrentStateReleaseChannel['rollback']
}

async function readBoundedResponse(response: Response, maxBytes: number, field: string): Promise<Uint8Array> {
  const length = response.headers.get('content-length')
  if (length !== null) {
    const parsed = Number(length)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxBytes) throw new Error(`${field} exceeds size limit`)
  }
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

async function fetchBytes(options: {
  fetcher: typeof fetch
  url: string
  timeoutMs: number
  expectedSha256?: string | null
  maxBytes: number
  field: string
}): Promise<Uint8Array> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetcher(options.url, {
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${options.field} fetch failed with ${response.status}`)
    assertAllowedReleaseResponseOrigin(response.url)
    const bytes = await readBoundedResponse(response, options.maxBytes, options.field)
    if (options.expectedSha256 && await sha256Hex(bytes) !== options.expectedSha256) {
      throw new Error(`${options.field} digest mismatch`)
    }
    return bytes
  } finally {
    clearTimeout(timeout)
  }
}

function resolvers(options: OpenReleaseSnapshotReaderOptions): {
  channel: ReleaseAssetResolver
  snapshot: (releaseTag: string) => ReleaseAssetResolver
} {
  if (options.githubBranch) {
    return {
      channel: new GithubBranchAssetResolver(options.githubRepository, options.githubBranch),
      snapshot: (releaseTag) => new GithubBranchAssetResolver(
        options.githubRepository,
        options.githubBranch as string,
        `snapshots/${releaseTag}`,
      ),
    }
  }
  return {
    channel: new GithubReleaseAssetResolver(
      options.githubRepository,
      options.channelTag ?? 'current-state-channel',
    ),
    snapshot: (releaseTag) => new GithubReleaseAssetResolver(options.githubRepository, releaseTag),
  }
}

export async function openReleaseSnapshotReader(
  options: OpenReleaseSnapshotReaderOptions,
): Promise<ReleaseSnapshotReader> {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? 8_000
  const sourceResolvers = resolvers(options)
  const channelBytes = await fetchBytes({
    fetcher,
    url: sourceResolvers.channel.urlFor('channel.json'),
    timeoutMs,
    maxBytes: 64 * 1024,
    field: 'Release channel',
  })
  const channel = parseReleaseChannel(JSON.parse(new TextDecoder().decode(channelBytes)))
  if (!channel.active) throw new Error('Current-state release channel has no active release')

  const resolver = sourceResolvers.snapshot(channel.active.releaseTag)
  const manifestBytes = await fetchBytes({
    fetcher,
    url: resolver.urlFor(channel.active.manifestAssetName),
    timeoutMs,
    maxBytes: Math.min(options.maxAssetBytes, 1024 * 1024),
    field: 'Release manifest',
  })
  const parsed = parseReleaseNativeManifest(JSON.parse(new TextDecoder().decode(manifestBytes)))
  const computed = await releaseNativeManifestDigest(parsed)
  if (computed !== parsed.manifestSha256 || parsed.manifestSha256 !== channel.active.manifestSha256) {
    throw new Error('Release manifest digest mismatch')
  }
  if (!parsed.complete || parsed.network !== 'devnet' || parsed.releaseTag !== channel.active.releaseTag) {
    throw new Error('Release manifest is not an active complete Devnet snapshot')
  }

  const store = new HttpReleaseArtifactStore({
    releaseTag: channel.active.releaseTag,
    manifest: parsed,
    resolver,
    fetcher,
    cache: options.cache,
    timeoutMs,
    maxAssetBytes: options.maxAssetBytes,
  })
  const reader = ReleaseNativeReader.openFromManifest({
    store,
    manifest: parsed,
    maxDecompressedBytes: options.maxDecompressedBytes,
  })
  return { channel, manifest: parsed, reader, rollback: channel.rollback }
}
