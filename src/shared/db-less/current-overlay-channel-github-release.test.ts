import { describe, expect, it } from 'vitest'

import {
  buildDbLessCurrentOverlayChannel,
  encodeDbLessCurrentOverlayChannel,
} from './current-overlay-channel'
import {
  GitHubReleaseCurrentOverlayChannelStore,
  type CurrentOverlayChannelFetchLike,
} from './current-overlay-channel-github-release'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const TAG = 'db-less-current-overlay-channel-v1'
const HASH = 'A'.repeat(64)
const SHA = 'a'.repeat(64)

async function channel(
  throughLedgerIndex = 100,
  updatedAt = '2026-09-25T00:00:00.000Z',
) {
  return buildDbLessCurrentOverlayChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    active: {
      location: {
        provider: 'github-release',
        repository: REPO,
        releaseTag: `db-less-current-overlay-v1-${throughLedgerIndex}`,
      },
      manifestKey: `current-overlay-v1-${throughLedgerIndex}-manifest.json`,
      manifestSha256: SHA,
      sourceChannelSha256: 'b'.repeat(64),
      stateSha256: 'c'.repeat(64),
      baseIdentity: 'base-test',
      throughLedgerIndex,
      throughLedgerHash: HASH,
      generationCount: 2,
      entryCount: 10,
      tombstoneCount: 1,
      bucketCount: 8,
    },
    updatedAt,
  })
}

function canonicalBody(
  value: Awaited<ReturnType<typeof channel>>,
): string {
  return new TextDecoder().decode(encodeDbLessCurrentOverlayChannel(value))
}

class FakeGitHub {
  readonly releaseId = 77
  body: string | null
  patchCount = 0

  constructor(body: string | null) {
    this.body = body
  }

  fetch: CurrentOverlayChannelFetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'

    if (
      url.hostname === 'api.github.com'
      && url.pathname === `/repos/${REPO}/releases/tags/${TAG}`
    ) {
      return Response.json({
        id: this.releaseId,
        tag_name: TAG,
        body: this.body,
        draft: false,
        prerelease: true,
      })
    }

    if (
      url.hostname === 'api.github.com'
      && url.pathname === `/repos/${REPO}/releases/${this.releaseId}`
      && method === 'PATCH'
    ) {
      this.patchCount += 1
      const parsed = JSON.parse(String(init?.body)) as { body: string }
      this.body = parsed.body
      return Response.json({
        id: this.releaseId,
        tag_name: TAG,
        body: this.body,
        draft: false,
        prerelease: true,
      })
    }

    return new Response('unexpected', { status: 404 })
  }
}

describe('D4 Current overlay GitHub Release channel store', () => {
  it('reads an empty published prerelease channel as uninitialized', async () => {
    const github = new FakeGitHub(null)
    const store = new GitHubReleaseCurrentOverlayChannelStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await expect(store.read()).resolves.toBeNull()
  })

  it('publishes from an empty channel and verifies canonical readback', async () => {
    const github = new FakeGitHub(null)
    const store = new GitHubReleaseCurrentOverlayChannelStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })
    const next = await channel()

    const published = await store.publish({
      channel: next,
      expectedPreviousChannelSha256: null,
      expectedRevision: null,
    })

    expect(published.channel.channelSha256).toBe(next.channelSha256)
    expect(published.revision).toBe(`release:77:channel:${next.channelSha256}`)
    expect(github.patchCount).toBe(1)
    await expect(store.read()).resolves.toEqual(published)
  })

  it('rejects a stale expected channel revision', async () => {
    const current = await channel()
    const github = new FakeGitHub(canonicalBody(current))
    const store = new GitHubReleaseCurrentOverlayChannelStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })
    const next = await channel(101, '2026-09-25T00:05:00.000Z')

    await expect(store.publish({
      channel: next,
      expectedPreviousChannelSha256: current.channelSha256,
      expectedRevision: 'release:77:channel:stale',
    })).rejects.toThrow('revision changed')
    expect(github.patchCount).toBe(0)
  })

  it('rejects rollback or replacement at the same through ledger', async () => {
    const current = await channel(101)
    const github = new FakeGitHub(canonicalBody(current))
    const store = new GitHubReleaseCurrentOverlayChannelStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })
    const sameLedgerDifferentChannel = await channel(
      101,
      '2026-09-25T00:10:00.000Z',
    )

    await expect(store.publish({
      channel: sameLedgerDifferentChannel,
      expectedPreviousChannelSha256: current.channelSha256,
      expectedRevision: `release:77:channel:${current.channelSha256}`,
    })).rejects.toThrow('must advance')
    expect(github.patchCount).toBe(0)
  })

  it('returns idempotently when the desired canonical channel is already active', async () => {
    const current = await channel(101)
    const github = new FakeGitHub(canonicalBody(current))
    const store = new GitHubReleaseCurrentOverlayChannelStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await expect(store.publish({
      channel: current,
      expectedPreviousChannelSha256: 'stale',
      expectedRevision: 'stale',
    })).resolves.toEqual({
      channel: current,
      revision: `release:77:channel:${current.channelSha256}`,
    })
    expect(github.patchCount).toBe(0)
  })
})
