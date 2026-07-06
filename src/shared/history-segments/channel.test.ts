import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import {
  historyExactIndexManifestDigest,
  type HistoryExactIndexManifest,
} from './exact-index'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from './publication'
import {
  openGithubHistorySegmentChain,
  parseHistorySegmentChannel,
  type HistorySegmentChannel,
} from './channel'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const H = 'a'.repeat(64)
const COMMIT = 'b'.repeat(40)

async function publication(): Promise<HistorySegmentChainPublication> {
  const value: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-test',
    chainId: 'chain-101-105',
    complete: true,
    startLedgerIndex: 101,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 105,
    endLedgerHash: C,
    segmentCount: 1,
    ledgerCount: 5,
    sourceRevision: 'deadbeef',
    publishedAt: '2026-07-06T00:00:00.000Z',
    segments: [{
      segmentId: 's-101-105',
      manifestPath: 'history/devnet-test/s-101-105/manifest.json',
      manifestSha256: H,
      startLedgerIndex: 101,
      startLedgerHash: B,
      startParentHash: A,
      endLedgerIndex: 105,
      endLedgerHash: C,
      ledgerCount: 5,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: {
        ledgers: 5,
        protocol_events: 0,
        object_changes: 0,
        loan_lifecycle: 0,
        archived_objects: 0,
        balance_history: 0,
        current_projection_mutations: 0,
      },
    }],
    publicationSha256: H,
  }
  value.publicationSha256 = await historySegmentPublicationDigest(value)
  return value
}

async function exactIndexManifest(pub: HistorySegmentChainPublication): Promise<HistoryExactIndexManifest> {
  const manifest: HistoryExactIndexManifest = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: pub.epochId,
    chainId: pub.chainId,
    publicationSha256: pub.publicationSha256,
    bucketCount: 1,
    hashFunction: 'sha256-first-u32-mod-bucket-count',
    assets: [{
      bucket: 0,
      path: 'history/index/exact/0000.ndjson.gz',
      sha256: H,
      compressedBytes: 1,
      recordCount: 0,
      firstTerm: null,
      lastTerm: null,
    }],
    totalRecords: 0,
    sourceRevision: 'deadbeef',
    generatedAt: pub.publishedAt,
    manifestSha256: H,
  }
  manifest.manifestSha256 = await historyExactIndexManifestDigest(manifest)
  return manifest
}

function response(url: string, body: Uint8Array): Response {
  const value = new Response(body, {
    status: 200,
    headers: { 'content-length': String(body.byteLength) },
  })
  Object.defineProperty(value, 'url', { value: url })
  return value
}

describe('history segment publication channel', () => {
  it('parses a valid exact-commit channel without an exact index', () => {
    const channel: HistorySegmentChannel = {
      schemaVersion: 1,
      active: {
        dataCommitSha: COMMIT,
        publicationPath: 'history/publication.json',
        publicationSha256: H,
        chainId: 'chain-101-105',
        epochId: 'devnet-test',
        exactIndex: null,
      },
      updatedAt: '2026-07-06T00:00:00.000Z',
    }
    expect(parseHistorySegmentChannel(channel)).toEqual(channel)
  })

  it('opens publication from the commit pinned by the mutable channel', async () => {
    const pub = await publication()
    const publicationBytes = utf8(`${canonicalJson(pub)}\n`)
    const channel: HistorySegmentChannel = {
      schemaVersion: 1,
      active: {
        dataCommitSha: COMMIT,
        publicationPath: 'history/publication.json',
        publicationSha256: await sha256Hex(publicationBytes),
        chainId: pub.chainId,
        epochId: pub.epochId,
        exactIndex: null,
      },
      updatedAt: pub.publishedAt,
    }
    const channelBytes = utf8(`${canonicalJson(channel)}\n`)
    const requested: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('/history-data/history-channel.json')) return response(url, channelBytes)
      if (url.endsWith(`/${COMMIT}/history/publication.json`)) return response(url, publicationBytes)
      return new Response('not found', { status: 404 })
    }

    const opened = await openGithubHistorySegmentChain({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-data',
      fetcher,
    })

    expect(opened.publication.chainId).toBe(pub.chainId)
    expect(opened.exactIndex).toBeNull()
    expect(requested).toEqual([
      'https://raw.githubusercontent.com/badjoke-lab/xrpl-lending-monitor/history-data/history-channel.json',
      `https://raw.githubusercontent.com/badjoke-lab/xrpl-lending-monitor/${COMMIT}/history/publication.json`,
    ])
  })

  it('opens publication and exact index manifest from the same pinned commit', async () => {
    const pub = await publication()
    const publicationBytes = utf8(`${canonicalJson(pub)}\n`)
    const exactManifest = await exactIndexManifest(pub)
    const exactBytes = utf8(`${canonicalJson(exactManifest)}\n`)
    const channel: HistorySegmentChannel = {
      schemaVersion: 1,
      active: {
        dataCommitSha: COMMIT,
        publicationPath: 'history/publication.json',
        publicationSha256: await sha256Hex(publicationBytes),
        chainId: pub.chainId,
        epochId: pub.epochId,
        exactIndex: {
          manifestPath: 'history/index/exact/manifest.json',
          manifestSha256: await sha256Hex(exactBytes),
        },
      },
      updatedAt: pub.publishedAt,
    }
    const channelBytes = utf8(`${canonicalJson(channel)}\n`)
    const requested: string[] = []
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      requested.push(url)
      if (url.endsWith('/history-data/history-channel.json')) return response(url, channelBytes)
      if (url.endsWith(`/${COMMIT}/history/publication.json`)) return response(url, publicationBytes)
      if (url.endsWith(`/${COMMIT}/history/index/exact/manifest.json`)) return response(url, exactBytes)
      return new Response('not found', { status: 404 })
    }

    const opened = await openGithubHistorySegmentChain({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-data',
      fetcher,
    })

    expect(opened.exactIndex?.manifest.manifestSha256).toBe(exactManifest.manifestSha256)
    expect(requested).toEqual([
      'https://raw.githubusercontent.com/badjoke-lab/xrpl-lending-monitor/history-data/history-channel.json',
      `https://raw.githubusercontent.com/badjoke-lab/xrpl-lending-monitor/${COMMIT}/history/publication.json`,
      `https://raw.githubusercontent.com/badjoke-lab/xrpl-lending-monitor/${COMMIT}/history/index/exact/manifest.json`,
    ])
  })

  it('rejects a channel whose publication bytes do not match the pinned digest', async () => {
    const pub = await publication()
    const publicationBytes = utf8(`${canonicalJson(pub)}\n`)
    const channel: HistorySegmentChannel = {
      schemaVersion: 1,
      active: {
        dataCommitSha: COMMIT,
        publicationPath: 'history/publication.json',
        publicationSha256: H,
        chainId: pub.chainId,
        epochId: pub.epochId,
        exactIndex: null,
      },
      updatedAt: pub.publishedAt,
    }
    const channelBytes = utf8(`${canonicalJson(channel)}\n`)
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      return response(url, url.endsWith('history-channel.json') ? channelBytes : publicationBytes)
    }
    await expect(openGithubHistorySegmentChain({
      githubRepository: 'badjoke-lab/xrpl-lending-monitor',
      githubBranch: 'history-data',
      fetcher,
    })).rejects.toThrow('channel publication digest mismatch')
  })
})
