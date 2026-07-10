import { describe, expect, it } from 'vitest'

import type { HistoryExtensionPlan } from './extension-plan'
import { buildExtendedHistoryPublication } from './extended-publication'
import {
  HISTORY_SEGMENT_FILE_KINDS,
  type HistorySegmentManifest,
} from './manifest'
import {
  assertHistorySegmentPublicationDigest,
  historySegmentPublicationDigest,
  type HistorySegmentChainPublication,
  type PublishedHistorySegment,
} from './publication'

const A = 'A'.repeat(64)
const B = 'B'.repeat(64)
const C = 'C'.repeat(64)
const D = 'D'.repeat(64)
const E = 'E'.repeat(64)
const F = 'F'.repeat(64)
const ONE = '1'.repeat(64)

function recordCounts(ledgers: number): PublishedHistorySegment['recordCounts'] {
  return Object.fromEntries(
    HISTORY_SEGMENT_FILE_KINDS.map((kind) => [kind, kind === 'ledgers' ? ledgers : 0]),
  ) as PublishedHistorySegment['recordCounts']
}

function files(ledgerCount: number): HistorySegmentManifest['files'] {
  return HISTORY_SEGMENT_FILE_KINDS.map((kind) => ({
    kind,
    path: `${kind}.ndjson.gz`,
    bytes: 0,
    records: kind === 'ledgers' ? ledgerCount : 0,
    sha256: '0'.repeat(64),
  }))
}

async function sourcePublication(): Promise<HistorySegmentChainPublication> {
  const publication: HistorySegmentChainPublication = {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-99',
    chainId: 'canonical-devnet-100-109',
    complete: true,
    startLedgerIndex: 100,
    startLedgerHash: B,
    startParentHash: A,
    endLedgerIndex: 109,
    endLedgerHash: C,
    segmentCount: 1,
    ledgerCount: 10,
    sourceRevision: 'source',
    publishedAt: '2026-07-10T00:00:00.000Z',
    segments: [{
      segmentId: 'devnet-99-100-109',
      manifestPath: 'history/devnet-99/devnet-99-100-109/manifest.json',
      manifestSha256: 'a'.repeat(64),
      startLedgerIndex: 100,
      startLedgerHash: B,
      startParentHash: A,
      endLedgerIndex: 109,
      endLedgerHash: C,
      ledgerCount: 10,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: recordCounts(10),
    }],
    publicationSha256: '0'.repeat(64),
  }
  publication.publicationSha256 = await historySegmentPublicationDigest(publication)
  return publication
}

function plan(publication: HistorySegmentChainPublication): HistoryExtensionPlan {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: publication.epochId,
    source: {
      chainId: publication.chainId,
      publicationSha256: publication.publicationSha256,
      startLedgerIndex: publication.startLedgerIndex,
      endLedgerIndex: publication.endLedgerIndex,
      endLedgerHash: publication.endLedgerHash,
      segmentCount: publication.segmentCount,
      ledgerCount: publication.ledgerCount,
      lastSegmentId: publication.segments.at(-1)!.segmentId,
    },
    target: { ledgerIndex: 113, ledgerHash: F },
    extension: {
      startLedgerIndex: 110,
      endLedgerIndex: 113,
      ledgerCount: 4,
      segmentLedgerLimit: 2,
      checkpointEverySegments: 1,
      segmentCount: 2,
      checkpointCount: 2,
      anchorPreviousSegmentId: 'devnet-99-100-109',
      anchorPreviousSegmentEndHash: C,
      segments: [
        {
          ordinal: 1,
          segmentId: 'devnet-99-110-111',
          startLedgerIndex: 110,
          endLedgerIndex: 111,
          ledgerCount: 2,
          checkpointAfter: true,
        },
        {
          ordinal: 2,
          segmentId: 'devnet-99-112-113',
          startLedgerIndex: 112,
          endLedgerIndex: 113,
          ledgerCount: 2,
          checkpointAfter: true,
        },
      ],
    },
  }
}

function extensionManifests(): HistorySegmentManifest[] {
  return [
    {
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-99',
      segmentId: 'devnet-99-110-111',
      startLedgerIndex: 110,
      startLedgerHash: D,
      startParentHash: C,
      endLedgerIndex: 111,
      endLedgerHash: E,
      ledgerCount: 2,
      sourceRevision: 'extension',
      generatedAt: '2026-07-10T00:01:00.000Z',
      previousSegmentId: 'devnet-99-100-109',
      previousSegmentEndHash: C,
      files: files(2),
    },
    {
      schemaVersion: 1,
      network: 'devnet',
      epochId: 'devnet-99',
      segmentId: 'devnet-99-112-113',
      startLedgerIndex: 112,
      startLedgerHash: ONE,
      startParentHash: E,
      endLedgerIndex: 113,
      endLedgerHash: F,
      ledgerCount: 2,
      sourceRevision: 'extension',
      generatedAt: '2026-07-10T00:02:00.000Z',
      previousSegmentId: 'devnet-99-110-111',
      previousSegmentEndHash: E,
      files: files(2),
    },
  ]
}

describe('extended history publication', () => {
  it('preserves the verified source prefix and appends only plan-bound extension descriptors', async () => {
    const source = await sourcePublication()
    const manifests = extensionManifests()
    const publication = await buildExtendedHistoryPublication({
      sourcePublication: source,
      plan: plan(source),
      extensionManifests: manifests.map((manifest, index) => ({
        manifest,
        manifestSha256: String(index + 1).repeat(64),
      })),
      chainId: 'canonical-devnet-100-113',
      sourceRevision: 'new-revision',
    })

    expect(publication.segments.slice(0, source.segmentCount)).toEqual(source.segments)
    expect(publication).toMatchObject({
      chainId: 'canonical-devnet-100-113',
      startLedgerIndex: 100,
      endLedgerIndex: 113,
      endLedgerHash: F,
      segmentCount: 3,
      ledgerCount: 14,
      sourceRevision: 'new-revision',
      publishedAt: '2026-07-10T00:02:00.000Z',
    })
    expect(publication.segments.slice(source.segmentCount).map((segment) => segment.segmentId)).toEqual([
      'devnet-99-110-111',
      'devnet-99-112-113',
    ])
    await expect(assertHistorySegmentPublicationDigest(publication)).resolves.toBeUndefined()
  })

  it('rejects a source publication that differs from the frozen plan identity', async () => {
    const source = await sourcePublication()
    const frozenPlan = plan(source)
    frozenPlan.source.chainId = 'canonical-devnet-other-source'

    await expect(buildExtendedHistoryPublication({
      sourcePublication: source,
      plan: frozenPlan,
      extensionManifests: extensionManifests().map((manifest) => ({ manifest, manifestSha256: '1'.repeat(64) })),
      chainId: 'canonical-devnet-100-113',
      sourceRevision: 'new-revision',
    })).rejects.toThrow('source publication does not match the frozen extension plan')
  })

  it('rejects invalid extension manifest digests', async () => {
    const source = await sourcePublication()
    const manifests = extensionManifests()

    await expect(buildExtendedHistoryPublication({
      sourcePublication: source,
      plan: plan(source),
      extensionManifests: manifests.map((manifest, index) => ({
        manifest,
        manifestSha256: index === 0 ? 'not-a-digest' : '2'.repeat(64),
      })),
      chainId: 'canonical-devnet-100-113',
      sourceRevision: 'new-revision',
    })).rejects.toThrow('manifest digest is invalid')
  })
})
