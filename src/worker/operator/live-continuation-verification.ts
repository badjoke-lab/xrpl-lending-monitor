import {
  evaluateLiveContinuationEvidence,
  type LiveContinuationEvidence,
  type LiveContinuationVerificationReport,
} from '../../collector/incremental/live-continuation-verification'
import {
  readLiveContinuationDrilldown,
  type LiveContinuationDrilldown,
} from '../repositories/live-continuation-drilldown'
import { readLiveContinuationEvidence } from '../repositories/live-continuation-verification'
import {
  readLoanActivityDiagnostics,
  type LoanActivityDiagnostics,
} from '../repositories/loan-activity-diagnostics'

export function evaluateLiveContinuationForRuntime(
  evidence: LiveContinuationEvidence,
  loanActivity: LoanActivityDiagnostics,
): LiveContinuationVerificationReport {
  const report = evaluateLiveContinuationEvidence(evidence)
  if (
    loanActivity.total === 0
    && evidence.lifecycle.total === 0
    && evidence.balanceHistory.total === 0
  ) {
    return {
      ...report,
      passed: false,
      paths: {
        ...report.paths,
        activityHistoryBalance: {
          state: 'missing',
          reason: 'relevant Loan activity, lifecycle, and balance-history evidence not yet observed',
        },
      },
    }
  }
  if (
    loanActivity.total === 0
    || evidence.lifecycle.total === 0
    || evidence.balanceHistory.total === 0
  ) {
    return {
      ...report,
      passed: false,
      paths: {
        ...report.paths,
        activityHistoryBalance: {
          state: 'inconsistent',
          reason: 'relevant Loan activity, lifecycle, and balance-history evidence are incomplete',
        },
      },
    }
  }
  return report
}

export async function verifyLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationVerificationReport> {
  const [evidence, loanActivity] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLoanActivityDiagnostics(db),
  ])
  return evaluateLiveContinuationForRuntime(evidence, loanActivity)
}

export interface LiveContinuationDiagnostics {
  evidence: LiveContinuationEvidence
  report: LiveContinuationVerificationReport
  drilldown: LiveContinuationDrilldown
  loanActivity: LoanActivityDiagnostics
}

export async function diagnoseLiveContinuation(
  db: D1Database,
): Promise<LiveContinuationDiagnostics> {
  const [evidence, drilldown, loanActivity] = await Promise.all([
    readLiveContinuationEvidence(db),
    readLiveContinuationDrilldown(db),
    readLoanActivityDiagnostics(db),
  ])
  return {
    evidence,
    report: evaluateLiveContinuationForRuntime(evidence, loanActivity),
    drilldown,
    loanActivity,
  }
}
