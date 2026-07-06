import { describe, expect, it } from 'vitest'

import {
  rippleCloseTimeIso,
  segmentArchivedObjectToApi,
  segmentBalanceHistoryToApi,
  segmentLoanLifecycleToApi,
  segmentObjectChangeToApi,
  segmentProtocolEventToApi,
} from './history-segment-adapter'

describe('history segment API adapter', () => {
  it('converts Ripple close time to deterministic UTC ISO', () => {
    expect(rippleCloseTimeIso(800_000_000)).toBe('2025-05-08T06:13:20.000Z')
  })

  it('maps protocol activity without claiming retained raw payloads', () => {
    expect(segmentProtocolEventToApi({
      eventHash: 'TX1',
      ledgerIndex: 200,
      eventIndex: 1,
      closeTime: 800_000_000,
      eventType: 'LoanSet',
      resultCode: 'tesSUCCESS',
      account: 'rAccount',
      sequence: 1,
      fee: '10',
    }, 'epoch-1')).toMatchObject({
      eventHash: 'TX1',
      epochId: 'epoch-1',
      payloadRetained: false,
      sourceJson: null,
      metadataJson: null,
      createdAt: '2025-05-08T06:13:20.000Z',
    })
  })

  it('maps object changes and parses before/after JSON', () => {
    const result = segmentObjectChangeToApi({
      network: 'devnet',
      epochId: 'epoch-1',
      ledgerIndex: 200,
      closeTime: 800_000_000,
      transactionHash: 'TX1',
      transactionIndex: 1,
      transactionType: 'LoanPay',
      result: 'tesSUCCESS',
      nodeIndex: 0,
      objectType: 'Loan',
      objectId: 'LOAN1',
      action: 'modified',
      fieldName: 'PrincipalOutstanding',
      beforeValue: '100',
      afterValue: '90',
      beforeJson: '"100"',
      afterJson: '"90"',
      valueType: 'string',
      unsupportedField: false,
      relationships: {
        vaultId: 'VAULT1',
        loanBrokerId: 'BROKER1',
        loanId: 'LOAN1',
        account: null,
        owner: null,
        borrower: 'rBorrower',
        assetKey: 'XRP',
        mptIssuanceId: null,
      },
    })
    expect(result.beforeJson).toBe('100')
    expect(result.afterJson).toBe('90')
    expect(result.loanId).toBe('LOAN1')
    expect(result.createdAt).toBe('2025-05-08T06:13:20.000Z')
  })

  it('maps lifecycle JSON details into the existing API model', () => {
    const result = segmentLoanLifecycleToApi({
      network: 'devnet',
      epochId: 'epoch-1',
      loanId: 'LOAN1',
      transactionHash: 'TX1',
      ledgerIndex: 200,
      transactionIndex: 1,
      closeTime: 800_000_000,
      eventType: 'payment',
      transactionType: 'LoanPay',
      result: 'tesSUCCESS',
      statusBefore: 'active',
      statusAfter: 'active',
      principalBefore: '100',
      principalAfter: '90',
      totalValueBefore: '110',
      totalValueAfter: '99',
      paymentRemainingBefore: 10,
      paymentRemainingAfter: 9,
      detailsJson: '{"payment":"10"}',
    })
    expect(result.resultCode).toBe('tesSUCCESS')
    expect(result.detailsJson).toEqual({ payment: '10' })
  })

  it('maps archive and balance JSON fields into existing API models', () => {
    const archive = segmentArchivedObjectToApi({
      network: 'devnet',
      epochId: 'epoch-1',
      objectType: 'Loan',
      objectId: 'LOAN1',
      deletionTransactionHash: 'TX1',
      deletionLedgerIndex: 200,
      deletionTransactionIndex: 1,
      deletionCloseTime: 800_000_000,
      deletionReason: 'loan_delete',
      finalStateJson: '{"LedgerEntryType":"Loan"}',
      vaultId: 'VAULT1',
      loanBrokerId: 'BROKER1',
      loanId: 'LOAN1',
      owner: null,
      account: null,
      borrower: 'rBorrower',
      assetKey: 'XRP',
    })
    expect(archive.finalStateJson).toEqual({ LedgerEntryType: 'Loan' })
    expect(archive.archivedAt).toBe('2025-05-08T06:13:20.000Z')

    const balance = segmentBalanceHistoryToApi({
      network: 'devnet',
      epochId: 'epoch-1',
      subjectType: 'LoanBroker',
      subjectId: 'BROKER1',
      transactionHash: 'TX1',
      ledgerIndex: 200,
      transactionIndex: 1,
      closeTime: 800_000_000,
      metricType: 'required_minimum_cover',
      assetKey: 'XRP',
      beforeValue: '10',
      afterValue: '18',
      formula: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      sourceFieldsJson: '["CoverAvailable","CoverRateMinimum","DebtTotal"]',
    })
    expect(balance.sourceFieldsJson).toEqual(['CoverAvailable', 'CoverRateMinimum', 'DebtTotal'])
    expect(balance.createdAt).toBe('2025-05-08T06:13:20.000Z')
  })
})
