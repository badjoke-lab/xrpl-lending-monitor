import { describe, expect, it } from 'vitest'

import { buildDbLessChannel } from './channel'
import { GitHubReleaseDbLessStore, type GitHubFetchLike } from './github-release-publication'
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const TAG = 'db-less-live-candidate-v1'
const BASE = 'A'.repeat(64)
const LIVE = 'B'.repeat(64)
const SHA = 'a'.repeat(64)

async function channel(ledgerIndex = 100) {
  const hasLive = ledgerIndex > 100
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: {
        provider: 'github-release',
        repository: REPO,
        releaseTag: 'd2-current-base-test',
      },
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: BASE,
    },
    live: hasLive ? {
      location: {
        provider: 'github-release',
        repository: REPO,
        releaseTag: TAG,
      },
      generationId: 'live-chain-test',
      manifestKey: 'live-chain-test-manifest.json',
      manifestSha256: SHA,
      payloadDigest: `sha256:${'b'.repeat(64)}`,
      startLedgerIndex: 101,
      startLedgerHash: LIVE,
      startParentHash: BASE,
      endLedgerIndex: ledgerIndex,
      endLedgerHash: LIVE,
    } : null,
    lastCommittedLedgerIndex: ledgerIndex,
    lastCommittedLedgerHash: hasLive ? LIVE : BASE,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  })
}

class FakeGitHub {
  body: string | null
  readonly releaseId = 7
  readonly assets = new Map<number, { id: number; name: string; bytes: Uint8Array }>()
  nextAssetId = 100
  patchCount = 0
  uploadAttempts = 0
  uploadFailuresRemaining = 0
  persistOnUploadFailure = false
  releaseReadCount = 0
  assetListReadCount = 0
  assetDownloadCount = 0
  browserDownloadCount = 0
  downloadFailuresRemaining = 0

  constructor(body: string | null) {
    this.body = body
  }

  fetch: GitHubFetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'

    if (url.hostname === 'api.github.com' && url.pathname === `/repos/${REPO}/releases/tags/${TAG}`) {
      this.releaseReadCount += 1
      return Response.json({
        id: this.releaseId,
        tag_name: TAG,
        body: this.body,
        draft: false,
        prerelease: true,
      })
    }

