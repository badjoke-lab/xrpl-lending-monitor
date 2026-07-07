import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'
import type { LoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import { crossSurfaceVerificationPath } from './cross-surface-verification-path'

export function crossSurfaceRuntimePath(
  evidence: LiveContinuationEvidence,
  loan: LoanActivityDiagnostics,
  balance?: BalanceHistorySourceDiagnostics,
) {
  return crossSurfaceVerificationPath({
    loan: loan.total > 0,
    lifecycle: evidence.lifecycle.total > 0,
    source: (balance?.sourceChanges ?? evidence.balanceHistory.total) > 0,
    history: evidence.balanceHistory.total > 0,
    balance,
  })
}
