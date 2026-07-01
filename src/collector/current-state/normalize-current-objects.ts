import { normalizeXrplAsset } from '../../domain/asset/amount'
import { normalizeMptIssuanceId } from '../../domain/asset/identity'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  LoanOnLedgerStatus,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { ScannedLedgerObject } from './scan-ledger-objects'

const LOAN_DEFAULT_FLAG = 0x00010000
const LOAN_IMPAIRED_FLAG = 0x00020000
const LOAN_OVERPAYMENT_FLAG = 0x00040000

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function optionalString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field]
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  return value
}

function integerValue(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
  return Number(parsed)
}

function requiredUnsigned(record: Record<string, unknown>, field: string): number {
  const value = integerValue(record[field], field)
  if (value < 0) throw new Error(`${field} must be non-negative`)
  return value
}

function optionalUnsigned(record: Record<string, unknown>, field: string): number | null {
  if (record[field] === undefined || record[field] === null) return null
  return requiredUnsigned(record, field)
}

function optionalInteger(record: Record<string, unknown>, field: string): number | null {
  if (record[field] === undefined || record[field] === null) return null
  return integerValue(record[field], field)
}

function amountString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  throw new Error(`${field} must be an exact numeric string or safe integer`)
}

function optionalAmountString(record: Record<string, unknown>, field: string): string | null {
  if (record[field] === undefined || record[field] === null) return null
  return amountString(record, field)
}

function common(object: ScannedLedgerObject): {
  id: string
  flags: number
  dataHex: string | null
  previousTxHash: string
  previousLedgerIndex: number
  raw: Record<string, unknown>
} {
  return {
    id: object.index,
    flags: requiredUnsigned(object, 'Flags'),
    dataHex: optionalString(object, 'Data'),
    previousTxHash: requiredString(object, 'PreviousTxnID'),
    previousLedgerIndex: requiredUnsigned(object, 'PreviousTxnLgrSeq'),
    raw: { ...object },
  }
}

export function normalizeVault(object: ScannedLedgerObject): VaultCurrentProjection {
  if (object.LedgerEntryType !== 'Vault') throw new Error('Expected a Vault object')
  const shareMptId = normalizeMptIssuanceId(requiredString(object, 'ShareMPTID'))

  return {
    kind: 'vault',
    ...common(object),
    owner: requiredString(object, 'Owner'),
    account: requiredString(object, 'Account'),
    asset: normalizeXrplAsset(object.Asset),
    assetsTotal: amountString(object, 'AssetsTotal'),
    assetsAvailable: amountString(object, 'AssetsAvailable'),
    assetsMaximum: optionalAmountString(object, 'AssetsMaximum'),
    lossUnrealized: amountString(object, 'LossUnrealized'),
    shareMptId,
    domainId: optionalString(object, 'DomainID'),
    withdrawalPolicy: requiredUnsigned(object, 'WithdrawalPolicy'),
    scale: requiredUnsigned(object, 'Scale'),
  }
}

export function normalizeLoanBroker(
  object: ScannedLedgerObject,
): LoanBrokerCurrentProjection {
  if (object.LedgerEntryType !== 'LoanBroker') {
    throw new Error('Expected a LoanBroker object')
  }

  return {
    kind: 'loan_broker',
    ...common(object),
    vaultId: requiredString(object, 'VaultID'),
    owner: requiredString(object, 'Owner'),
    account: requiredString(object, 'Account'),
    sequence: requiredUnsigned(object, 'Sequence'),
    loanSequence: requiredUnsigned(object, 'LoanSequence'),
    managementFeeRate: optionalUnsigned(object, 'ManagementFeeRate'),
    ownerCount: requiredUnsigned(object, 'OwnerCount'),
    debtTotal: amountString(object, 'DebtTotal'),
    debtMaximum: optionalAmountString(object, 'DebtMaximum'),
    coverAvailable: amountString(object, 'CoverAvailable'),
    coverRateMinimum: requiredUnsigned(object, 'CoverRateMinimum'),
    coverRateLiquidation: requiredUnsigned(object, 'CoverRateLiquidation'),
  }
}

function loanStatus(flags: number): LoanOnLedgerStatus {
  if ((flags & LOAN_DEFAULT_FLAG) !== 0) return 'defaulted'
  if ((flags & LOAN_IMPAIRED_FLAG) !== 0) return 'impaired'
  return 'active'
}

export function normalizeLoan(object: ScannedLedgerObject): LoanCurrentProjection {
  if (object.LedgerEntryType !== 'Loan') throw new Error('Expected a Loan object')
  const base = common(object)

  return {
    kind: 'loan',
    ...base,
    loanBrokerId: requiredString(object, 'LoanBrokerID'),
    borrower: requiredString(object, 'Borrower'),
    loanSequence: requiredUnsigned(object, 'LoanSequence'),
    loanOriginationFee: amountString(object, 'LoanOriginationFee'),
    loanServiceFee: amountString(object, 'LoanServiceFee'),
    latePaymentFee: amountString(object, 'LatePaymentFee'),
    closePaymentFee: amountString(object, 'ClosePaymentFee'),
    overpaymentFeeRate: requiredUnsigned(object, 'OverpaymentFee'),
    interestRate: requiredUnsigned(object, 'InterestRate'),
    lateInterestRate: requiredUnsigned(object, 'LateInterestRate'),
    closeInterestRate: requiredUnsigned(object, 'CloseInterestRate'),
    overpaymentInterestRate: requiredUnsigned(object, 'OverpaymentInterestRate'),
    startDate: requiredUnsigned(object, 'StartDate'),
    paymentInterval: requiredUnsigned(object, 'PaymentInterval'),
    gracePeriod: requiredUnsigned(object, 'GracePeriod'),
    previousPaymentDueDate: requiredUnsigned(object, 'PreviousPaymentDueDate'),
    nextPaymentDueDate: requiredUnsigned(object, 'NextPaymentDueDate'),
    paymentRemaining: requiredUnsigned(object, 'PaymentRemaining'),
    principalOutstanding: amountString(object, 'PrincipalOutstanding'),
    totalValueOutstanding: amountString(object, 'TotalValueOutstanding'),
    managementFeeOutstanding: amountString(object, 'ManagementFeeOutstanding'),
    periodicPayment: amountString(object, 'PeriodicPayment'),
    loanScale: optionalInteger(object, 'LoanScale'),
    onLedgerStatus: loanStatus(base.flags),
    supportsOverpayment: (base.flags & LOAN_OVERPAYMENT_FLAG) !== 0,
  }
}