    if (url.hostname === 'api.github.com' && url.pathname === `/repos/${REPO}/releases/${this.releaseId}/assets`) {
      this.assetListReadCount += 1
      const values = await Promise.all([...this.assets.values()].map(async (asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.bytes.byteLength,
        digest: `sha256:${await sha256Hex(asset.bytes)}`,
        browser_download_url: `https://github.com/${REPO}/releases/download/${TAG}/${asset.name}`,
      })))
      return Response.json(values)
    }

    const assetMatch = url.pathname.match(new RegExp(`^/repos/${REPO}/releases/assets/(\\d+)import { describe, expect, it } from 'vitest'

import { buildDbLessChannel } from './channel'
import { GitHubReleaseDbLessStore, type GitHubFetchLike } from './github-release-publication'
import { canonicalJson, sha256Hex } from '../current-state/canonical-json'
import type { DbLessArtifact } from './live-delta'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const TAG = 'db-less-live-candidate-v1'
const BASE = 'A'.repeat(64)
const LIVE = 'B'.repeat(64)
const SHA = 'a'.repeat(64)

async function channel(ledgerIndex = 100) {
  const hasLive = ledgerIndex > 100
  return buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    base: {
      location: {
        provider: 'github-release',
        repository: REPO,
        releaseTag: 'd2-current-base-test',
      },
      generationId: 'base-test',
      snapshotId: 'snapshot-test',
      manifestKey: 'base-manifest.json',
      manifestSha256: SHA,
      ledgerIndex: 100,
      ledgerHash: BASE,
    },
    live: hasLive ? {
      location: {
        provider: 'github-release',
        repository: REPO,
        releaseTag: TAG,
      },
      generationId: 'live-chain-test',
      manifestKey: 'live-chain-test-manifest.json',
      manifestSha256: SHA,
      payloadDigest: `sha256:${'b'.repeat(64)}`,
      startLedgerIndex: 101,
      startLedgerHash: LIVE,
      startParentHash: BASE,
      endLedgerIndex: ledgerIndex,
      endLedgerHash: LIVE,
    } : null,
    lastCommittedLedgerIndex: ledgerIndex,
    lastCommittedLedgerHash: hasLive ? LIVE : BASE,
    historyCoverage: [],
    updatedAt: '2026-09-20T00:00:00.000Z',
  })
}

class FakeGitHub {
  body: string | null
  readonly releaseId = 7
  readonly assets = new Map<number, { id: number; name: string; bytes: Uint8Array }>()
  nextAssetId = 100
  patchCount = 0
  uploadAttempts = 0
  uploadFailuresRemaining = 0
  persistOnUploadFailure = false
  releaseReadCount = 0
  assetListReadCount = 0
  assetDownloadCount = 0
  browserDownloadCount = 0
  downloadFailuresRemaining = 0

  constructor(body: string | null) {
    this.body = body
  }

  fetch: GitHubFetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'

    if (url.hostname === 'api.github.com' && url.pathname === `/repos/${REPO}/releases/tags/${TAG}`) {
      this.releaseReadCount += 1
      return Response.json({
        id: this.releaseId,
        tag_name: TAG,
        body: this.body,
        draft: false,
        prerelease: true,
      })
    }

    if (url.hostname === 'api.github.com' && url.pathname === `/repos/${REPO}/releases/${this.releaseId}/assets`) {
      this.assetListReadCount += 1
      const values = await Promise.all([...this.assets.values()].map(async (asset) => ({
        id: asset.id,
        name: asset.name,
        size: asset.bytes.byteLength,
        digest: `sha256:${await sha256Hex(asset.bytes)}`,
        browser_download_url: `https://github.com/${REPO}/releases/download/${TAG}/${asset.name}`,
      })))
      return Response.json(values)
    }

))
    if (url.hostname === 'api.github.com' && assetMatch) {
      this.assetDownloadCount += 1
      if (this.downloadFailuresRemaining > 0) {
        this.downloadFailuresRemaining -= 1
        return new Response('transient', { status: 500 })
      }
      const id = Number(assetMatch[1])
      const asset = this.assets.get(id)
      if (!asset) return new Response('missing', { status: 404 })
      return new Response(asset.bytes)
    }

    const browserPrefix = `/badjoke-lab/xrpl-lending-monitor/releases/download/${TAG}/`
    if (url.hostname === 'github.com' && url.pathname.startsWith(browserPrefix)) {
      this.browserDownloadCount += 1
      if (this.downloadFailuresRemaining > 0) {
        this.downloadFailuresRemaining -= 1
        return new Response('transient', { status: 503 })
      }
      const name = decodeURIComponent(url.pathname.slice(browserPrefix.length))
      const asset = [...this.assets.values()].find((value) => value.name === name)
      if (!asset) return new Response('missing', { status: 404 })
      return new Response(asset.bytes)
    }

    if (
      url.hostname === 'uploads.github.com'
      && url.pathname === `/repos/${REPO}/releases/${this.releaseId}/assets`
      && method === 'POST'
    ) {
      const name = url.searchParams.get('name')
      if (!name) return new Response('missing name', { status: 400 })
      const raw = init?.body
      let bytes: Uint8Array
      if (raw instanceof ArrayBuffer) {
        bytes = new Uint8Array(raw)
      } else if (ArrayBuffer.isView(raw)) {
        bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
      } else {
        return new Response('missing bytes', { status: 400 })
      }
      this.uploadAttempts += 1
      if (this.uploadFailuresRemaining > 0) {
        this.uploadFailuresRemaining -= 1
        if (this.persistOnUploadFailure) {
          const id = this.nextAssetId++
          this.assets.set(id, { id, name, bytes })
        }
        return new Response('secondary rate limit', { status: 403 })
      }

      const id = this.nextAssetId++
      this.assets.set(id, { id, name, bytes })
      return Response.json({
        id,
        name,
        size: bytes.byteLength,
        digest: `sha256:${await sha256Hex(bytes)}`,
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

async function artifact(name: string): Promise<DbLessArtifact> {
  const bytes = new TextEncoder().encode('{"ok":true}\n')
  return {
    key: name,
    mediaType: 'application/json',
    bytes,
    sha256: await sha256Hex(bytes),
    immutable: true,
  }
}

describe('GitHub Release DB-less store', () => {
  it('reads a verified channel from Release body with a stable body revision', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await expect(store.readChannel()).resolves.toEqual({
      channel: current,
      revision: `release:7:channel:${current.channelSha256}`,
    })
  })

  it('rejects a semantically valid but non-canonical channel body', async () => {
    const current = await channel()
    const github = new FakeGitHub(JSON.stringify(current))
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await expect(store.readChannel()).rejects.toThrow('not canonical')
  })

  it('uploads a flat immutable asset and verifies it through inspect', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadPacingMs: 0,
    })
    const value = await artifact('live-v1-101-101-test-manifest.json')

    await store.writeImmutable(value)
    await expect(store.inspect(value.key)).resolves.toEqual({
      key: value.key,
      bytes: value.bytes.byteLength,
      sha256: value.sha256,
    })
  })

  it('caches immutable Release metadata and asset listings across multiple writes', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadPacingMs: 0,
    })
    const values = await Promise.all([
      artifact('live-v1-101-101-cache-1.json'),
      artifact('live-v1-101-101-cache-2.json'),
      artifact('live-v1-101-101-cache-3.json'),
    ])

    for (const value of values) {
      await store.writeImmutable(value)
      await expect(store.inspect(value.key)).resolves.toEqual({
        key: value.key,
        bytes: value.bytes.byteLength,
        sha256: value.sha256,
      })
    }

    expect(github.uploadAttempts).toBe(3)
    expect(github.releaseReadCount).toBe(1)
    expect(github.assetListReadCount).toBe(1)
    expect(github.assetDownloadCount).toBe(3)
  })

  it('caches downloaded immutable Release bytes for repeated reads', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadPacingMs: 0,
    })
    const value = await artifact('live-v1-101-101-download-cache.json')

    await store.writeImmutable(value)
    await expect(store.readImmutable(value.key)).resolves.toEqual(value.bytes)
    await expect(store.readImmutable(value.key)).resolves.toEqual(value.bytes)
    expect(github.assetDownloadCount).toBe(1)
  })

  it('uses browser download URLs when explicitly enabled', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadPacingMs: 0,
      downloadPacingMs: 0,
      preferBrowserDownload: true,
    })
    const value = await artifact('live-v1-101-101-browser-download.json')

    await store.writeImmutable(value)
    await expect(store.readImmutable(value.key)).resolves.toEqual(value.bytes)
    expect(github.browserDownloadCount).toBe(1)
    expect(github.assetDownloadCount).toBe(0)
  })

  it('retries transient Release asset download failures with a bounded policy', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadPacingMs: 0,
      downloadRetryDelaysMs: [0, 0],
    })
    const value = await artifact('live-v1-101-101-download-retry.json')

    await store.writeImmutable(value)
    github.downloadFailuresRemaining = 2

    await expect(store.readImmutable(value.key)).resolves.toEqual(value.bytes)
    expect(github.assetDownloadCount).toBe(3)
  })

  it('retries a rate-limited upload and accepts the later exact digest', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    github.uploadFailuresRemaining = 2
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadRetryDelaysMs: [0, 0],
      uploadPacingMs: 0,
    })
    const value = await artifact('live-v1-101-101-retry-manifest.json')

    await expect(store.writeImmutable(value)).resolves.toBeUndefined()
    expect(github.uploadAttempts).toBe(3)
    await expect(store.inspect(value.key)).resolves.toEqual({
      key: value.key,
      bytes: value.bytes.byteLength,
      sha256: value.sha256,
    })
  })

  it('recovers an uncertain failed upload only from an exact remote digest match', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    github.uploadFailuresRemaining = 1
    github.persistOnUploadFailure = true
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
      uploadRetryDelaysMs: [0],
      uploadPacingMs: 0,
    })
    const value = await artifact('live-v1-101-101-uncertain-manifest.json')

    await expect(store.writeImmutable(value)).resolves.toBeUndefined()
    expect(github.uploadAttempts).toBe(1)
    await expect(store.inspect(value.key)).resolves.toEqual({
      key: value.key,
      bytes: value.bytes.byteLength,
      sha256: value.sha256,
    })
  })

  it('rejects hierarchical Release asset names', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })
    const value = await artifact('live/test/manifest.json')

    await expect(store.writeImmutable(value)).rejects.toThrow('flat')
  })

  it('fails channel publication when the expected body revision is stale', async () => {
    const current = await channel()
    const next = await channel(101)
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await expect(store.publishChannel({
      channel: next,
      expectedPreviousChannelSha256: current.channelSha256,
      expectedRevision: 'release:7:channel:stale',
    })).rejects.toThrow('revision changed')
    expect(github.patchCount).toBe(0)
  })

  it('keeps channel reads fresh instead of using the immutable Release cache', async () => {
    const current = await channel()
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })

    await store.readChannel()
    await store.readChannel()
    expect(github.releaseReadCount).toBe(2)
  })

  it('updates only the Release body when the expected channel matches', async () => {
    const current = await channel()
    const next = await channel(101)
    const github = new FakeGitHub(`${canonicalJson(current)}\n`)
    const store = new GitHubReleaseDbLessStore({
      repository: REPO,
      releaseTag: TAG,
      token: 'token',
      fetcher: github.fetch,
    })
    const before = await store.readChannel()
    if (!before) throw new Error('missing channel fixture')

    await expect(store.publishChannel({
      channel: next,
      expectedPreviousChannelSha256: current.channelSha256,
      expectedRevision: before.revision,
    })).resolves.toEqual({
      revision: `release:7:channel:${next.channelSha256}`,
    })
    expect(github.patchCount).toBe(1)

    const readback = await store.readChannel()
    expect(readback?.channel.channelSha256).toBe(next.channelSha256)
  })
})