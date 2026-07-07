import type {
  LiveContinuationEvidence,
  LiveContinuationVerificationReport,
} from './src/collector/incremental/live-continuation-verification'
import {
  readBalanceHistorySourceDiagnostics,
  type BalanceHistorySourceDiagnostics,
} from './src/worker/repositories/balance-history-source-diagnostics'
import {
  readLiveContinuationDrilldown,
  type LiveContinuationDrilldown,
} from './src/worker/repositories/live-continuation-drilldown'
import { readLiveContinuationEvidence } from './src/worker/repositories/live-continuation-verification'
import {
  readLoanActivityDiagnostics,
  type LoanActivityDiagnostics,
} from './src/worker/repositories/loan-activity-diagnostics'
import {
  readManagedTransitionSourceDiagnostics,
  type ManagedTransitionSourceDiagnostics,
} from './src/worker/repositories/managed-transition-source-diagnostics'
import { evaluateLiveContinuationForRuntime } from './src/worker/operator/evaluate-live-continuation-runtime'

export { evaluateLiveContinuationForRuntime }

export async function verifyLiveContinuation(db: D1Database): Promise<LiveContinuationVerificationReport> {
  const [evidence, loan, balance, managed] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLoanActivityDiagnostics(db),
    readBalanceHistorySourceDiagnostics(db),
    readManagedTransitionSourceDiagnostics(db),
  ])
  return evaluateLiveContinuationForRuntime(evidence, loan, balance, managed)
}

export interface LiveContinuationDiagnostics {
  evidence: LiveContinuationEvidence
  report: LiveContinuationVerificationReport
  drilldown: LiveContinuationDrilldown
  loanActivity: LoanActivityDiagnostics
  balanceSource: BalanceHistorySourceDiagnostics
  managedTransitions: ManagedTransitionSourceDiagnostics
}

export async function diagnoseLiveContinuation(db: D1Database): Promise<LiveContinuationDiagnostics> {
  const [evidence, drilldown, loan, balance, managed] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLiveContinuationDrilldown(db),
    readLoanActivityDiagnostics(db),
    readBalanceHistorySourceDiagnostics(db),
    readManagedTransitionSourceDiagnostics(db),
  ])
  return {
    evidence,
    report: evaluateLiveContinuationForRuntime(evidence, loan, balance, managed),
    drilldown,
    loanActivity: loan,
    balanceSource: balance,
    managedTransitions: managed,
  }
}
