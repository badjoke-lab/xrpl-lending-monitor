import { describe, expect, it } from 'vitest'

import { deriveCurrentStateOverlayMutations } from './current-state-overlay'

const context = {
  ledgerIndex: 101,
  transactionHash: 'T'.repeat(64),
}

function completeLoanFields() {
  return {
    Borrower: 'rBorrower',
    Flags: 0,
    LoanBrokerID: 'B'.repeat(64),
    LoanSequence: 7,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 20,
    PreviousPaymentDueDate: 1000,
    NextPaymentDueDate: 1300,
    PaymentRemaining: 3,
    PrincipalOutstanding: '900',
    TotalValueOutstanding: '990',
    PeriodicPayment: '330',
  }
}

describe('current-state overlay mutation derivation', () => {
  it('derives a canonical upsert from CreatedNode NewFields', () => {
    const objectId = 'L'.repeat(64)
    const mutations = deriveCurrentStateOverlayMutations(
      {
        AffectedNodes: [
          {
            CreatedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: objectId,
              NewFields: completeLoanFields(),
            },
          },
        ],
      },
      context,
    )

    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toMatchObject({
      operation: 'upsert',
      objectType: 'loan',
      objectId,
      relationships: {
        borrower: 'rBorrower',
        loanBrokerId: 'B'.repeat(64),
        onLedgerStatus: 'active',
      },
    })
    expect(JSON.parse((mutations[0] as { projectionJson: string }).projectionJson)).toMatchObject({
      id: objectId,
      paymentRemaining: 3,
      previousTxHash: context.transactionHash,
      previousLedgerIndex: context.ledgerIndex,
    })
  })

  it('uses ModifiedNode FinalFields as the complete post-transaction projection', () => {
    const objectId = 'L'.repeat(64)
    const mutations = deriveCurrentStateOverlayMutations(
      {
        AffectedNodes: [
          {
            ModifiedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: objectId,
              PreviousFields: {
                PaymentRemaining: 3,
                PrincipalOutstanding: '900',
              },
              FinalFields: {
                ...completeLoanFields(),
                PaymentRemaining: 2,
                PrincipalOutstanding: '600',
              },
            },
          },
        ],
      },
      context,
    )

    const projection = JSON.parse((mutations[0] as { projectionJson: string }).projectionJson)
    expect(projection.paymentRemaining).toBe(2)
    expect(projection.principalOutstanding).toBe('600')
    expect(projection.borrower).toBe('rBorrower')
    expect(projection.previousTxHash).toBe(context.transactionHash)
    expect(projection.previousLedgerIndex).toBe(context.ledgerIndex)
  })

  it('derives a deletion tombstone without requiring a complete live projection', () => {
    const objectId = 'L'.repeat(64)
    const mutations = deriveCurrentStateOverlayMutations(
      {
        AffectedNodes: [
          {
            DeletedNode: {
              LedgerEntryType: 'Loan',
              LedgerIndex: objectId,
              FinalFields: {
                Borrower: 'rBorrower',
                LoanBrokerID: 'B'.repeat(64),
                PaymentRemaining: 0,
              },
            },
          },
        ],
      },
      context,
    )

    expect(mutations).toEqual([
      {
        operation: 'deleted',
        objectType: 'loan',
        objectId,
        relationships: {
          owner: null,
          account: null,
          borrower: 'rBorrower',
          vaultId: null,
          loanBrokerId: 'B'.repeat(64),
          assetKey: null,
        },
      },
    ])
  })

  it('ignores non-Lending affected nodes', () => {
    expect(
      deriveCurrentStateOverlayMutations(
        {
          AffectedNodes: [
            {
              ModifiedNode: {
                LedgerEntryType: 'AccountRoot',
                LedgerIndex: 'A'.repeat(64),
                PreviousFields: { Balance: '10' },
                FinalFields: { Balance: '9' },
              },
            },
          ],
        },
        context,
      ),
    ).toEqual([])
  })
})
