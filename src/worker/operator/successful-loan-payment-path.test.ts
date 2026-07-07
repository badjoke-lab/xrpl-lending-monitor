import { describe, expect, it } from 'vitest'
import type { LiveContinuationEvidence } from '../../collector/incremental/live-continuation-verification'
import type { LoanActivityDiagnostics } from '../repositories/loan-activity-diagnostics'
import { successfulLoanPaymentPath } from './successful-loan-payment-path'

function path(source: number, payment: number, paid = 0) {
  return successfulLoanPaymentPath({
    loanActivity: { loanPay: source } as unknown as LoanActivityDiagnostics,
    evidence: { lifecycle: { payment, paid } } as unknown as LiveContinuationEvidence,
  })
}

describe('successful LoanPay path', () => {
  it('stays missing before successful source or lifecycle evidence appears', () => {
    expect(path(0, 0).state).toBe('missing')
  })

  it('rejects source and lifecycle disagreement', () => {
    expect(path(1, 0).state).toBe('inconsistent')
    expect(path(0, 1).state).toBe('inconsistent')
  })

  it('observes matching successful LoanPay and lifecycle evidence', () => {
    expect(path(1, 1).state).toBe('observed')
    expect(path(1, 0, 1).state).toBe('observed')
  })
})
