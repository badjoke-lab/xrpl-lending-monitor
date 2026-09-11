export type CurrentObjectFilter = 'vault' | 'loan_broker' | 'loan'
export type CurrentLedgerEntryType = 'Vault' | 'LoanBroker' | 'Loan'

export interface ScannedLedgerObject extends Record<string, unknown> {
  LedgerEntryType: CurrentLedgerEntryType
  index: string
  BinaryHex?: string
}
