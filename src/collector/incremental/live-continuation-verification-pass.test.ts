import { describe, expect, it } from 'vitest'
import { evaluateLiveContinuationEvidence, type LiveContinuationEvidence } from './live-continuation-verification'

const evidence: LiveContinuationEvidence = {
  cursor: { epochId: 'epoch-1', lastProcessedLedger: 120, lastProcessedHash: 'H120', latestObservedLedger: 120, latestObservedHash: 'H120' },
  overlay: { epochId: 'epoch-1', overlayLedgerIndex: 120, overlayLedgerHash: 'H120' },
  collector: { status: 'healthy', lagLedgers: 0, lastSuccessAt: '2026-07-05T00:00:00.000Z' },
  processedLedgers: { count: 20, minimum: 101, maximum: 120, discontinuities: 0 },
  objectChanges: { created: 2, modified: 5, deleted: 1 },
  overlayObjects: { upserts: 6, tombstones: 1, createdMatches: 2, modifiedMatches: 4 },
  protocolEvents: { total: 12, loanPay: 2, loanManage: 3 },
  lifecycle: { total: 8, payment: 1, paid: 1, impaired: 1, unimpaired: 1, defaulted: 1, deleted: 1 },
  archives: { total: 1, missingTombstones: 0, tombstonesMissingArchive: 0 },
  balanceHistory: { total: 4 },
}

describe('live continuation verification pass', () => {
  it('passes only when every required path is observed', () => {
    const report = evaluateLiveContinuationEvidence(evidence)
    expect(report.passed).toBe(true)
    expect(Object.values(report.paths).every((path) => path.state === 'observed')).toBe(true)
  })
})
