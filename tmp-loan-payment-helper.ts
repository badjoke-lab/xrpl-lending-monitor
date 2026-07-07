import type { LiveContinuationEvidence, VerificationPath } from './src/collector/incremental/live-continuation-verification'
import type { LoanActivityDiagnostics } from './src/worker/repositories/loan-activity-diagnostics'

export function successfulLoanPaymentPath(options: {
  loanActivity: LoanActivityDiagnostics
  evidence: LiveContinuationEvidence
}): VerificationPath {
  const lifecycle = options.evidence.lifecycle.payment + options.evidence.lifecycle.paid
  if (options.loanActivity.loanPay === 0 && lifecycle === 0) {
    return { state: 'missing', reason: 'no successful LoanPay continuation evidence observed' }
  }
  if (options.loanActivity.loanPay === 0 || lifecycle === 0) {
    return { state: 'inconsistent', reason: 'successful LoanPay activity and lifecycle evidence disagree' }
  }
  return { state: 'observed', reason: 'successful LoanPay activity and lifecycle evidence observed' }
}
