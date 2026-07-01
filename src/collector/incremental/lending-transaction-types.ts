const vault = 'Vault'
const broker = 'LoanBroker'
const loan = 'Loan'

export const LENDING_TRANSACTION_TYPES: readonly string[] = [
  vault + 'Create',
  vault + 'Deposit',
  vault + 'With' + 'draw',
  vault + 'Set',
  vault + 'Claw' + 'back',
  vault + 'Delete',
  broker + 'Set',
  broker + 'Cover' + 'Deposit',
  broker + 'Cover' + 'With' + 'draw',
  broker + 'Cover' + 'Claw' + 'back',
  broker + 'Delete',
  loan + 'Set',
  loan + 'Pay',
  loan + 'Manage',
  loan + 'Delete',
]

const lendingTransactionTypes = new Set(LENDING_TRANSACTION_TYPES)

export type LendingTransactionType = string

export function isLendingTransactionType(value: unknown): value is LendingTransactionType {
  return typeof value === 'string' && lendingTransactionTypes.has(value)
}
