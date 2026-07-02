import { describe, expect, it } from 'vitest'

import { evaluateLoanStatus, onLedgerStatusFromFlags, scheduleStatus } from './loan-status'

describe('Loan status engine', () => {
  it('derives on-ledger status from flags and deletion evidence', () => {
    expect(onLedgerStatusFromFlags({ flags: 0 })).toBe('active')
    expect(onLedgerStatusFromFlags({ flags: 0x00020000 })).toBe('impaired')
    expect(onLedgerStatusFromFlags({ flags: 0x00010000 })).toBe('defaulted')
    expect(onLedgerStatusFromFlags({ flags: 0, deleted: true })).toBe('deleted')
    expect(onLedgerStatusFromFlags({ flags: null })).toBe('unknown')
  })

  it('settles schedule boundary semantics at due time and grace end', () => {
    const input = {
      onLedgerStatus: 'active' as const,
      paymentRemaining: 1,
      nextPaymentDueDate: 100,
      gracePeriod: 10,
    }

    expect(scheduleStatus({ ...input, evaluatedAt: 99 })).toBe('current')
    expect(scheduleStatus({ ...input, evaluatedAt: 100 })).toBe('payment_due')
    expect(scheduleStatus({ ...input, evaluatedAt: 109 })).toBe('payment_due')
    expect(scheduleStatus({ ...input, evaluatedAt: 110 })).toBe('default_eligible')
  })

  it('keeps terminal and unavailable schedule states explicit', () => {
    expect(
      scheduleStatus({
        onLedgerStatus: 'active',
        paymentRemaining: 0,
        nextPaymentDueDate: null,
        gracePeriod: null,
        evaluatedAt: 100,
      }),
    ).toBe('complete')
    expect(
      scheduleStatus({
        onLedgerStatus: 'deleted',
        paymentRemaining: 1,
        nextPaymentDueDate: 100,
        gracePeriod: 10,
        evaluatedAt: 100,
      }),
    ).toBe('not_applicable')
    expect(
      scheduleStatus({
        onLedgerStatus: 'active',
        paymentRemaining: 1,
        nextPaymentDueDate: null,
        gracePeriod: 10,
        evaluatedAt: 100,
      }),
    ).toBe('unknown')
  })

  it('does not label a Loan defaulted based only on schedule eligibility', () => {
    expect(
      evaluateLoanStatus({
        flags: 0,
        paymentRemaining: 1,
        nextPaymentDueDate: 100,
        gracePeriod: 10,
        evaluatedAt: 120,
      }),
    ).toMatchObject({
      onLedgerStatus: 'active',
      scheduleStatus: 'default_eligible',
      source: {
        defaultEligibleAt: 110,
      },
    })
  })

  it('validates numeric inputs', () => {
    expect(() =>
      scheduleStatus({
        onLedgerStatus: 'active',
        paymentRemaining: -1,
        nextPaymentDueDate: 100,
        gracePeriod: 10,
        evaluatedAt: 100,
      }),
    ).toThrow('paymentRemaining')
  })
})
