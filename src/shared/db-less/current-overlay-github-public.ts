import {
  encodeDbLessCurrentOverlayChannel,
  verifyDbLessCurrentOverlayChannel,
  type DbLessCurrentOverlayChannelV1,
} from './current-overlay-channel'
import type { DbLessCurrentOverlayCheckpointManifest } from './current-overlay-checkpoint'
import { DbLessCurrentOverlayReader } from './current-overlay-reader'
import {
  assertAllowedReleaseResponseOrigin,
  GithubReleaseAssetResolver,
} from '../current-state/http-release-artifact-store'
import { sha256Hex } from '../current-state/canonical-json'

const DEFAULT_MAX_MANIFEST_BYTES = 1_000_000
const DEFAULT_MAX_SHARD_BYTES = 2_000_000

interface GitHubRelease {
  id: number
  tag_name: string
  body: string | null
  draft: boolean
  prerelease: boolean
}

function githubApiReleaseUrl(repository: string, releaseTag: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository must be owner/name')
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(releaseTag)) {
    throw new Error('GitHub Release tag is invalid')
  }
  return `https://api.github.com/repos/${repository}/releases/tags/${encodeURIComponent(releaseTag)}`
}

function assertGitHubApiOrigin(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
    throw new Error('GitHub Release API response origin is invalid')
  }
}

async function boundedBytes(
  response: Response,
  maxBytes: number,
  field: string,
): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`${field} fetch failed with ${response.status}`)
  assertAllowedReleaseResponseOrigin(response.url)
  const length = response.headers.get('content-length')
  if (length !== null && Number(length) > maxBytes) {
    throw new Error(`${field} exceeds byte limit`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new Error(`${field} exceeds byte limit`)
  return bytes
}

function validateRelease(release: GitHubRelease, expectedTag: string): void {
  if (
    !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== expectedTag
    || release.draft
    || !release.prerelease
  ) {
    throw new Error('GitHub D4 channel Release response is invalid')
  }
}

function canonicalChannel(channel: DbLessCurrentOverlayChannelV1): string {
  return new TextDecoder().decode(encodeDbLessCurrentOverlayChannel(channel))
}

function assertManifestMatchesChannel(
  manifest: DbLessCurrentOverlayCheckpointManifest,
  channel: DbLessCurrentOverlayChannelV1,
): void {
  const active = channel.active
  if (
    manifest.network !== channel.network
    || manifest.epochId !== channel.epochId
    || manifest.baseIdentity !== active.baseIdentity
    || manifest.throughLedgerIndex !== active.throughLedgerIndex
    || manifest.throughLedgerHash !== active.throughLedgerHash
    || manifest.generationCount !== active.generationCount
    || manifest.entryCount !== active.entryCount
    || manifest.tombstoneCount !== active.tombstoneCount
    || manifest.bucketCount !== active.bucketCount
  ) {
    throw new Error('D4 Current overlay channel and manifest identity mismatch')
  }
}

export interface PublicCurrentOverlayOpenResult {
  channel: DbLessCurrentOverlayChannelV1
  manifest: DbLessCurrentOverlayCheckpointManifest
  reader: DbLessCurrentOverlayReader
}

export async function openPublicGithubCurrentOverlay(options: {
  repository: string
  channelReleaseTag: string
  fetcher?: typeof fetch
  maxManifestBytes?: number
  maxShardBytes?: number
}): Promise<PublicCurrentOverlayOpenResult> {
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const releaseResponse = await fetcher(
    githubApiReleaseUrl(options.repository, options.channelReleaseTag),
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!releaseResponse.ok) {
    throw new Error(`D4 channel Release fetch failed with ${releaseResponse.status}`)
  }
  assertGitHubApiOrigin(releaseResponse.url)
  const release = await releaseResponse.json() as GitHubRelease
  validateRelease(release, options.channelReleaseTag)
  if (release.body === null || !release.body.length) {
    throw new Error('D4 channel Release body is empty')
  }

  const channel = JSON.parse(release.body) as DbLessCurrentOverlayChannelV1
  await verifyDbLessCurrentOverlayChannel(channel)
  if (release.body !== canonicalChannel(channel)) {
    throw new Error('D4 channel Release body is not canonical')
  }
  if (channel.active.location.repository !== options.repository) {
    throw new Error('D4 channel points to a different repository')
  }

  const resolver = new GithubReleaseAssetResolver(
    channel.active.location.repository,
    channel.active.location.releaseTag,
  )
  const manifestResponse = await fetcher(
    resolver.urlFor(channel.active.manifestKey),
    { redirect: 'follow' },
  )
  const manifestBytes = await boundedBytes(
    manifestResponse,
    options.maxManifestBytes ?? DEFAULT_MAX_MANIFEST_BYTES,
    'D4 checkpoint manifest',
  )
  if (await sha256Hex(manifestBytes) !== channel.active.manifestSha256) {
    throw new Error('D4 checkpoint manifest digest mismatch')
  }
  const manifest = JSON.parse(
    new TextDecoder().decode(manifestBytes),
  ) as DbLessCurrentOverlayCheckpointManifest

  const descriptors = new Map(manifest.shards.map((shard) => [shard.key, shard]))
  const maxShardBytes = options.maxShardBytes ?? DEFAULT_MAX_SHARD_BYTES
  const reader = new DbLessCurrentOverlayReader({
    manifest,
    maxShardBytes,
    readArtifact: async (key) => {
      const descriptor = descriptors.get(key)
      if (!descriptor) return null
      const response = await fetcher(resolver.urlFor(key), { redirect: 'follow' })
      const bytes = await boundedBytes(response, maxShardBytes, `D4 shard ${key}`)
      if (bytes.byteLength !== descriptor.bytes) {
        throw new Error(`D4 shard size mismatch: ${key}`)
      }
      if (await sha256Hex(bytes) !== descriptor.artifactSha256) {
        throw new Error(`D4 shard digest mismatch: ${key}`)
      }
      return bytes
    },
  })
  assertManifestMatchesChannel(reader.manifest, channel)
  return { channel, manifest: reader.manifest, reader }
}
