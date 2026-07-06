import { describe, expect, it } from 'vitest'

import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'
import type { LoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import type { ManagedTransitionSourceDiagnostics } from '../repositories/managed-transition-source-diagnostics'
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

function managedTransitions(options: {
  impaired?: number
  unimpaired?: number
  defaulted?: number
} = {}): ManagedTransitionSourceDiagnostics {
  const impaired = options.impaired ?? 0
  const unimpaired = options.unimpaired ?? 0
  const defaulted = options.defaulted ?? 0
  return {
    epochId: 'devnet-test',
    impaired,
    impairedLatestLedger: impaired > 0 ? 101 : null,
    unimpaired,
    unimpairedLatestLedger: unimpaired > 0 ? 101 : null,
    defaulted,
    defaultedLatestLedger: defaulted > 0 ? 101 : null,
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

  it('keeps managed lifecycle paths missing when neither source nor derived transition exists', () => {
    const report = evaluateLiveContinuationForRuntime(
      evidence(),
      activity(0),
      balanceSource(0),
      managedTransitions(),
    )

    expect(report.paths.impaired.state).toBe('missing')
    expect(report.paths.unimpaired.state).toBe('missing')
    expect(report.paths.defaulted.state).toBe('missing')
  })

  it('marks a managed lifecycle path inconsistent when source and derived evidence disagree', () => {
    const input = evidence()
    input.lifecycle.impaired = 1

    const report = evaluateLiveContinuationForRuntime(
      input,
      activity(0),
      balanceSource(0),
      managedTransitions(),
    )

    expect(report.paths.impaired.state).toBe('inconsistent')
  })

  it('marks each managed lifecycle path observed only when exact source and derived evidence both exist', () => {
    const input = evidence()
    input.lifecycle.impaired = 1
    input.lifecycle.unimpaired = 1
    input.lifecycle.defaulted = 1

    const report = evaluateLiveContinuationForRuntime(
      input,
      activity(0),
      balanceSource(0),
      managedTransitions({ impaired: 1, unimpaired: 1, defaulted: 1 }),
    )

    expect(report.paths.impaired.state).toBe('observed')
    expect(report.paths.unimpaired.state).toBe('observed')
    expect(report.paths.defaulted.state).toBe('observed')
  })
})
