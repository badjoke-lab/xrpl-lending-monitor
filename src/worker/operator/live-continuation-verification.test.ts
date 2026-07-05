import { describe, expect, it } from 'vitest'

import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'
import type { LoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import { evaluateLiveContinuationForRuntime } from './live-continuation-verification'

function evidence(): LiveContinuationEvidence {
  return {
    cursor: {
      epochId: 'devnet-test',
      lastProcessedLedger: 101,
      lastProcessedHash: 'A'.repeat(64),
      latestObservedLedger: 200,
      latestObservedHash: 'B'.repeat(64),
    },
    overlay: {
      epochId: 'devnet-test',
      overlayLedgerIndex: 101,
      overlayLedgerHash: 'A'.repeat(64),
    },
    collector: {
      status: 'stale',
      lagLedgers: 99,
      lastSuccessAt: '2026-07-05T00:00:00.000Z',
    },
    processedLedgers: {
      count: 2,
      minimum: 100,
      maximum: 101,
      discontinuities: 0,
    },
    objectChanges: { created: 1, modified: 1, deleted: 1 },
    overlayObjects: {
      upserts: 2,
      tombstones: 1,
      createdMatches: 1,
      modifiedMatches: 1,
    },
    protocolEvents: { total: 105, loanPay: 0, loanManage: 0 },
    lifecycle: {
      total: 0,
      payment: 0,
      paid: 0,
      impaired: 0,
      unimpaired: 0,
      defaulted: 0,
      deleted: 0,
    },
    archives: {
      total: 1,
      missingTombstones: 0,
      tombstonesMissingArchive: 0,
    },
    balanceHistory: { total: 0 },
  }
}

function activity(total: number): LoanActivityDiagnostics {
  return {
    epochId: 'devnet-test',
    total,
    latestLedger: total > 0 ? 101 : null,
    loanSet: total,
    loanSetLatestLedger: total > 0 ? 101 : null,
    loanPay: 0,
    loanPayLatestLedger: null,
    loanManage: 0,
    loanManageLatestLedger: null,
    loanDelete: 0,
    loanDeleteLatestLedger: null,
  }
}

function balanceSource(sourceChanges: number): BalanceHistorySourceDiagnostics {
  return {
    epochId: 'devnet-test',
    sourceChanges,
    latestLedger: sourceChanges > 0 ? 101 : null,
  }
}

describe('runtime live-continuation classification', () => {
  it('keeps the cross-surface path missing when only unrelated protocol activity exists', () => {
    const report = evaluateLiveContinuationForRuntime(
      evidence(),
      activity(0),
      balanceSource(0),
    )

    expect(report.paths.activityHistoryBalance.state).toBe('missing')
  })

  it('marks the cross-surface path inconsistent when relevant Loan activity lacks lifecycle evidence', () => {
    const report = evaluateLiveContinuationForRuntime(
      evidence(),
      activity(1),
      balanceSource(0),
    )

    expect(report.paths.activityHistoryBalance.state).toBe('inconsistent')
  })

  it('keeps Loan activity plus lifecycle missing overall until a tracked balance source change is observed', () => {
    const input = evidence()
    input.lifecycle.total = 1

    const report = evaluateLiveContinuationForRuntime(
      input,
      activity(1),
      balanceSource(0),
    )

    expect(report.paths.activityHistoryBalance.state).toBe('missing')
  })

  it('marks balance source and history disagreement inconsistent', () => {
    const input = evidence()
    input.lifecycle.total = 1

    const report = evaluateLiveContinuationForRuntime(
      input,
      activity(1),
      balanceSource(1),
    )

    expect(report.paths.activityHistoryBalance.state).toBe('inconsistent')
  })

  it('marks the cross-surface path observed when both source/projection pairs exist', () => {
    const input = evidence()
    input.lifecycle.total = 1
    input.balanceHistory.total = 1

    const report = evaluateLiveContinuationForRuntime(
      input,
      activity(1),
      balanceSource(1),
    )

    expect(report.paths.activityHistoryBalance.state).toBe('observed')
  })
})
