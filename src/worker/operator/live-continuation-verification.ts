import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationEvidence,
  type LiveContinuationVerificationReport,
  type VerificationPath,
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
import {
  readManagedTransitionSourceDiagnostics,
  type ManagedTransitionSourceDiagnostics,
} from '../repositories/managed-transition-source-diagnostics'

function activityHistoryBalancePath(options: {
  evidence: LiveContinuationEvidence
  loanActivity: LoanActivityDiagnostics
  balanceSource: BalanceHistorySourceDiagnostics | undefined
}): VerificationPath {
  const loanSourceObserved = options.loanActivity.total > 0
  const lifecycleObserved = options.evidence.lifecycle.total > 0
  const balanceSourceChanges = options.balanceSource?.sourceChanges
    ?? options.evidence.balanceHistory.total
  const balanceSourceObserved = balanceSourceChanges > 0
  const balanceHistoryObserved = options.evidence.balanceHistory.total > 0

  if (loanSourceObserved !== lifecycleObserved) {
    return {
      state: 'inconsistent',
      reason: 'relevant Loan activity and lifecycle evidence disagree',
    }
  }
  if (balanceSourceObserved !== balanceHistoryObserved) {
    return {
      state: 'inconsistent',
      reason: 'balance-history source changes and derived balance-history evidence disagree',
    }
  }
  if (
    loanSourceObserved
    && lifecycleObserved
    && balanceSourceObserved
    && balanceHistoryObserved
  ) {
    return {
      state: 'observed',
      reason: 'relevant Loan activity/lifecycle and balance source/history evidence observed',
    }
  }
  return {
    state: 'missing',
    reason: 'required Loan activity/lifecycle or balance source/history evidence not yet observed',
  }
}

export function evaluateLiveContinuationForRuntime(
  evidence: LiveContinuationEvidence,
  loanActivity: LoanActivityDiagnostics,
  balanceSource?: BalanceHistorySourceDiagnostics,
  managedTransitions?: ManagedTransitionSourceDiagnostics,
): LiveContinuationVerificationReport {
  const report = evaluateLiveContinuationEvidence(evidence)
  const managedPath = (source: number, lifecycle: number, label: string): VerificationPath => {
    if (source == 0 && lifecycle == 0) return { state: 'missing', reason: `${label} source transition and lifecycle evidence not yet observed` }
    if (source == 0 || lifecycle == 0) return { state: 'inconsistent', reason: `${label} source transition and lifecycle evidence disagree` }
    return { state: 'observed', reason: `${label} source transition and lifecycle evidence observed` }
  }
  const paths = {
    ...report.paths,
    impaired: managedTransitions ? managedPath(managedTransitions.impaired, evidence.lifecycle.impaired, 'impaired') : report.paths.impaired,
    unimpaired: managedTransitions ? managedPath(managedTransitions.unimpaired, evidence.lifecycle.unimpaired, 'unimpaired') : report.paths.unimpaired,
    defaulted: managedTransitions ? managedPath(managedTransitions.defaulted, evidence.lifecycle.defaulted, 'defaulted') : report.paths.defaulted,
    activityHistoryBalance: activityHistoryBalancePath({ evidence, loanActivity, balanceSource }),
  }
  return {
    passed: Object.values(paths).every((path) => path.state === 'observed'),
    paths,
  }
}

export async function verifyLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationVerificationReport> {
  const [evidence, loanActivity, balanceSource, managedTransitions] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLoanActivityDiagnostics(db),
    readBalanceHistorySourceDiagnostics(db),
    readManagedTransitionSourceDiagnostics(db),
  ])
  return evaluateLiveContinuationForRuntime(evidence, loanActivity, balanceSource, managedTransitions)
}

export interface LiveContinuationDiagnostics {
  evidence: LiveContinuationEvidence
  report: LiveContinuationVerificationReport
  drilldown: LiveContinuationDrilldown
  loanActivity: LoanActivityDiagnostics
  balanceSource: BalanceHistorySourceDiagnostics
  managedTransitions: ManagedTransitionSourceDiagnostics
}

export async function diagnoseLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationDiagnostics> {
  const [evidence, drilldown, loanActivity, balanceSource, managedTransitions] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLiveContinuationDrilldown(db),
    readLoanActivityDiagnostics(db),
    readBalanceHistorySourceDiagnostics(db),
    readManagedTransitionSourceDiagnostics(db),
  ])
  return {
    evidence,
    report: evaluateLiveContinuationForRuntime(evidence, loanActivity, balanceSource, managedTransitions),
    drilldown,
    loanActivity,
    balanceSource,
    managedTransitions,
  }
}
