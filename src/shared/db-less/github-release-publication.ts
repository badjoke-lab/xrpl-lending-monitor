import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import {
  verifyDbLessChannel,
  type DbLessChannelV1,
} from './channel'
import type { DbLessArtifact } from './live-delta'
import type {
  DbLessArtifactMetadata,
  DbLessChannelPublisher,
  DbLessChannelRead,
  DbLessImmutableArtifactWriter,
} from './publication'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const RELEASE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type GitHubFetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

interface GitHubReleaseAsset {
  id: number
  name: string
  size: number
  digest?: string | null
}

interface GitHubRelease {
  id: number
  tag_name: string
  body: string | null
  draft: boolean
  prerelease: boolean
}

function assertRepository(value: string): void {
  if (!REPOSITORY.test(value)) throw new Error('GitHub repository must be owner/repository')
}

function assertReleaseTag(value: string): void {
  if (!RELEASE_TAG.test(value)) throw new Error('GitHub Release tag is invalid')
}

function assertAssetName(value: string): void {
  if (!ASSET_NAME.test(value)) {
    throw new Error('GitHub Release asset name must be flat and release-safe')
  }
}

function apiHeaders(token: string, accept = 'application/vnd.github+json'): HeadersInit {
  return {
    Accept: accept,
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

async function jsonResponse<T>(response: Response, field: string): Promise<T> {
  if (!response.ok) {
    throw new Error(`${field} failed with GitHub HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function releaseRevision(release: GitHubRelease, channel: DbLessChannelV1): string {
  return `release:${release.id}:channel:${channel.channelSha256}`
}

function canonicalChannelBody(channel: DbLessChannelV1): string {
  return `${canonicalJson(channel)}\n`
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class GitHubReleaseDbLessStore
implements DbLessImmutableArtifactWriter, DbLessChannelPublisher {
  readonly #repository: string
  readonly #releaseTag: string
  readonly #token: string
  readonly #fetcher: GitHubFetchLike
  readonly #maxAssets: number
  readonly #uploadRetryDelaysMs: readonly number[]
  readonly #downloadRetryDelaysMs: readonly number[]
  readonly #uploadPacingMs: number
  readonly #sleep: (ms: number) => Promise<void>
  #releaseCache: GitHubRelease | null = null
  #assetsCache: { releaseId: number; assets: GitHubReleaseAsset[] } | null = null

  constructor(options: {
    repository: string
    releaseTag: string
    token: string
    fetcher?: GitHubFetchLike
    maxAssets?: number
    uploadRetryDelaysMs?: readonly number[]
    downloadRetryDelaysMs?: readonly number[]
    uploadPacingMs?: number
    sleep?: (ms: number) => Promise<void>
  }) {
    assertRepository(options.repository)
    assertReleaseTag(options.releaseTag)
    if (!options.token.length) throw new Error('GitHub token must be non-empty')
    const maxAssets = options.maxAssets ?? 900
    if (!Number.isSafeInteger(maxAssets) || maxAssets < 1 || maxAssets > 1_000) {
      throw new Error('maxAssets must be an integer from 1 through 1000')
    }

    this.#repository = options.repository
    this.#releaseTag = options.releaseTag
    this.#token = options.token
    const uploadRetryDelaysMs = options.uploadRetryDelaysMs ?? [5_000, 15_000, 30_000, 60_000, 120_000, 180_000]
    if (
      uploadRetryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
    ) {
      throw new Error('uploadRetryDelaysMs must contain non-negative safe integers')
    }
    const downloadRetryDelaysMs = options.downloadRetryDelaysMs ?? [2_000, 5_000, 15_000, 30_000]
    if (
      downloadRetryDelaysMs.some((delay) => !Number.isSafeInteger(delay) || delay < 0)
    ) {
      throw new Error('downloadRetryDelaysMs must contain non-negative safe integers')
    }
    const uploadPacingMs = options.uploadPacingMs ?? 1_000
    if (!Number.isSafeInteger(uploadPacingMs) || uploadPacingMs < 0) {
      throw new Error('uploadPacingMs must be a non-negative safe integer')
    }

    this.#fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.#maxAssets = maxAssets
    this.#uploadRetryDelaysMs = [...uploadRetryDelaysMs]
    this.#downloadRetryDelaysMs = [...downloadRetryDelaysMs]
    this.#uploadPacingMs = uploadPacingMs
    this.#sleep = options.sleep ?? defaultSleep
  }

  async #release(fresh = false): Promise<GitHubRelease> {
    if (!fresh && this.#releaseCache) return this.#releaseCache

    const response = await this.#fetcher(
      `https://api.github.com/repos/${this.#repository}/releases/tags/${encodeURIComponent(this.#releaseTag)}`,
      { headers: apiHeaders(this.#token) },
    )
    const release = await jsonResponse<GitHubRelease>(response, 'GitHub Release read')
    if (
      !Number.isSafeInteger(release.id)
      || release.id < 1
      || release.tag_name !== this.#releaseTag
      || typeof release.draft !== 'boolean'
      || typeof release.prerelease !== 'boolean'
    ) {
      throw new Error('GitHub Release response is invalid')
    }

    if (this.#releaseCache && this.#releaseCache.id !== release.id) {
      this.#assetsCache = null
    }
    this.#releaseCache = release
    return release
  }

  async #assets(releaseId: number, fresh = false): Promise<GitHubReleaseAsset[]> {
    if (
      !fresh
      && this.#assetsCache
      && this.#assetsCache.releaseId === releaseId
    ) {
      return this.#assetsCache.assets
    }

    const assets: GitHubReleaseAsset[] = []
    for (let page = 1; page <= 10; page += 1) {
      const response = await this.#fetcher(
        `https://api.github.com/repos/${this.#repository}/releases/${releaseId}/assets?per_page=100&page=${page}`,
        { headers: apiHeaders(this.#token) },
      )
      const values = await jsonResponse<GitHubReleaseAsset[]>(response, 'GitHub Release asset list')
      for (const asset of values) {
        if (
          !Number.isSafeInteger(asset.id)
          || asset.id < 1
          || typeof asset.name !== 'string'
          || !Number.isSafeInteger(asset.size)
          || asset.size < 0
          || (
            asset.digest !== undefined
            && asset.digest !== null
            && typeof asset.digest !== 'string'
          )
        ) {
          throw new Error('GitHub Release asset response is invalid')
        }
        assets.push(asset)
      }
      if (values.length < 100) {
        this.#assetsCache = { releaseId, assets }
        return assets
      }
    }
    throw new Error('GitHub Release asset pagination exceeded 1000 assets')
  }

  #cacheUploadedAsset(releaseId: number, asset: GitHubReleaseAsset): void {
    if (!this.#assetsCache || this.#assetsCache.releaseId !== releaseId) return
    const matches = this.#assetsCache.assets.filter((value) => value.name === asset.name)
    if (matches.length > 0) {
      throw new Error(`Duplicate GitHub Release asset name: ${asset.name}`)
    }
    this.#assetsCache.assets.push(asset)
  }

  async #downloadAsset(asset: GitHubReleaseAsset): Promise<Uint8Array> {
    let attempt = 0
    while (true) {
      const response = await this.#fetcher(
        `https://api.github.com/repos/${this.#repository}/releases/assets/${asset.id}`,
        {
          headers: apiHeaders(this.#token, 'application/octet-stream'),
          redirect: 'follow',
        },
      )
      if (response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== asset.size) {
          throw new Error(`GitHub Release asset byte mismatch for ${asset.name}`)
        }
        return bytes
      }

      if (attempt >= this.#downloadRetryDelaysMs.length) {
        throw new Error(
          `GitHub Release asset download failed after bounded retries with HTTP ${response.status}`,
        )
      }
      const delay = this.#downloadRetryDelaysMs[attempt]!
      attempt += 1
      if (delay > 0) await this.#sleep(delay)
    }
  }

  async readImmutable(key: string): Promise<Uint8Array | null> {
    assertAssetName(key)
    const release = await this.#release()
    if (release.draft) {
      throw new Error('GitHub Release DB-less artifacts must not be read from a draft')
    }
    const assets = await this.#assets(release.id)
    const matches = assets.filter((asset) => asset.name === key)
    if (matches.length > 1) {
      throw new Error(`Duplicate GitHub Release asset name: ${key}`)
    }
    const asset = matches[0]
    if (!asset) return null
    return this.#downloadAsset(asset)
  }

  async inspect(key: string): Promise<DbLessArtifactMetadata | null> {
    const bytes = await this.readImmutable(key)
    if (!bytes) return null
    return {
      key,
      bytes: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    }
  }

  async writeImmutable(artifact: DbLessArtifact): Promise<void> {
    assertAssetName(artifact.key)
    if (artifact.immutable !== true) {
      throw new Error('GitHub Release DB-less artifacts must be immutable')
    }
    const release = await this.#release()
    if (release.draft) {
      throw new Error('GitHub Release DB-less live store must not be a draft')
    }
    const expectedDigest = `sha256:${artifact.sha256}`
    const initialAssets = await this.#assets(release.id)
    if (initialAssets.some((asset) => asset.name === artifact.key)) {
      throw new Error(`GitHub Release asset already exists: ${artifact.key}`)
    }
    if (initialAssets.length >= this.#maxAssets) {
      throw new Error('GitHub Release live asset ceiling reached before upload')
    }

    let attempt = 0
    while (true) {
      const response = await this.#fetcher(
        `https://uploads.github.com/repos/${this.#repository}/releases/${release.id}/assets?name=${encodeURIComponent(artifact.key)}`,
        {
          method: 'POST',
          headers: {
            ...apiHeaders(this.#token),
            'Content-Type': artifact.mediaType,
          },
          body: artifact.bytes.buffer.slice(
            artifact.bytes.byteOffset,
            artifact.bytes.byteOffset + artifact.bytes.byteLength,
          ) as ArrayBuffer,
        },
      )

      if (response.ok) {
        const uploaded = await response.json() as GitHubReleaseAsset
        if (
          uploaded.name !== artifact.key
          || uploaded.size !== artifact.bytes.byteLength
          || uploaded.digest !== expectedDigest
        ) {
          throw new Error(`GitHub Release upload metadata mismatch for ${artifact.key}`)
        }
        this.#cacheUploadedAsset(release.id, uploaded)
        if (this.#uploadPacingMs > 0) await this.#sleep(this.#uploadPacingMs)
        return
      }

      const remoteAssets = await this.#assets(release.id, true)
      const matches = remoteAssets.filter((asset) => asset.name === artifact.key)
      if (matches.length > 1) {
        throw new Error(`Duplicate GitHub Release asset name: ${artifact.key}`)
      }
      if (matches.length === 1) {
        const remote = matches[0]!
        if (
          remote.size === artifact.bytes.byteLength
          && remote.digest === expectedDigest
        ) {
          if (this.#uploadPacingMs > 0) await this.#sleep(this.#uploadPacingMs)
          return
        }
        throw new Error(`Remote GitHub Release asset conflict after upload failure: ${artifact.key}`)
      }

      if (attempt >= this.#uploadRetryDelaysMs.length) {
        throw new Error(
          `GitHub Release asset upload failed after bounded retries with GitHub HTTP ${response.status}`,
        )
      }

      const delay = this.#uploadRetryDelaysMs[attempt]!
      attempt += 1
      if (delay > 0) await this.#sleep(delay)
    }
  }

  async readChannel(): Promise<DbLessChannelRead | null> {
    const release = await this.#release(true)
    if (release.draft) {
      throw new Error('GitHub Release DB-less channel must not be a draft')
    }
    if (release.body === null || !release.body.trim().length) return null

    let channel: DbLessChannelV1
    try {
      channel = JSON.parse(release.body) as DbLessChannelV1
    } catch {
      throw new Error('GitHub Release channel body is not valid JSON')
    }
    await verifyDbLessChannel(channel)
    if (release.body !== canonicalChannelBody(channel)) {
      throw new Error('GitHub Release channel body is not canonical')
    }
    return {
      channel,
      revision: releaseRevision(release, channel),
    }
  }

  async publishChannel(options: {
    channel: DbLessChannelV1
    expectedPreviousChannelSha256: string | null
    expectedRevision: string | null
  }): Promise<{ revision: string | null }> {
    await verifyDbLessChannel(options.channel)

    const release = await this.#release(true)
    let current: DbLessChannelV1 | null = null
    if (release.body !== null && release.body.trim().length) {
      try {
        current = JSON.parse(release.body) as DbLessChannelV1
      } catch {
        throw new Error('GitHub Release channel body is not valid JSON')
      }
      await verifyDbLessChannel(current)
      if (release.body !== canonicalChannelBody(current)) {
        throw new Error('GitHub Release channel body is not canonical')
      }
    }

    const currentSha = current?.channelSha256 ?? null
    const currentRevision = current ? releaseRevision(release, current) : null
    if (currentSha !== options.expectedPreviousChannelSha256) {
      throw new Error('GitHub Release channel SHA changed before publication')
    }
    if (currentRevision !== options.expectedRevision) {
      throw new Error('GitHub Release channel revision changed before publication')
    }

    const body = canonicalChannelBody(options.channel)
    const response = await this.#fetcher(
      `https://api.github.com/repos/${this.#repository}/releases/${release.id}`,
      {
        method: 'PATCH',
        headers: {
          ...apiHeaders(this.#token),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      },
    )
    const updated = await jsonResponse<GitHubRelease>(response, 'GitHub Release channel update')
    this.#releaseCache = updated
    if (updated.id !== release.id || updated.tag_name !== this.#releaseTag) {
      throw new Error('GitHub Release channel update returned the wrong Release')
    }
    if (updated.body !== body) {
      throw new Error('GitHub Release channel update body mismatch')
    }

    return {
      revision: releaseRevision(updated, options.channel),
    }
  }
}