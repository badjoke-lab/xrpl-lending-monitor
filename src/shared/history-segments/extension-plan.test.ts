import { describe, expect, it } from 'vitest'

import type { HistorySegmentChainPublication } from './publication'
import { assertHistoryExtensionPlan, buildHistoryExtensionPlan } from './extension-plan'

const H1 = 'A'.repeat(64)
const H2 = 'B'.repeat(64)
const H3 = 'C'.repeat(64)
const TARGET = 'D'.repeat(64)

function publication(): HistorySegmentChainPublication {
  return {
    schemaVersion: 1,
    network: 'devnet',
    epochId: 'devnet-99',
    chainId: 'canonical-devnet-100-109',
    complete: true,
    startLedgerIndex: 100,
    startLedgerHash: H2,
    startParentHash: H1,
    endLedgerIndex: 109,
    endLedgerHash: H3,
    segmentCount: 1,
    ledgerCount: 10,
    sourceRevision: 'test-revision',
    publishedAt: '2026-07-10T00:00:00.000Z',
    segments: [{
      segmentId: 'devnet-99-100-109',
      manifestPath: 'history/devnet-99/devnet-99-100-109/manifest.json',
      manifestSha256: '1'.repeat(64),
      startLedgerIndex: 100,
      startLedgerHash: H2,
      startParentHash: H1,
      endLedgerIndex: 109,
      endLedgerHash: H3,
      ledgerCount: 10,
      previousSegmentId: null,
      previousSegmentEndHash: null,
      recordCounts: {
        ledgers: 10,
        protocol_events: 0,
        object_changes: 0,
        loan_lifecycle: 0,
        archived_objects: 0,
        balance_history: 0,
        current_projection_mutations: 0,
      },
    }],
    publicationSha256: 'a'.repeat(64),
  }
}

describe('history extension plan', () => {
  it('binds the source publication terminal and fixed target identity', () => {
    const plan = buildHistoryExtensionPlan({
      publication: publication(),
      targetLedgerIndex: 120,
      targetLedgerHash: TARGET,
      segmentLedgerLimit: 6,
      checkpointEverySegments: 2,
    })

    expect(plan.source).toMatchObject({
      chainId: 'canonical-devnet-100-109',
      endLedgerIndex: 109,
      endLedgerHash: H3,
      lastSegmentId: 'devnet-99-100-109',
    })
    expect(plan.target).toEqual({ ledgerIndex: 120, ledgerHash: TARGET })
    expect(plan.extension).toMatchObject({
      startLedgerIndex: 110,
      endLedgerIndex: 120,
      ledgerCount: 11,
      segmentCount: 2,
      checkpointCount: 1,
      anchorPreviousSegmentId: 'devnet-99-100-109',
      anchorPreviousSegmentEndHash: H3,
    })
    expect(plan.extension.segments.map((segment) => [segment.startLedgerIndex, segment.endLedgerIndex])).toEqual([
      [110, 115],
      [116, 120],
    ])
    expect(() => assertHistoryExtensionPlan(plan)).not.toThrow()
  })

  it('rejects a target at or behind the source terminal', () => {
    expect(() => buildHistoryExtensionPlan({
      publication: publication(),
      targetLedgerIndex: 109,
      targetLedgerHash: TARGET,
      segmentLedgerLimit: 5,
      checkpointEverySegments: 1,
    })).toThrow('ahead of the source publication terminal')
  })

  it('rejects malformed target hashes', () => {
    expect(() => buildHistoryExtensionPlan({
      publication: publication(),
      targetLedgerIndex: 110,
      targetLedgerHash: 'not-a-ledger-hash',
      segmentLedgerLimit: 5,
      checkpointEverySegments: 1,
    })).toThrow('targetLedgerHash is invalid')
  })
})
