import { describe, expect, it } from 'vitest'

import { canonicalJson, sha256Hex, utf8 } from '../../shared/current-state/canonical-json'
import { resolveRuntimeConfig } from '../../shared/runtime-config'
import type { HistorySegmentChannel } from '../../shared/history-segments/channel'
import {
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
} from '../../shared/history-segments/publication'
import { resolveHistorySource } from './history-source'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const H = 'a'.repeat(64)
const COMMIT = 'b'.repeat(40)

function config(historyRepository?: string) {
  return resolveRuntimeConfig({
    APP_NETWORK: 'devnet',
    MAINNET_ENABLED: 'false',
    XRPL_DEVNET_RPC_URL: 'https://devnet.example/',
    HISTORY_GITHUB_REPOSITORY: historyRepository,
  })
}

async function fixtures() {
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'epoch-1',
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
      manifestPath: 'history/epoch-1/s-101-105/manifest.json',
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
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  const publicationBytes = utf8(`${canonicalJson(publication)}\n`)
  const channel: HistorySegmentChannel = {
    schemaVersion: 1,
    active: {
      dataCommitSha: COMMIT,
      publicationPath: 'history/publication.json',
      publicationSha256: await sha256Hex(publicationBytes),
      chainId: publication.chainId,
      epochId: publication.epochId,
      exactIndex: null,
    },
    updatedAt: publication.publishedAt,
  }
  const channelBytes = utf8(`${canonicalJson(channel)}\n`)
  return { publication, publicationBytes, channelBytes }
}

function response(url: string, bytes: Uint8Array): Response {
  const result = new Response(bytes, { status: 200 })
  Object.defineProperty(result, 'url', { value: url })
  return result
}

describe('history source resolution', () => {
  it('uses D1-only mode when immutable history is not configured', async () => {
    await expect(resolveHistorySource(config())).resolves.toMatchObject({
      kind: 'd1',
      configured: false,
      exactIndex: null,
      unavailableReason: null,
    })
  })

  it('opens a valid configured hybrid source', async () => {
    const fixture = await fixtures()
    const fetcher: typeof fetch = async (input) => {
      const url = String(input)
      return response(url, url.endsWith('history-channel.json') ? fixture.channelBytes : fixture.publicationBytes)
    }
    const result = await resolveHistorySource(
      config('badjoke-lab/xrpl-lending-monitor'),
      { fetcher },
    )
    expect(result.kind).toBe('hybrid')
    if (result.kind === 'hybrid') {
      expect(result.publication.endLedgerIndex).toBe(105)
      expect(result.channel.active.dataCommitSha).toBe(COMMIT)
      expect(result.exactIndex).toBeNull()
    }
  })

  it('fails closed instead of silently falling back to D1 when configured history is invalid', async () => {
    const fetcher: typeof fetch = async (input) => response(String(input), utf8('{"bad":true}\n'))
    await expect(resolveHistorySource(
      config('badjoke-lab/xrpl-lending-monitor'),
      { fetcher },
    )).resolves.toEqual({
      kind: 'unavailable',
      configured: true,
      reader: null,
      exactIndex: null,
      channel: null,
      publication: null,
      unavailableReason: 'history_source_integrity_error',
    })
  })
})
