import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { CurrentStateScanResult } from './scan-current-state'
import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from './normalize-current-objects'

export interface CurrentStateIntegrityIssue {
  code: 'missing_vault' | 'missing_loan_broker' | 'broker_owner_count_mismatch'
  objectType: 'loan_broker' | 'loan'
  objectId: string
  relatedId: string
  expected?: number
  actual?: number
}

export interface NormalizedCurrentState {
  vaults: readonly VaultCurrentProjection[]
  loanBrokers: readonly LoanBrokerCurrentProjection[]
  loans: readonly LoanCurrentProjection[]
  integrityIssues: readonly CurrentStateIntegrityIssue[]
}

export class CurrentStateIntegrityError extends Error {
  readonly issues: readonly CurrentStateIntegrityIssue[]

  constructor(issues: readonly CurrentStateIntegrityIssue[]) {
    super(`Current-state relationship validation failed with ${issues.length} issue(s)`)
    this.name = 'CurrentStateIntegrityError'
    this.issues = issues
  }
}

export function normalizeCurrentState(
  scan: CurrentStateScanResult,
  options: { failOnIntegrityIssues?: boolean } = {},
): NormalizedCurrentState {
  const vaults = scan.vaults.map(normalizeVault)
  const loanBrokers = scan.loanBrokers.map(normalizeLoanBroker)
  const loans = scan.loans.map(normalizeLoan)
  const issues: CurrentStateIntegrityIssue[] = []

  const vaultIds = new Set(vaults.map((vault) => vault.id))
  const brokersById = new Map(loanBrokers.map((broker) => [broker.id, broker]))
  const loanCounts = new Map<string, number>()

  for (const broker of loanBrokers) {
    if (!vaultIds.has(broker.vaultId)) {
      issues.push({
        code: 'missing_vault',
        objectType: 'loan_broker',
        objectId: broker.id,
        relatedId: broker.vaultId,
      })
    }
  }

  for (const loan of loans) {
    if (!brokersById.has(loan.loanBrokerId)) {
      issues.push({
        code: 'missing_loan_broker',
        objectType: 'loan',
        objectId: loan.id,
        relatedId: loan.loanBrokerId,
      })
      continue
    }
    loanCounts.set(loan.loanBrokerId, (loanCounts.get(loan.loanBrokerId) ?? 0) + 1)
  }

  for (const broker of loanBrokers) {
    const actual = loanCounts.get(broker.id) ?? 0
    if (broker.ownerCount !== actual) {
      issues.push({
        code: 'broker_owner_count_mismatch',
        objectType: 'loan_broker',
        objectId: broker.id,
        relatedId: broker.id,
        expected: broker.ownerCount,
        actual,
      })
    }
  }

  if ((options.failOnIntegrityIssues ?? true) && issues.length > 0) {
    throw new CurrentStateIntegrityError(issues)
  }

  return {
    vaults,
    loanBrokers,
    loans,
    integrityIssues: issues,
  }
}
