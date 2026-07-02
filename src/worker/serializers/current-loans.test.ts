import { describe, expect, it } from 'vitest'

import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import type { ListCurrentLoansResult } from '../repositories/current-state-loan-reader'
import { serializeAvailableLoanCollection, serializeLoanDetail } from './current-loans'

const snapshot: ActiveSnapshotRecord = {
  id: 'snapshot-1',
  epochId: 'epoch-1',
  ledgerIndex: 123,
  ledgerHash: 'SNAPSHOT',
  objectPrefix: 'current/snapshot-1',
  manifestKey: 'current/snapshot-1/manifest.json',
  manifestSha256: 'a'.repeat(64),
  vaultCount: 1,
  loanBrokerCount: 1,
  loanCount: 1,
  objectCount: 3,
  shardCount: 3,
  compressedBytes: 100,
  completedAt: '2026-07-02T00:00:00.000Z',
}

const record: ListCurrentLoansResult['data'][number] = {
  loan: {
    kind: 'loan',
    id: 'C'.repeat(64),
    loanBrokerId: 'B'.repeat(64),
    borrower: 'rBorrower',
    loanSequence: 1,
    loanOriginationFee: '10',
    loanServiceFee: '20',
    latePaymentFee: '30',
    closePaymentFee: '40',
    overpaymentFeeRate: 500,
    interestRate: 1000,
    lateInterestRate: 2000,
    closeInterestRate: 3000,
    overpaymentInterestRate: 4000,
    startDate: 831439690,
    paymentInterval: 400,
    gracePeriod: 60,
    previousPaymentDueDate: 831439690,
    nextPaymentDueDate: 831440090,
    paymentRemaining: 1,
    principalOutstanding: '10000',
    totalValueOutstanding: '10500',
    managementFeeOutstanding: '100',
    periodicPayment: '1000',
    loanScale: null,
    onLedgerStatus: 'active',
    supportsOverpayment: false,
    flags: 0,
    dataHex: null,
    previousTxHash: 'D'.repeat(64),
    previousLedgerIndex: 122,
    raw: { LedgerEntryType: 'Loan' },
  },
  broker: {
    kind: 'loan_broker',
    id: 'B'.repeat(64),
    vaultId: 'A'.repeat(64),
    owner: 'rBrokerOwner',
    account: 'rBrokerAccount',
    sequence: 1,
    loanSequence: 2,
    managementFeeRate: 250,
    ownerCount: 1,
    debtTotal: '10000',
    debtMaximum: '20000',
    coverAvailable: '2000',
    coverRateMinimum: 10000,
    coverRateLiquidation: 15000,
    flags: 0,
    dataHex: null,
    previousTxHash: 'E'.repeat(64),
    previousLedgerIndex: 121,
    raw: { LedgerEntryType: 'LoanBroker' },
  },
  vault: {
    kind: 'vault',
    id: 'A'.repeat(64),
    owner: 'rVaultOwner',
    account: 'rVaultAccount',
    asset: { type: 'xrp', key: 'XRP', symbol: 'XRP', scale: 6 },
    assetsTotal: '100000',
    assetsAvailable: '90000',
    assetsMaximum: null,
    lossUnrealized: '0',
    shareMptId: 'F'.repeat(48),
    domainId: null,
    withdrawalPolicy: 0,
    scale: 6,
    flags: 0,
    dataHex: null,
    previousTxHash: 'F'.repeat(64),
    previousLedgerIndex: 120,
    raw: { LedgerEntryType: 'Vault' },
  },
  schedule: {
    status: 'default_eligible',
    evaluatedAtRippleTime: 831440150,
    nextPaymentDueRippleTime: 831440090,
    defaultEligibleRippleTime: 831440150,
  },
}

const result: ListCurrentLoansResult = {
  data: [record],
  nextCursor: null,
  loanShardsRead: 1,
  relationShardsRead: 2,
  objectsExamined: 1,
}

describe('current Loan API serialization', () => {
  it('keeps exact amounts, asset identity, relationships, and independent states together', () => {
    const response = serializeAvailableLoanCollection({
      epoch: null,
      snapshot,
      result,
      page: { limit: 25 },
      sort: 'id_asc',
      onLedgerStatus: 'active',
      scheduleStatus: 'default_eligible',
    })

    expect(response.data[0]).toMatchObject({
      asset: { key: 'XRP' },
      principal_outstanding: '10000',
      total_value_outstanding: '10500',
      on_ledger_status: 'active',
      schedule_status: 'default_eligible',
      related_loan_broker: { id: 'B'.repeat(64), vault_id: 'A'.repeat(64) },
      related_vault: { id: 'A'.repeat(64), asset: { key: 'XRP' } },
      status_source: {
        flags: 0,
        grace_period_seconds: 60,
        evaluated_at_ripple_time: 831440150,
      },
      provenance: {
        object: 'direct',
        asset: 'direct',
        relationships: 'direct',
        on_ledger_status: 'direct',
        schedule_status: 'derived',
      },
    })
    expect(response.page).toMatchObject({
      loan_shards_read: 1,
      relation_shards_read: 2,
      objects_examined: 1,
    })
  })

  it('includes raw Loan data only in detail output', () => {
    const detail = serializeLoanDetail({ epoch: null, snapshot, record })
    expect(detail.data.raw).toEqual({ LedgerEntryType: 'Loan' })
  })
})
