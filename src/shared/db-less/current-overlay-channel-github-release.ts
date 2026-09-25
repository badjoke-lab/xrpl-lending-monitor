import {
  encodeDbLessCurrentOverlayChannel,
  verifyDbLessCurrentOverlayChannel,
  type DbLessCurrentOverlayChannelV1,
} from './current-overlay-channel'

const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const RELEASE_TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export type CurrentOverlayChannelFetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>

interface GitHubRelease {
  id: number
  tag_name: string
  body: string | null
  draft: boolean
  prerelease: boolean
}

export interface DbLessCurrentOverlayChannelReadV1 {
  channel: DbLessCurrentOverlayChannelV1
  revision: string
}

function apiHeaders(token: string): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
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

function canonicalBody(channel: DbLessCurrentOverlayChannelV1): string {
  return new TextDecoder().decode(encodeDbLessCurrentOverlayChannel(channel))
}

function revision(release: GitHubRelease, channel: DbLessCurrentOverlayChannelV1): string {
  return `release:${release.id}:channel:${channel.channelSha256}`
}

function validateRelease(release: GitHubRelease, expectedTag: string): void {
  if (
    !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== expectedTag
    || typeof release.draft !== 'boolean'
    || typeof release.prerelease !== 'boolean'
  ) {
    throw new Error('D4 Current overlay channel Release response is invalid')
  }
  if (release.draft || !release.prerelease) {
    throw new Error('D4 Current overlay channel must be a published prerelease')
  }
}

async function parseChannel(
  release: GitHubRelease,
): Promise<DbLessCurrentOverlayChannelV1 | null> {
  if (release.body === null || !release.body.trim().length) return null

  let channel: DbLessCurrentOverlayChannelV1
  try {
    channel = JSON.parse(release.body) as DbLessCurrentOverlayChannelV1
  } catch {
    throw new Error('D4 Current overlay channel body is not valid JSON')
  }
  await verifyDbLessCurrentOverlayChannel(channel)
  if (release.body !== canonicalBody(channel)) {
    throw new Error('D4 Current overlay channel body is not canonical')
  }
  return channel
}

export class GitHubReleaseCurrentOverlayChannelStore {
  readonly #repository: string
  readonly #releaseTag: string
  readonly #token: string
  readonly #fetcher: CurrentOverlayChannelFetchLike

  constructor(options: {
    repository: string
    releaseTag: string
    token: string
    fetcher?: CurrentOverlayChannelFetchLike
  }) {
    if (!REPOSITORY.test(options.repository)) {
      throw new Error('GitHub repository must be owner/repository')
    }
    if (!RELEASE_TAG.test(options.releaseTag)) {
      throw new Error('GitHub Release tag is invalid')
    }
    if (!options.token.length) throw new Error('GitHub token must be non-empty')

    this.#repository = options.repository
    this.#releaseTag = options.releaseTag
    this.#token = options.token
    this.#fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
  }

  async #release(): Promise<GitHubRelease> {
    const response = await this.#fetcher(
      `https://api.github.com/repos/${this.#repository}/releases/tags/${encodeURIComponent(this.#releaseTag)}`,
      { headers: apiHeaders(this.#token) },
    )
    const release = await jsonResponse<GitHubRelease>(
      response,
      'D4 Current overlay channel Release read',
    )
    validateRelease(release, this.#releaseTag)
    return release
  }

  async read(): Promise<DbLessCurrentOverlayChannelReadV1 | null> {
    const release = await this.#release()
    const channel = await parseChannel(release)
    if (!channel) return null
    return {
      channel,
      revision: revision(release, channel),
    }
  }

  async publish(options: {
    channel: DbLessCurrentOverlayChannelV1
    expectedPreviousChannelSha256: string | null
    expectedRevision: string | null
  }): Promise<DbLessCurrentOverlayChannelReadV1> {
    await verifyDbLessCurrentOverlayChannel(options.channel)

    const release = await this.#release()
    const current = await parseChannel(release)
    const currentSha = current?.channelSha256 ?? null
    const currentRevision = current ? revision(release, current) : null

    if (current?.channelSha256 === options.channel.channelSha256) {
      return {
        channel: current,
        revision: currentRevision!,
      }
    }

    if (
      current
      && options.channel.active.throughLedgerIndex <= current.active.throughLedgerIndex
    ) {
      throw new Error('D4 Current overlay channel must advance the through ledger')
    }
    if (currentSha !== options.expectedPreviousChannelSha256) {
      throw new Error('D4 Current overlay channel SHA changed before publication')
    }
    if (currentRevision !== options.expectedRevision) {
      throw new Error('D4 Current overlay channel revision changed before publication')
    }

    const body = canonicalBody(options.channel)
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
    const updated = await jsonResponse<GitHubRelease>(
      response,
      'D4 Current overlay channel update',
    )
    validateRelease(updated, this.#releaseTag)
    if (updated.id !== release.id || updated.body !== body) {
      throw new Error('D4 Current overlay channel update readback mismatch')
    }
    const readback = await parseChannel(updated)
    if (!readback || readback.channelSha256 !== options.channel.channelSha256) {
      throw new Error('D4 Current overlay channel update verification failed')
    }

    return {
      channel: readback,
      revision: revision(updated, readback),
    }
  }
}
