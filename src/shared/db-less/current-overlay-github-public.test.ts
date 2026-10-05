import { describe, expect, it } from 'vitest'

import type { NormalizedCandidateV1 } from '../portable-collector-payload'
import {
  buildDbLessCurrentOverlayChannel,
  encodeDbLessCurrentOverlayChannel,
} from './current-overlay-channel'
import { buildDbLessCurrentOverlayCheckpoint } from './current-overlay-checkpoint'
import { buildDbLessCurrentProjectionCanonicalKey } from './current-projection-identity'
import { openPublicGithubCurrentOverlay } from './current-overlay-github-public'

const HASH = 'A'.repeat(64)
const REPOSITORY = 'badjoke-lab/xrpl-lending-monitor'
const CHANNEL_TAG = 'db-less-current-overlay-channel-v1'

function projection(id: string): NormalizedCandidateV1 {
  return {
    semanticClass: 'current-projection',
    canonicalKey: buildDbLessCurrentProjectionCanonicalKey('vault', id),
    sourceLedgerIndex: 101,
    sourceLedgerHash: HASH,
    sourceTransactionHash: 'B'.repeat(64),
    objectId: id,
    relationshipIds: [],
    isTombstone: false,
    value: { id, kind: 'vault' },
  }
}

function withUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', { value: url })
  return response
}

describe('D5 public GitHub D4 overlay loader', () => {
  it('opens the active checkpoint without a token and serves bounded reads', async () => {
    const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH,
      bucketCount: 8,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [projection('A1')],
      }],
    })
    const checkpointTag = 'db-less-current-overlay-v1-101'
    const channel = await buildDbLessCurrentOverlayChannel({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'epoch-1',
      active: {
        location: {
          provider: 'github-release',
          repository: REPOSITORY,
          releaseTag: checkpointTag,
        },
        manifestKey: checkpoint.manifestArtifact.key,
        manifestSha256: checkpoint.manifestArtifact.sha256,
        sourceChannelSha256: 'c'.repeat(64),
        stateSha256: 'd'.repeat(64),
        baseIdentity: 'base-1',
        throughLedgerIndex: 101,
        throughLedgerHash: HASH,
        generationCount: checkpoint.manifest.generationCount,
        entryCount: checkpoint.manifest.entryCount,
        tombstoneCount: checkpoint.manifest.tombstoneCount,
        bucketCount: checkpoint.manifest.bucketCount,
      },
      updatedAt: '2026-10-05T00:00:00.000Z',
    })
    const channelBody = new TextDecoder().decode(
      encodeDbLessCurrentOverlayChannel(channel),
    )
    const assets = new Map<string, Uint8Array>([
      [checkpoint.manifestArtifact.key, checkpoint.manifestArtifact.bytes],
      ...checkpoint.shardArtifacts.map((artifact) =>
        [artifact.key, artifact.bytes] as const),
    ])
    const requests: Array<{ url: string; headers: Headers }> = []

    const opened = await openPublicGithubCurrentOverlay({
      repository: REPOSITORY,
      channelReleaseTag: CHANNEL_TAG,
      fetcher: async (input, init) => {
        const url = String(input)
        requests.push({ url, headers: new Headers(init?.headers) })
        if (url.includes('/api.github.com/') || url.startsWith('https://api.github.com/')) {
          return withUrl(new Response(JSON.stringify({
            id: 1,
            tag_name: CHANNEL_TAG,
            body: channelBody,
            draft: false,
            prerelease: true,
          }), { status: 200 }), url)
        }
        const key = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1))
        const bytes = assets.get(key)
        if (!bytes) return withUrl(new Response(null, { status: 404 }), url)
        return withUrl(new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) },
        }), url)
      },
    })

    const found = await opened.reader.get('vault', 'A1')
    expect(found.item?.value).toEqual({ id: 'A1', kind: 'vault' })
    expect(found.shardReads).toBeLessThanOrEqual(1)
    expect(opened.manifest.schemaVersion).toBe(2)
    expect(requests[0]?.headers.get('authorization')).toBeNull()
    expect(requests.slice(1).every((request) =>
      request.headers.get('authorization') === null)).toBe(true)
  })

  it('rejects a manifest whose bytes do not match the active channel digest', async () => {
    const checkpoint = await buildDbLessCurrentOverlayCheckpoint({
      epochId: 'epoch-1',
      baseIdentity: 'base-1',
      throughLedgerIndex: 101,
      throughLedgerHash: HASH,
      bucketCount: 8,
      generations: [{
        generationId: 'g1',
        startLedgerIndex: 101,
        endLedgerIndex: 101,
        records: [projection('A1')],
      }],
    })
    const channel = await buildDbLessCurrentOverlayChannel({
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'epoch-1',
      active: {
        location: {
          provider: 'github-release',
          repository: REPOSITORY,
          releaseTag: 'db-less-current-overlay-v1-101',
        },
        manifestKey: checkpoint.manifestArtifact.key,
        manifestSha256: checkpoint.manifestArtifact.sha256,
        sourceChannelSha256: 'c'.repeat(64),
        stateSha256: 'd'.repeat(64),
        baseIdentity: 'base-1',
        throughLedgerIndex: 101,
        throughLedgerHash: HASH,
        generationCount: checkpoint.manifest.generationCount,
        entryCount: checkpoint.manifest.entryCount,
        tombstoneCount: checkpoint.manifest.tombstoneCount,
        bucketCount: checkpoint.manifest.bucketCount,
      },
      updatedAt: '2026-10-05T00:00:00.000Z',
    })
    const channelBody = new TextDecoder().decode(
      encodeDbLessCurrentOverlayChannel(channel),
    )

    await expect(openPublicGithubCurrentOverlay({
      repository: REPOSITORY,
      channelReleaseTag: CHANNEL_TAG,
      fetcher: async (input) => {
        const url = String(input)
        if (url.startsWith('https://api.github.com/')) {
          return withUrl(new Response(JSON.stringify({
            id: 1,
            tag_name: CHANNEL_TAG,
            body: channelBody,
            draft: false,
            prerelease: true,
          }), { status: 200 }), url)
        }
        return withUrl(
          new Response(new TextEncoder().encode('{"tampered":true}\n'), {
            status: 200,
          }),
          url,
        )
      },
    })).rejects.toThrow('manifest digest mismatch')
  })
})
