import { describe, expect, it } from 'vitest'
import { evaluateLiveContinuationEvidence, type LiveContinuationEvidence } from './live-continuation-verification'

const evidence: LiveContinuationEvidence = {
  cursor: { epochId: 'epoch-1', lastProcessedLedger: 120, lastProcessedHash: 'H120', latestObservedLedger: 120, latestObservedHash: 'H120' },
  overlay: { epochId: 'epoch-1', overlayLedgerIndex: 120, overlayLedgerHash: 'H120' },
  collector: { status: 'healthy', lagLedgers: 0, lastSuccessAt: '2026-07-05T00:00:00.000Z' },
  processedLedgers: { count: 20, minimum: 101, maximum: 120, discontinuities: 0 },
  objectChanges: { created: 1, modified: 1, deleted: 1 },
  overlayObjects: { upserts: 2, tombstones: 1, createdMatches: 1, modifiedMatches: 1 },
  protocolEvents: { total: 4, loanPay: 1, loanManage: 0 },
  lifecycle: { total: 6, payment: 1, paid: 0, impaired: 1, unimpaired: 1, defaulted: 1, deleted: 1 },
  archives: { total: 1, missingTombstones: 0, tombstonesMissingArchive: 0 },
  balanceHistory: { total: 2 },
}

describe('LoanManage transition verification', () => {
  it('rejects transition lifecycle evidence without LoanManage activity evidence', () => {
    const report = evaluateLiveContinuationEvidence(evidence)
    expect(report.paths.impaired.state).toBe('inconsistent')
    expect(report.paths.unimpaired.state).toBe('inconsistent')
    expect(report.paths.defaulted.state).toBe('inconsistent')
    expect(report.passed).toBe(false)
  })
})
