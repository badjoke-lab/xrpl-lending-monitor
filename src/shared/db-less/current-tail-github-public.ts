import {
  encodeDbLessChannel,
  verifyDbLessChannel,
  type DbLessArtifactLocationV1,
  type DbLessChannelV1,
  type DbLessLivePointerV1,
} from './channel'
import type { DbLessCurrentOverlayCheckpointManifest } from './current-overlay-checkpoint'
import {
  readDbLessCurrentOverlaySourceAfterCheckpoint,
  type DbLessCurrentOverlayIncrementalSourceV1,
} from './current-overlay-chain-compactor'
import {
  assertAllowedReleaseResponseOrigin,
  GithubReleaseAssetResolver,
} from '../current-state/http-release-artifact-store'

const DEFAULT_MAX_ARTIFACT_BYTES = 2_000_000
const DEFAULT_MAX_NEW_GENERATIONS = 256

interface GitHubRelease {
  id: number
  tag_name: string
  body: string | null
  draft: boolean
  prerelease: boolean
}

function repository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error('GitHub repository must be owner/name')
  }
  return value
}

function releaseTag(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new Error('GitHub Release tag is invalid')
  }
  return value
}

function assertApiOrigin(value: string): void {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'api.github.com') {
    throw new Error('GitHub Release API response origin is invalid')
  }
}

function canonicalChannel(channel: DbLessChannelV1): string {
  return new TextDecoder().decode(encodeDbLessChannel(channel))
}

function commitArtifactUrl(
  location: Extract<DbLessArtifactLocationV1, { provider: 'github-commit' }>,
  key: string,
): string {
  const path = key.split('/').map((part) => encodeURIComponent(part)).join('/')
  return `https://raw.githubusercontent.com/${location.repository}/${location.commitSha}/${path}`
}

function artifactUrl(location: DbLessArtifactLocationV1, key: string): string {
  if (location.provider === 'github-release') {
    return new GithubReleaseAssetResolver(
      location.repository,
      location.releaseTag,
    ).urlFor(key)
  }
  return commitArtifactUrl(location, key)
}

async function boundedArtifact(options: {
  repository: string
  location: DbLessArtifactLocationV1
  key: string
  fetcher: typeof fetch
  maxBytes: number
}): Promise<Uint8Array | null> {
  if (options.location.repository !== options.repository) {
    throw new Error('D3 artifact location points to a different repository')
  }
  const response = await options.fetcher(
    artifactUrl(options.location, options.key),
    { redirect: 'follow' },
  )
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`D3 public artifact fetch failed with ${response.status}`)
  }
  assertAllowedReleaseResponseOrigin(response.url)
  const length = response.headers.get('content-length')
  if (length !== null) {
    const parsed = Number(length)
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > options.maxBytes) {
      throw new Error('D3 public artifact content length exceeds the browser bound')
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > options.maxBytes) {
    throw new Error('D3 public artifact exceeds the browser byte bound')
  }
  return bytes
}

export async function openPublicGithubDbLessChannel(options: {
  repository: string
  releaseTag: string
  fetcher?: typeof fetch
}): Promise<DbLessChannelV1> {
  const repo = repository(options.repository)
  const tag = releaseTag(options.releaseTag)
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const response = await fetcher(
    `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
    { headers: { Accept: 'application/vnd.github+json' } },
  )
  if (!response.ok) {
    throw new Error(`D3 channel Release fetch failed with ${response.status}`)
  }
  assertApiOrigin(response.url)
  const release = await response.json() as GitHubRelease
  if (
    !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== tag
    || release.draft
    || !release.prerelease
    || release.body === null
    || release.body.length === 0
  ) {
    throw new Error('D3 channel Release metadata is invalid')
  }

  const channel = JSON.parse(release.body) as DbLessChannelV1
  await verifyDbLessChannel(channel)
  if (release.body !== canonicalChannel(channel)) {
    throw new Error('D3 channel Release body is not canonical')
  }
  if (channel.base.location.repository !== repo) {
    throw new Error('D3 channel base points to a different repository')
  }
  if (channel.live && channel.live.location.repository !== repo) {
    throw new Error('D3 channel live head points to a different repository')
  }
  return channel
}

export function createPublicGithubLocatedArtifactReader(options: {
  repository: string
  fetcher?: typeof fetch
  maxArtifactBytes?: number
}) {
  const repo = repository(options.repository)
  const fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  const maxBytes = options.maxArtifactBytes ?? DEFAULT_MAX_ARTIFACT_BYTES
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error('maxArtifactBytes must be a positive safe integer')
  }

  return async (location: DbLessArtifactLocationV1, key: string) =>
    boundedArtifact({
      repository: repo,
      location,
      key,
      fetcher,
      maxBytes,
    })
}

export interface PublicCurrentTailResult {
  channel: DbLessChannelV1
  source: DbLessCurrentOverlayIncrementalSourceV1
}

export async function readPublicCurrentTailAfterCheckpoint(options: {
  repository: string
  channelReleaseTag: string
  checkpoint: DbLessCurrentOverlayCheckpointManifest
  fetcher?: typeof fetch
  maxArtifactBytes?: number
  maxNewGenerations?: number
}): Promise<PublicCurrentTailResult> {
  const channel = await openPublicGithubDbLessChannel({
    repository: options.repository,
    releaseTag: options.channelReleaseTag,
    fetcher: options.fetcher,
  })
  const maxNewGenerations = options.maxNewGenerations ?? DEFAULT_MAX_NEW_GENERATIONS
  if (!Number.isSafeInteger(maxNewGenerations) || maxNewGenerations < 1) {
    throw new Error('maxNewGenerations must be a positive safe integer')
  }
  const readLocatedArtifact = createPublicGithubLocatedArtifactReader({
    repository: options.repository,
    fetcher: options.fetcher,
    maxArtifactBytes: options.maxArtifactBytes,
  })
  const readChainArtifact = (pointer: DbLessLivePointerV1) =>
    readLocatedArtifact(pointer.location, pointer.manifestKey)

  const source = await readDbLessCurrentOverlaySourceAfterCheckpoint({
    channel,
    checkpoint: options.checkpoint,
    readChainArtifact,
    readLocatedArtifact,
    maxNewGenerations,
  })
  return { channel, source }
}
