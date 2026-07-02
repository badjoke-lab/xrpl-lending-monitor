import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'

export type ReconciliationIssueType =
  | 'broker_missing_vault'
  | 'loan_missing_broker'
  | 'loan_broker_vault_missing'

export interface ReconciliationIssue {
  type: ReconciliationIssueType
  objectId: string
  relatedId: string
}

export function reconcileCurrentRelationships(options: {
  vaults: readonly VaultCurrentProjection[]
  brokers: readonly LoanBrokerCurrentProjection[]
  loans: readonly LoanCurrentProjection[]
  archivedVaultIds?: readonly string[]
  archivedBrokerIds?: readonly string[]
}): ReconciliationIssue[] {
  const vaultIds = new Set(options.vaults.map((vault) => vault.id))
  const archivedVaultIds = new Set(options.archivedVaultIds ?? [])
  const archivedBrokerIds = new Set(options.archivedBrokerIds ?? [])
  const issues: ReconciliationIssue[] = []

  for (const broker of options.brokers) {
    if (!vaultIds.has(broker.vaultId) && !archivedVaultIds.has(broker.vaultId)) {
      issues.push({
        type: 'broker_missing_vault',
        objectId: broker.id,
        relatedId: broker.vaultId,
      })
    }
  }

  for (const loan of options.loans) {
    const broker = options.brokers.find((item) => item.id === loan.loanBrokerId)
    if (!broker && !archivedBrokerIds.has(loan.loanBrokerId)) {
      issues.push({
        type: 'loan_missing_broker',
        objectId: loan.id,
        relatedId: loan.loanBrokerId,
      })
      continue
    }
    if (broker && !vaultIds.has(broker.vaultId) && !archivedVaultIds.has(broker.vaultId)) {
      issues.push({
        type: 'loan_broker_vault_missing',
        objectId: loan.id,
        relatedId: broker.vaultId,
      })
    }
  }

  return issues.sort(
    (left, right) =>
      left.type.localeCompare(right.type) ||
      left.objectId.localeCompare(right.objectId) ||
      left.relatedId.localeCompare(right.relatedId),
  )
}
