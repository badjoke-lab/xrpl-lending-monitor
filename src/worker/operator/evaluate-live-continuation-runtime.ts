import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationEvidence,
} from '../../collector/incremental/live-continuation-verification'
import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'
import type { LoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import type { ManagedTransitionSourceDiagnostics } from '../repositories/managed-transition-source-diagnostics'
import { crossSurfaceRuntimePath } from './cross-surface-runtime-path'
import { managedRuntimePaths } from './managed-runtime-paths'
import { successfulLoanPaymentPath } from './successful-loan-payment-path'

export function evaluateLiveContinuationForRuntime(
  evidence: LiveContinuationEvidence,
  loan: LoanActivityDiagnostics,
  balance?: BalanceHistorySourceDiagnostics,
  managed?: ManagedTransitionSourceDiagnostics,
) {
  const base = evaluateLiveContinuationEvidence(evidence)
  const paths = {
    ...base.paths,
    loanPayment: successfulLoanPaymentPath({ evidence, loanActivity: loan }),
    ...(managed ? managedRuntimePaths(evidence, managed) : {}),
    activityHistoryBalance: crossSurfaceRuntimePath(evidence, loan, balance),
  }
  return {
    passed: Object.values(paths).every((path) => path.state === 'observed'),
    paths,
  }
}
