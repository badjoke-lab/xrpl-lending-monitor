import { describe, expect, it } from 'vitest'

import {
  lifecycleFallbackCandidates,
  selectLifecycleCurrentWitness,
} from './m5-5-browser-witness-selection.mjs'

describe('M5-5 browser witness selection', () => {
  it('selects the first non-deleted lifecycle Loan already present in the bounded current Loan set', () => {
    const lifecycleRows = [
      { loan_id: 'LOAN-DELETED', event_type: 'deleted' },
      { loan_id: 'LOAN-OTHER', event_type: 'payment' },
      { loan_id: 'LOAN-CURRENT', event_type: 'payment' },
    ]
    const currentLoanRows = [
      { id: 'LOAN-CURRENT' },
      { id: 'LOAN-SECOND' },
    ]

    expect(selectLifecycleCurrentWitness(lifecycleRows, currentLoanRows)).toBe('LOAN-CURRENT')
  })

  it('returns null when the bounded current and lifecycle windows do not overlap', () => {
    expect(selectLifecycleCurrentWitness(
      [{ loan_id: 'LOAN-HISTORICAL', event_type: 'payment' }],
      [{ id: 'LOAN-CURRENT' }],
    )).toBeNull()
  })

  it('returns unique non-deleted fallback candidates outside the current Loan set and respects the probe cap', () => {
    const lifecycleRows = [
      { loan_id: 'LOAN-CURRENT', event_type: 'payment' },
      { loan_id: 'LOAN-DELETED', event_type: 'deleted' },
      { loan_id: 'LOAN-A', event_type: 'payment' },
      { loan_id: 'LOAN-A', event_type: 'impaired' },
      { loan_id: 'LOAN-B', event_type: 'payment' },
      { loan_id: 'LOAN-C', event_type: 'payment' },
    ]

    expect(lifecycleFallbackCandidates(lifecycleRows, [{ id: 'LOAN-CURRENT' }], 2)).toEqual([
      'LOAN-A',
      'LOAN-B',
    ])
  })

  it('rejects invalid fallback limits', () => {
    expect(() => lifecycleFallbackCandidates([], [], -1)).toThrow('non-negative safe integer')
  })
})
