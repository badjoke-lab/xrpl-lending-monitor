import { describe, expect, it, vi } from 'vitest'
import { canonicalJson, sha256Hex, utf8 } from '../current-state/canonical-json'
import { buildDbLessChannel, encodeDbLessChannel } from './channel'
import { gzipDbLessCurrentOnlyJson } from './current-only-gzip'
import { readPublicCurrentOnlyTailAfterCheckpoint } from './current-tail-github-public'

const REPO = 'badjoke-lab/xrpl-lending-monitor'
const TAG = 'db-less-live-channel-candidate-v1'
const ASSET_TAG = 'db-less-live-data-v1-20261012-12'
const GENERATION = 'live-v1-101-102-aaaaaaaaaaaaaaaa-cccccccccccc'
const KEY = `${GENERATION}-current-only-v1.json.gz`
const HASH = 'A'.repeat(64)
const BASE_HASH = 'B'.repeat(64)
const START_HASH = 'C'.repeat(64)
const SOURCE = 'd'.repeat(64)
const PAYLOAD = `sha256:${'e'.repeat(64)}`
const LOCATION = {
  provider: 'github-release' as const,
  repository: REPO,
  releaseTag: ASSET_TAG,
}
const CHECKPOINT = {
  epochId: 'test-epoch',
  baseIdentity: 'test-base',
  throughLedgerIndex: 100,
  throughLedgerHash: BASE_HASH,
}

function responseWithUrl(body: string | Uint8Array, url: string): Response {
  const encoded = typeof body === 'string' ? utf8(body) : body
  const response = new Response(new Uint8Array(encoded), {
    headers: { 'content-length': String(encoded.byteLength) },
  })
  Object.defineProperty(response, 'url', { value: url })
  return response
}

async function fixture(options: { legacy?: boolean; corrupt?: boolean } = {}) {
  const document = {
    schemaVersion: 1 as const,
    network: 'devnet' as const,
    epochId: 'test-epoch',
    baseIdentity: 'test-base',
    generationId: GENERATION,
    sourceDeltaManifestSha256: SOURCE,
    payloadDigest: PAYLOAD,
    previousLedgerIndex: 100,
    expectedParentHash: BASE_HASH,
    startLedgerIndex: 101,
    endLedgerIndex: 102,
    endLedgerHash: HASH,
    currentProjectionMutations: 1,
    records: [{
      semanticClass: 'current-projection' as const,
      canonicalKey: 'vault:V1',
      sourceLedgerIndex: 102,
      sourceLedgerHash: HASH,
      sourceTransactionHash: 'F'.repeat(64),
      objectId: 'V1',
      relationshipIds: [],
      isTombstone: true,
      value: null,
    }],
  }
  const text = `${canonicalJson(document)}\n`
  const compressed = await gzipDbLessCurrentOnlyJson(text)
  const channel = await buildDbLessChannel({
    schemaVersion: 1,
    network: 'devnet',
    epochId: CHECKPOINT.epochId,
    base: {
      location: LOCATION,
      generationId: CHECKPOINT.baseIdentity,
      snapshotId: 'test-snapshot',
      manifestKey: 'base-manifest.json',
      manifestSha256: SOURCE,
      ledgerIndex: 100,
      ledgerHash: BASE_HASH,
    },
    live: {
      location: LOCATION,
      generationId: GENERATION,
      manifestKey: `${GENERATION}-chain-manifest.json`,
      manifestSha256: SOURCE,
      payloadDigest: PAYLOAD,
      startLedgerIndex: 101,
      startLedgerHash: START_HASH,
      startParentHash: BASE_HASH,
      endLedgerIndex: 102,
      endLedgerHash: HASH,
    },
    lastCommittedLedgerIndex: 102,
    lastCommittedLedgerHash: HASH,
    currentProjectionTail: {
      schemaVersion: 1,
      coverageStartLedgerIndex: 100,
      coverageStartLedgerHash: BASE_HASH,
      generations: [{
        location: LOCATION,
        generationId: GENERATION,
        manifestKey: `${GENERATION}-manifest.json`,
        manifestSha256: SOURCE,
        payloadDigest: PAYLOAD,
        previousLedgerIndex: 100,
        expectedParentHash: BASE_HASH,
        startLedgerIndex: 101,
        startLedgerHash: START_HASH,
        endLedgerIndex: 102,
        endLedgerHash: HASH,
        ledgerCount: 2,
        currentProjectionMutations: 1,
        ...(options.legacy ? {} : {
          currentOnly: {
            key: KEY,
            sha256: await sha256Hex(compressed),
            bytes: compressed.byteLength,
            sourceDeltaManifestSha256: SOURCE,
          },
        }),
      }],
    },
    historyCoverage: [],
    updatedAt: '2026-10-12T12:00:00.000Z',
  })
  const releaseBody = new TextDecoder().decode(encodeDbLessChannel(channel))
  const apiUrl = `https://api.github.com/repos/${REPO}/releases/tags/${TAG}`
  const assetUrl = `https://github.com/${REPO}/releases/download/${ASSET_TAG}/${KEY}`
  const requests: string[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input)
    requests.push(url)
    if (url === apiUrl) {
      return responseWithUrl(JSON.stringify({
        id: 1,
        tag_name: TAG,
        body: releaseBody,
        draft: false,
        prerelease: true,
      }), apiUrl)
    }
    if (url === assetUrl) {
      return responseWithUrl(options.corrupt ? 'corrupt' : compressed,
        'https://release-assets.githubusercontent.com/immutable')
    }
    throw new Error(`Unexpected read: ${url}`)
  }) as unknown as typeof fetch
  return { channel, fetcher, requests, assetUrl, apiUrl }
}

