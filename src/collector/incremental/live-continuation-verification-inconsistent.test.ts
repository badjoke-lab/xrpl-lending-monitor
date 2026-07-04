import { describe, expect, it } from 'vitest'
import { evaluateLiveContinuationEvidence, type LiveContinuationEvidence } from './live-continuation-verification'

const evidence: LiveContinuationEvidence = {
  cursor: { epochId: 'epoch-1', lastProcessedLedger: 120, lastProcessedHash: 'H120', latestObservedLedger: 120, latestObservedHash: 'H120' },
  overlay: { epochId: 'epoch-1', overlayLedgerIndex: 119, overlayLedgerHash: 'H119' },
  collector: { status: 'stale', lagLedgers: 1, lastSuccessAt: '2026-07-05T00:00:00.000Z' },
  processedLedgers: { count: 20, minimum: 101, maximum: 120, discontinuities: 1 },
  objectChanges: { created: 2, modified: 5, deleted: 1 },
  overlayObjects: { upserts: 6, tombstones: 1, createdMatches: 2, modifiedMatches: 4 },
  protocolEvents: { total: 12, loanPay: 2, loanManage: 3 },
  lifecycle: { total: 8, payment: 1, paid: 1, impaired: 1, unimpaired: 1, defaulted: 1, deleted: 1 },
  archives: { total: 1, missingTombstones: 1, tombstonesMissingArchive: 0 },
  balanceHistory: { total: 4 },
}

describe('live continuation verification inconsistent evidence', () => {
  it('reports cursor, archive, continuity, and freshness contradictions', () => {
    const report = evaluateLiveContinuationEvidence(evidence)
    expect(report.passed).toBe(false)
    expect(report.paths.cursorOverlay.state).toBe('inconsistent')
    expect(report.paths.ledgerContinuity.state).toBe('inconsistent')
    expect(report.paths.deletionArchive.state).toBe('inconsistent')
    expect(report.paths.freshness.state).toBe('inconsistent')
  })
})
