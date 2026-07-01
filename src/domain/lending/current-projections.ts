import type { CanonicalAsset } from '../asset/types'

export type LoanOnLedgerStatus = 'active' | 'impaired' | 'defaulted'

export interface VaultCurrentProjection {
  kind: 'vault'
  id: string
  owner: string
  account: string
  asset: CanonicalAsset
  assetsTotal: string
  assetsAvailable: string
  assetsMaximum: string | null
  lossUnrealized: string
  shareMptId: string
  domainId: string | null
  withdrawalPolicy: number
  scale: number
  flags: number
  dataHex: string | null
  previousTxHash: string
  previousLedgerIndex: number
  raw: Record<string, unknown>
}

export interface LoanBrokerCurrentProjection {
  kind: 'loan_broker'
  id: string
  vaultId: string
  owner: string
  account: string
  sequence: number
  loanSequence: number
  managementFeeRate: number | null
  ownerCount: number
  debtTotal: string
  debtMaximum: string | null
  coverAvailable: string
  coverRateMinimum: number
  coverRateLiquidation: number
  flags: number
  dataHex: string | null
  previousTxHash: string
  previousLedgerIndex: number
  raw: Record<string, unknown>
}

export interface LoanCurrentProjection {
  kind: 'loan'
  id: string
  loanBrokerId: string
  borrower: string
  loanSequence: number
  loanOriginationFee: string
  loanServiceFee: string
  latePaymentFee: string
  closePaymentFee: string
  overpaymentFeeRate: number
  interestRate: number
  lateInterestRate: number
  closeInterestRate: number
  overpaymentInterestRate: number
  startDate: number
  paymentInterval: number
  gracePeriod: number
  previousPaymentDueDate: number
  nextPaymentDueDate: number
  paymentRemaining: number
  principalOutstanding: string
  totalValueOutstanding: string
  managementFeeOutstanding: string
  periodicPayment: string
  loanScale: number | null
  onLedgerStatus: LoanOnLedgerStatus
  supportsOverpayment: boolean
  flags: number
  dataHex: string | null
  previousTxHash: string
  previousLedgerIndex: number
  raw: Record<string, unknown>
}
