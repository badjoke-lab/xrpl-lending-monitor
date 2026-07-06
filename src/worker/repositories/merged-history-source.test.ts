import { describe, expect, it } from 'vitest'

import type {
  BalanceHistoryApiRecord,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'
import {
  mergeActivityHistory,
  mergeBalanceHistory,
  mergeLoanLifecycleDetail,
  mergeLoanLifecycleExplorer,
  mergeObjectHistory,
} from './merged-history-source'

function activity(hash: string, ledgerIndex: number, eventIndex: number): ProtocolEventRecord {
  return {
    eventHash: hash,
    epochId: 'epoch-1',
    ledgerIndex,
    eventIndex,
    closeTime: 800_000_000,
    eventType: 'LoanPay',
    resultCode: 'tesSUCCESS',
    payloadRetained: false,
    sourceJson: null,
    metadataJson: null,
    createdAt: '2025-05-08T06:13:20.000Z',
  }
}

function lifecycle(id: string, ledgerIndex: number, transactionIndex: number): LoanLifecycleRecord {
  return {
    loanId: id,
    epochId: 'epoch-1',
    transactionHash: `TX-${id}-${ledgerIndex}`,
    ledgerIndex,
    transactionIndex,
    closeTime: 800_000_000,
    eventType: 'payment',
    transactionType: 'LoanPay',
    resultCode: 'tesSUCCESS',
    statusBefore: 'active',
    statusAfter: 'active',
    principalBefore: '100',
    principalAfter: '90',
    totalValueBefore: '110',
    totalValueAfter: '99',
    paymentRemainingBefore: 10,
    paymentRemainingAfter: 9,
    detailsJson: {},
    createdAt: '2025-05-08T06:13:20.000Z',
  }
}

function change(fieldName: string, ledgerIndex: number, transactionIndex: number, nodeIndex: number): ObjectChangeRecord {
  return {
    transactionHash: `TX-${ledgerIndex}`,
    epochId: 'epoch-1',
    ledgerIndex,
    transactionIndex,
    transactionType: 'LoanPay',
    resultCode: 'tesSUCCESS',
    closeTime: 800_000_000,
    nodeIndex,
    objectType: 'Loan',
    objectId: 'LOAN1',
    action: 'modified',
    fieldName,
    beforeJson: '100',
    afterJson: '90',
    valueType: 'string',
    unsupportedField: false,
    vaultId: null,
    loanBrokerId: 'BROKER1',
    loanId: 'LOAN1',
    account: null,
    owner: null,
    borrower: 'rBorrower',
    assetKey: 'XRP',
    mptIssuanceId: null,
    createdAt: '2025-05-08T06:13:20.000Z',
  }
}

function balance(subjectId: string, metricType: string, ledgerIndex: number, transactionIndex: number): BalanceHistoryApiRecord {
  return {
    epochId: 'epoch-1',
    subjectType: 'LoanBroker',
    subjectId,
    transactionHash: `TX-${ledgerIndex}-${subjectId}`,
    ledgerIndex,
    transactionIndex,
    closeTime: 800_000_000,
    metricType,
    assetKey: 'XRP',
    beforeValue: '10',
    afterValue: '18',
    formula: null,
    sourceFieldsJson: [],
    createdAt: '2025-05-08T06:13:20.000Z',
  }
}

describe('typed merged history sources', () => {
  it('keeps activity in newest-first order and suppresses D1 overlap', () => {
    const result = mergeActivityHistory({
      immutable: [activity('I105', 105, 2), activity('I104', 104, 1)],
      live: [activity('L107', 107, 1), activity('OVERLAP', 105, 3), activity('L106', 106, 2)],
      boundaryLedgerIndex: 105,
      limit: 10,
    })
    expect(result.items.map((event) => event.eventHash)).toEqual(['L107', 'L106', 'I105', 'I104'])
    expect(result.diagnostics.liveSuppressedAtBoundary).toBe(1)
  })

  it('keeps object history transaction ordering with node/field tie breaks', () => {
    const result = mergeObjectHistory({
      immutable: [
        change('ZField', 105, 2, 0),
        change('AField', 105, 2, 0),
        change('Other', 105, 2, 1),
      ],
      live: [change('Live', 106, 1, 0)],
      boundaryLedgerIndex: 105,
      limit: 10,
    })
    expect(result.items.map((row) => row.fieldName)).toEqual(['Live', 'AField', 'ZField', 'Other'])
  })

  it('uses oldest-first order for loan detail and newest-first for explorer', () => {
    const immutable = [lifecycle('L1', 101, 1), lifecycle('L1', 105, 1)]
    const live = [lifecycle('L1', 107, 1), lifecycle('L1', 106, 1)]
    expect(mergeLoanLifecycleDetail({ immutable, live, boundaryLedgerIndex: 105, limit: 10 })
      .items.map((event) => event.ledgerIndex)).toEqual([101, 105, 106, 107])
    expect(mergeLoanLifecycleExplorer({ immutable, live, boundaryLedgerIndex: 105, limit: 10 })
      .items.map((event) => event.ledgerIndex)).toEqual([107, 106, 105, 101])
  })

  it('keeps balance rows newest-first with stable subject and metric order', () => {
    const result = mergeBalanceHistory({
      immutable: [
        balance('B', 'debt_total', 105, 1),
        balance('A', 'loss_unrealized', 105, 1),
        balance('A', 'debt_total', 105, 1),
      ],
      live: [balance('C', 'cover_available', 106, 1)],
      boundaryLedgerIndex: 105,
      limit: 10,
    })
    expect(result.items.map((row) => `${row.ledgerIndex}:${row.subjectId}:${row.metricType}`)).toEqual([
      '106:C:cover_available',
      '105:A:debt_total',
      '105:A:loss_unrealized',
      '105:B:debt_total',
    ])
  })
})