describe('D5 compact public Current adapter (candidate only)', () => {
  it('fetches exactly one SHA-bound immutable Current asset and keeps tombstones', async () => {
    const f = await fixture()
    const value = await readPublicCurrentOnlyTailAfterCheckpoint({
      repository: REPO, channelReleaseTag: TAG, checkpoint: CHECKPOINT, fetcher: f.fetcher,
    })
    expect(f.requests).toEqual([f.apiUrl, f.assetUrl])
    expect(value.source.assetReads).toBe(1)
    expect(value.source.indexedGenerationPointers).toBe(1)
    expect(value.source.transferredBytes).toBeGreaterThan(0)
    expect(value.source.generations[0]?.records[0]?.isTombstone).toBe(true)
    expect(value.channel.channelSha256).toBe(f.channel.channelSha256)
  })

  it('fails closed on legacy generation before requesting historical chunks', async () => {
    const f = await fixture({ legacy: true })
    await expect(readPublicCurrentOnlyTailAfterCheckpoint({
      repository: REPO, channelReleaseTag: TAG, checkpoint: CHECKPOINT, fetcher: f.fetcher,
    })).rejects.toThrow(/pointer is missing/)
    expect(f.requests).toEqual([f.apiUrl])
  })

  it('rejects outdated checkpoint before asset download', async () => {
    const f = await fixture()
    await expect(readPublicCurrentOnlyTailAfterCheckpoint({
      repository: REPO, channelReleaseTag: TAG,
      checkpoint: { ...CHECKPOINT, throughLedgerIndex: 99 },
      fetcher: f.fetcher,
    })).rejects.toThrow(/outside indexed tail coverage/)
    expect(f.requests).toEqual([f.apiUrl])
  })

  it('rejects altered Current asset with no unbounded fallback', async () => {
    const f = await fixture({ corrupt: true })
    await expect(readPublicCurrentOnlyTailAfterCheckpoint({
      repository: REPO, channelReleaseTag: TAG, checkpoint: CHECKPOINT, fetcher: f.fetcher,
    })).rejects.toThrow(/wrong length|digest/)
    expect(f.requests).toEqual([f.apiUrl, f.assetUrl])
  })
})
