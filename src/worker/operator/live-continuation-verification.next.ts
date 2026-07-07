import type {
  LiveContinuationEvidence,
  LiveContinuationVerificationReport,
} from '../../collector/incremental/live-continuation-verification'
import {
  readBalanceHistorySourceDiagnostics,
  type BalanceHistorySourceDiagnostics,
} from '../repositories/balance-history-source-diagnostics'
import {
  readLiveContinuationDrilldown,
  type LiveContinuationDrilldown,
} from '../repositories/live-continuation-drilldown'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'
import {
  readLoanActivityDiagnostics,
  type LoanActivityDiagnostics,
} from '../repositories/loan-activity-diagnostics'
import {
  readManagedTransitionSourceDiagnostics,
  type ManagedTransitionSourceDiagnostics,
} from '../repositories/managed-transition-source-diagnostics'
import { evaluateLiveContinuationForRuntime } from './evaluate-live-continuation-runtime'

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
