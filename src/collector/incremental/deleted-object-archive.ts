import type { AffectedObjectType, NormalizedObjectChange } from './affected-nodes'

export type ArchivedObjectType = Exclude<AffectedObjectType, 'unknown'>
export type DeletedObjectReason =
  | 'vault_delete'
  | 'loan_broker_delete'
  | 'loan_delete'
  | 'unknown'

export interface ArchivedObjectRecord {
  network: 'devnet' | 'mainnet'
  epochId: string
  objectType: ArchivedObjectType
  objectId: string
  deletionTransactionHash: string
  deletionLedgerIndex: number
  deletionTransactionIndex: number
  deletionCloseTime: number
  deletionReason: DeletedObjectReason
  finalStateJson: string
  vaultId: string | null
  loanBrokerId: string | null
  loanId: string | null
  owner: string | null
  account: string | null
  borrower: string | null
  assetKey: string | null
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

function parseBefore(change: NormalizedObjectChange): unknown {
  if (change.beforeJson === null) return null
  return JSON.parse(change.beforeJson)
}

function archiveType(value: AffectedObjectType): ArchivedObjectType | null {
  if (value === 'Vault' || value === 'LoanBroker' || value === 'Loan') return value
  return null
}

function deletionReason(
  objectType: ArchivedObjectType,
  transactionType: string,
): DeletedObjectReason {
  if (objectType === 'Vault' && transactionType === 'VaultDelete') return 'vault_delete'
  if (objectType === 'LoanBroker' && transactionType === 'LoanBrokerDelete') {
    return 'loan_broker_delete'
  }
  if (objectType === 'Loan' && transactionType === 'LoanDelete') return 'loan_delete'
  return 'unknown'
}

export function deriveArchivedObjects(
  changes: readonly NormalizedObjectChange[],
): ArchivedObjectRecord[] {
  const grouped = new Map<string, NormalizedObjectChange[]>()
  for (const change of changes) {
    if (change.action !== 'deleted') continue
    const objectType = archiveType(change.objectType)
    if (!objectType) continue
    const key = [
      change.network,
      change.epochId,
      objectType,
      change.objectId,
      change.transactionHash,
      change.nodeIndex,
    ].join(':')
    const group = grouped.get(key) ?? []
    group.push(change)
    grouped.set(key, group)
  }

  return [...grouped.values()]
    .map((group) => {
      group.sort((left, right) => left.fieldName.localeCompare(right.fieldName))
      const first = group[0]
      if (!first) throw new Error('Archived object group is empty')
      const objectType = archiveType(first.objectType)
      if (!objectType) throw new Error('Archived object type is unsupported')
      const finalState = Object.fromEntries(
        group.map((change) => [change.fieldName, parseBefore(change)]),
      )
      const relationships = first.relationships

      return {
        network: first.network,
        epochId: first.epochId,
        objectType,
        objectId: first.objectId,
        deletionTransactionHash: first.transactionHash,
        deletionLedgerIndex: first.ledgerIndex,
        deletionTransactionIndex: first.transactionIndex,
        deletionCloseTime: first.closeTime,
        deletionReason: deletionReason(objectType, first.transactionType),
        finalStateJson: stableJson(finalState),
        vaultId: relationships.vaultId,
        loanBrokerId: relationships.loanBrokerId,
        loanId: relationships.loanId,
        owner: relationships.owner,
        account: relationships.account,
        borrower: relationships.borrower,
        assetKey: relationships.assetKey,
      }
    })
    .sort(
      (left, right) =>
        left.deletionLedgerIndex - right.deletionLedgerIndex ||
        left.deletionTransactionIndex - right.deletionTransactionIndex ||
        left.objectId.localeCompare(right.objectId),
    )
}
