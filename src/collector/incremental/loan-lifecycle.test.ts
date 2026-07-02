import { describe, expect, it } from 'vitest'

import type { NormalizedObjectChange } from './affected-nodes'
import { deriveLoanLifecycleEvents } from './loan-lifecycle'

const base = {
  network: 'devnet' as const,
  epochId: 'epoch-1',
  closeTime: 1000,
  transactionHash: 'T'.repeat(64),
  transactionIndex: 1,
  result: 'tesSUCCESS',
  nodeIndex: 0,
  objectType: 'Loan' as const,
  objectId: 'L'.repeat(64),
  valueType: 'string' as const,
  unsupportedField: false,
  relationships: {
    vaultId: null,
    loanBrokerId: 'B'.repeat(64),
    loanId: 'L'.repeat(64),
    account: null,
    owner: null,
    borrower: 'rBorrower',
    assetKey: null,
    mptIssuanceId: null,
  },
}

function change(options: {
  ledgerIndex?: number
  transactionHash?: string
  transactionType?: string
  action?: NormalizedObjectChange['action']
  fieldName: string
  beforeJson?: string | null
  afterJson?: string | null
}): NormalizedObjectChange {
  return {
    ...base,
    ledgerIndex: options.ledgerIndex ?? 10,
    transactionHash: options.transactionHash ?? base.transactionHash,
    transactionType: options.transactionType ?? 'LoanSet',
    action: options.action ?? 'modified',
    fieldName: options.fieldName,
    beforeValue: options.beforeJson ? JSON.parse(options.beforeJson) : undefined,
    afterValue: options.afterJson ? JSON.parse(options.afterJson) : undefined,
    beforeJson: options.beforeJson ?? null,
    afterJson: options.afterJson ?? null,
  }
}

describe('deriveLoanLifecycleEvents', () => {
  it('reconstructs Loan creation terms from CreatedNode changes', () => {
    const [event] = deriveLoanLifecycleEvents([
      change({
        transactionType: 'LoanSet',
        action: 'created',
        fieldName: 'Flags',
        afterJson: '0',
      }),
      change({
        transactionType: 'LoanSet',
        action: 'created',
        fieldName: 'PrincipalOutstanding',
        afterJson: '"1000"',
      }),
      change({
        transactionType: 'LoanSet',
        action: 'created',
        fieldName: 'PaymentRemaining',
        afterJson: '12',
      }),
    ])

    expect(event).toMatchObject({
      eventType: 'created',
      statusBefore: 'unknown',
      statusAfter: 'active',
      principalBefore: null,
      principalAfter: '1000',
      paymentRemainingBefore: null,
      paymentRemainingAfter: 12,
    })
  })

  it('records regular LoanPay payment progress without changing on-ledger status', () => {
    const [event] = deriveLoanLifecycleEvents([
      change({
        transactionType: 'LoanPay',
        fieldName: 'PrincipalOutstanding',
        beforeJson: '"1000"',
        afterJson: '"900"',
      }),
      change({
        transactionType: 'LoanPay',
        fieldName: 'PaymentRemaining',
        beforeJson: '12',
        afterJson: '11',
      }),
    ])

    expect(event).toMatchObject({
      eventType: 'payment',
      statusBefore: 'unknown',
      statusAfter: 'unknown',
      principalBefore: '1000',
      principalAfter: '900',
      paymentRemainingBefore: 12,
      paymentRemainingAfter: 11,
    })
  })

  it('classifies a final LoanPay with zero remaining payments as paid', () => {
    const [event] = deriveLoanLifecycleEvents([
      change({
        transactionType: 'LoanPay',
        fieldName: 'PaymentRemaining',
        beforeJson: '1',
        afterJson: '0',
      }),
      change({
        transactionType: 'LoanPay',
        fieldName: 'TotalValueOutstanding',
        beforeJson: '"50"',
        afterJson: '"0"',
      }),
    ])

    expect(event).toMatchObject({
      eventType: 'paid',
      totalValueBefore: '50',
      totalValueAfter: '0',
      paymentRemainingAfter: 0,
    })
  })

  it('derives impair, unimpair, and default only from ledger flag changes', () => {
    const events = deriveLoanLifecycleEvents([
      change({
        ledgerIndex: 20,
        transactionHash: '1'.repeat(64),
        transactionType: 'LoanManage',
        fieldName: 'Flags',
        beforeJson: '0',
        afterJson: `${0x00020000}`,
      }),
      change({
        ledgerIndex: 21,
        transactionHash: '2'.repeat(64),
        transactionType: 'LoanManage',
        fieldName: 'Flags',
        beforeJson: `${0x00020000}`,
        afterJson: '0',
      }),
      change({
        ledgerIndex: 22,
        transactionHash: '3'.repeat(64),
        transactionType: 'LoanManage',
        fieldName: 'Flags',
        beforeJson: '0',
        afterJson: `${0x00010000}`,
      }),
    ])

    expect(events.map((event) => [event.eventType, event.statusBefore, event.statusAfter])).toEqual([
      ['impaired', 'active', 'impaired'],
      ['unimpaired', 'impaired', 'active'],
      ['defaulted', 'active', 'defaulted'],
    ])
  })

  it('does not infer default from schedule fields alone', () => {
    const [event] = deriveLoanLifecycleEvents([
      change({
        transactionType: 'LoanSet',
        fieldName: 'NextPaymentDueDate',
        beforeJson: '800',
        afterJson: '700',
      }),
      change({
        transactionType: 'LoanSet',
        fieldName: 'GracePeriod',
        beforeJson: '60',
        afterJson: '60',
      }),
    ])

    expect(event).toMatchObject({
      eventType: 'updated',
      statusBefore: 'unknown',
      statusAfter: 'unknown',
    })
  })

  it('retains final state for deleted Loan objects', () => {
    const [event] = deriveLoanLifecycleEvents([
      change({
        transactionType: 'LoanDelete',
        action: 'deleted',
        fieldName: 'Flags',
        beforeJson: `${0x00010000}`,
      }),
      change({
        transactionType: 'LoanDelete',
        action: 'deleted',
        fieldName: 'TotalValueOutstanding',
        beforeJson: '"0"',
      }),
    ])

    expect(event).toMatchObject({
      eventType: 'deleted',
      statusBefore: 'defaulted',
      statusAfter: 'deleted',
      totalValueBefore: '0',
      totalValueAfter: null,
    })
  })

  it('orders events by ledger and transaction order', () => {
    const events = deriveLoanLifecycleEvents([
      change({
        ledgerIndex: 12,
        transactionHash: '2'.repeat(64),
        transactionType: 'LoanPay',
        fieldName: 'PaymentRemaining',
        beforeJson: '2',
        afterJson: '1',
      }),
      change({
        ledgerIndex: 11,
        transactionHash: '1'.repeat(64),
        transactionType: 'LoanSet',
        action: 'created',
        fieldName: 'Flags',
        afterJson: '0',
      }),
    ])

    expect(events.map((event) => event.transactionHash)).toEqual(['1'.repeat(64), '2'.repeat(64)])
  })

  it('ignores non-Loan object changes', () => {
    expect(
      deriveLoanLifecycleEvents([
        {
          ...change({ fieldName: 'DebtTotal', beforeJson: '"1"', afterJson: '"2"' }),
          objectType: 'LoanBroker',
        },
      ]),
    ).toEqual([])
  })
})
