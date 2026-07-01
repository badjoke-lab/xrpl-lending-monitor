import { describe, expect, it } from 'vitest'

import type { CurrentStateScanResult } from './scan-current-state'
import { normalizeCurrentState } from './normalize-current-state'
import type { ScannedLedgerObject } from './scan-ledger-objects'

const LEDGER_HASH = 'A'.repeat(64)
const SHARE_MPT_ID = '000004C463C52827307480341125DA0577DEFC38405B0E3E'

function base(type: 'Vault' | 'LoanBroker' | 'Loan', index: string) {
  return {
    LedgerEntryType: type,
    index,
    BinaryHex: '00',
    Flags: 0,
    PreviousTxnID: 'B'.repeat(64),
    PreviousTxnLgrSeq: 100,
  }
}

function vault(id = 'VAULT-1'): ScannedLedgerObject {
  return {
    ...base('Vault', id),
    Owner: 'rVaultOwner',
    Account: 'rVaultPseudo',
    Asset: { currency: 'USD', issuer: 'rUsdIssuer' },
    AssetsTotal: '1000',
    AssetsAvailable: '400',
    AssetsMaximum: '5000',
    LossUnrealized: '0',
    ShareMPTID: SHARE_MPT_ID,
    WithdrawalPolicy: 1,
    Scale: 6,
  }
}

function broker(id = 'BROKER-1', vaultId = 'VAULT-1', ownerCount = 1): ScannedLedgerObject {
  return {
    ...base('LoanBroker', id),
    VaultID: vaultId,
    Owner: 'rBrokerOwner',
    Account: 'rBrokerPseudo',
    Sequence: 1,
    LoanSequence: 2,
    ManagementFeeRate: 100,
    OwnerCount: ownerCount,
    DebtTotal: '600',
    DebtMaximum: '1000',
    CoverAvailable: '100',
    CoverRateMinimum: 1000,
    CoverRateLiquidation: 500,
  }
}

function loan(id = 'LOAN-1', brokerId = 'BROKER-1'): ScannedLedgerObject {
  return {
    ...base('Loan', id),
    Flags: 0x00060000,
    LoanBrokerID: brokerId,
    Borrower: 'rBorrower',
    LoanSequence: 1,
    LoanOriginationFee: '10',
    LoanServiceFee: '2',
    LatePaymentFee: '3',
    ClosePaymentFee: '4',
    OverpaymentFee: 5,
    InterestRate: 500,
    LateInterestRate: 1000,
    CloseInterestRate: 200,
    OverpaymentInterestRate: 5,
    StartDate: 1000,
    PaymentInterval: 300,
    GracePeriod: 60,
    PreviousPaymentDueDate: 1100,
    NextPaymentDueDate: 1400,
    PaymentRemaining: 12,
    PrincipalOutstanding: '500',
    TotalValueOutstanding: '600',
    ManagementFeeOutstanding: '20',
    PeriodicPayment: '50',
    LoanScale: -2,
  }
}

function terminalLoan(flags = 0): ScannedLedgerObject {
  const value = loan()
  value.Flags = flags
  delete value.NextPaymentDueDate
  delete value.PaymentRemaining
  delete value.PrincipalOutstanding
  delete value.TotalValueOutstanding
  delete value.ManagementFeeOutstanding
  return value
}

function scan(options: {
  vaults?: ScannedLedgerObject[]
  brokers?: ScannedLedgerObject[]
  loans?: ScannedLedgerObject[]
} = {}): CurrentStateScanResult {
  return {
    endpoint: 'https://devnet.example',
    ledgerHash: LEDGER_HASH,
    ledgerIndex: 100,
    vaults: options.vaults ?? [vault()],
    loanBrokers: options.brokers ?? [broker()],
    loans: options.loans ?? [loan()],
    metrics: {
      pages: 1,
      requests: 1,
      decodedObjects: 3,
      objects: 3,
      elapsedMs: 10,
      requestedObjectsPerPage: 2048,
      responseMode: 'binary',
      byType: {
        vault: { objects: 1 },
        loan_broker: { objects: 1 },
        loan: { objects: 1 },
      },
    },
  }
}

describe('normalizeCurrentState', () => {
  it('normalizes Vault, Broker, and Loan fields without losing exact amounts', () => {
    const normalized = normalizeCurrentState(scan())

    expect(normalized.vaults[0]).toMatchObject({
      id: 'VAULT-1',
      asset: { key: 'IOU:USD:rUsdIssuer' },
      assetsTotal: '1000',
      shareMptId: SHARE_MPT_ID,
    })
    expect(normalized.loanBrokers[0]).toMatchObject({
      id: 'BROKER-1',
      vaultId: 'VAULT-1',
      ownerCount: 1,
    })
    expect(normalized.loans[0]).toMatchObject({
      id: 'LOAN-1',
      loanBrokerId: 'BROKER-1',
      loanScale: -2,
      nextPaymentDueDate: 1400,
      paymentRemaining: 12,
      onLedgerStatus: 'impaired',
      supportsOverpayment: true,
    })
  })

  it('normalizes zero-omitted fields on a fully paid Loan', () => {
    const normalized = normalizeCurrentState(scan({ loans: [terminalLoan()] }))

    expect(normalized.loans[0]).toMatchObject({
      nextPaymentDueDate: null,
      paymentRemaining: 0,
      principalOutstanding: '0',
      totalValueOutstanding: '0',
      managementFeeOutstanding: '0',
      onLedgerStatus: 'active',
    })
  })

  it('normalizes zero-omitted fields on a defaulted Loan', () => {
    const normalized = normalizeCurrentState(scan({ loans: [terminalLoan(0x00010000)] }))

    expect(normalized.loans[0]).toMatchObject({
      nextPaymentDueDate: null,
      paymentRemaining: 0,
      principalOutstanding: '0',
      totalValueOutstanding: '0',
      managementFeeOutstanding: '0',
      onLedgerStatus: 'defaulted',
    })
  })

  it('rejects a Loan that still has payments but no next due date', () => {
    const malformed = terminalLoan()
    malformed.PaymentRemaining = 1

    expect(() => normalizeCurrentState(scan({ loans: [malformed] }))).toThrow(
      'NextPaymentDueDate is required while PaymentRemaining is greater than zero',
    )
  })

  it('reports a Broker that references a Vault outside the complete scan', () => {
    expect(() =>
      normalizeCurrentState(scan({ brokers: [broker('BROKER-1', 'VAULT-MISSING')] })),
    ).toThrow('Current-state relationship validation failed')
  })

  it('reports a Loan that references a Broker outside the complete scan', () => {
    expect(() =>
      normalizeCurrentState(scan({ loans: [loan('LOAN-1', 'BROKER-MISSING')] })),
    ).toThrow('Current-state relationship validation failed')
  })

  it('reports a Broker OwnerCount mismatch at the fixed ledger', () => {
    const normalized = normalizeCurrentState(scan({ brokers: [broker('BROKER-1', 'VAULT-1', 2)] }), {
      failOnIntegrityIssues: false,
    })

    expect(normalized.integrityIssues).toEqual([
      {
        code: 'broker_owner_count_mismatch',
        objectType: 'loan_broker',
        objectId: 'BROKER-1',
        relatedId: 'BROKER-1',
        expected: 2,
        actual: 1,
      },
    ])
  })
})
