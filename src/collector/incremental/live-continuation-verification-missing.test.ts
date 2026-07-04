import { describe, expect, it } from 'vitest'
import { evaluateLiveContinuationEvidence, type LiveContinuationEvidence } from './live-continuation-verification'

const evidence: LiveContinuationEvidence = {
  cursor: { epochId: null, lastProcessedLedger: null, lastProcessedHash: null, latestObservedLedger: null, latestObservedHash: null },
  overlay: { epochId: null, overlayLedgerIndex: null, overlayLedgerHash: null },
  collector: { status: null, lagLedgers: null, lastSuccessAt: null },
  processedLedgers: { count: 0, minimum: null, maximum: null, discontinuities: 0 },
  objectChanges: { created: 0, modified: 0, deleted: 0 },
  overlayObjects: { upserts: 0, tombstones: 0, createdMatches: 0, modifiedMatches: 0 },
  protocolEvents: { total: 0, loanPay: 0, loanManage: 0 },
  lifecycle: { total: 0, payment: 0, paid: 0, impaired: 0, unimpaired: 0, defaulted: 0, deleted: 0 },
  archives: { total: 0, missingTombstones: 0, tombstonesMissingArchive: 0 },
  balanceHistory: { total: 0 },
}

describe('live continuation verification missing evidence', () => {
  it('keeps unobserved paths missing rather than passing them', () => {
    const report = evaluateLiveContinuationEvidence(evidence)
    expect(report.passed).toBe(false)
    expect(report.paths.createdCurrent.state).toBe('missing')
    expect(report.paths.loanPayment.state).toBe('missing')
    expect(report.paths.deletionArchive.state).toBe('missing')
    expect(report.paths.ledgerContinuity.state).toBe('missing')
    expect(report.paths.freshness.state).toBe('missing')
  })
})
