import { normalizeXrplAsset } from '../../domain/asset/amount'

export type AffectedNodeAction = 'created' | 'modified' | 'deleted'
export type AffectedObjectType = 'Vault' | 'LoanBroker' | 'Loan' | 'unknown'
export type ObjectChangeValueType = 'null' | 'string' | 'number' | 'boolean' | 'array' | 'object'

export interface ObjectChangeContext {
  network: 'devnet' | 'mainnet'
  epochId: string
  ledgerIndex: number
  closeTime: number
  transactionHash: string
  transactionIndex: number
  transactionType: string
  result: string
}

export interface ObjectChangeRelationships {
  vaultId: string | null
  loanBrokerId: string | null
  loanId: string | null
  account: string | null
  owner: string | null
  borrower: string | null
  assetKey: string | null
  mptIssuanceId: string | null
}

export interface NormalizedObjectChange extends ObjectChangeContext {
  nodeIndex: number
  objectType: AffectedObjectType
  objectId: string
  action: AffectedNodeAction
  fieldName: string
  beforeValue: unknown
  afterValue: unknown
  beforeJson: string | null
  afterJson: string | null
  valueType: ObjectChangeValueType
  unsupportedField: boolean
  relationships: ObjectChangeRelationships
}

const KNOWN_FIELDS = {
  Vault: new Set([
    'Account',
    'Asset',
    'AssetsAvailable',
    'AssetsMaximum',
    'AssetsTotal',
    'Data',
    'DomainID',
    'Flags',
    'LedgerEntryType',
    'LossUnrealized',
    'Owner',
    'PreviousTxnID',
    'PreviousTxnLgrSeq',
    'Scale',
    'ShareMPTID',
    'VaultID',
    'WithdrawalPolicy',
  ]),
  LoanBroker: new Set([
    'Account',
    'CoverAvailable',
    'CoverRateLiquidation',
    'CoverRateMinimum',
    'Data',
    'DebtMaximum',
    'DebtTotal',
    'Flags',
    'LedgerEntryType',
    'LoanBrokerID',
    'LoanSequence',
    'ManagementFeeRate',
    'Owner',
    'OwnerCount',
    'PreviousTxnID',
    'PreviousTxnLgrSeq',
    'Sequence',
    'VaultID',
  ]),
  Loan: new Set([
    'Borrower',
    'CloseInterestRate',
    'ClosePaymentFee',
    'Data',
    'Flags',
    'GracePeriod',
    'InterestRate',
    'LateInterestRate',
    'LatePaymentFee',
    'LedgerEntryType',
    'LoanBrokerID',
    'LoanID',
    'LoanOriginationFee',
    'LoanScale',
    'LoanSequence',
    'LoanServiceFee',
    'ManagementFeeOutstanding',
    'NextPaymentDueDate',
    'OverpaymentFee',
    'OverpaymentInterestRate',
    'PaymentInterval',
    'PaymentRemaining',
    'PeriodicPayment',
    'PreviousPaymentDueDate',
    'PreviousTxnID',
    'PreviousTxnLgrSeq',
    'PrincipalOutstanding',
    'StartDate',
    'TotalValueOutstanding',
  ]),
} satisfies Record<Exclude<AffectedObjectType, 'unknown'>, Set<string>>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function objectType(value: unknown): AffectedObjectType {
  if (value === 'Vault' || value === 'LoanBroker' || value === 'Loan') return value
  return 'unknown'
}

function actionNode(node: Record<string, unknown>): {
  action: AffectedNodeAction
  body: Record<string, unknown>
} {
  if (isRecord(node.CreatedNode)) return { action: 'created', body: node.CreatedNode }
  if (isRecord(node.ModifiedNode)) return { action: 'modified', body: node.ModifiedNode }
  if (isRecord(node.DeletedNode)) return { action: 'deleted', body: node.DeletedNode }
  throw new Error('AffectedNodes entry must contain CreatedNode, ModifiedNode, or DeletedNode')
}

function stableJson(value: unknown): string | null {
  if (value === undefined) return null
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, sortJson(item)]),
  )
}

function valueType(value: unknown): ObjectChangeValueType {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return 'object'
}

function fieldsFor(action: AffectedNodeAction, body: Record<string, unknown>): {
  before: Record<string, unknown>
  after: Record<string, unknown>
  fieldNames: string[]
} {
  if (action === 'created') {
    const after = requiredRecord(body.NewFields, 'NewFields')
    return { before: {}, after, fieldNames: Object.keys(after) }
  }
  if (action === 'deleted') {
    const before = requiredRecord(body.FinalFields, 'FinalFields')
    return { before, after: {}, fieldNames: Object.keys(before) }
  }

  const previousAvailable = body.PreviousFields !== undefined && body.PreviousFields !== null
  const finalAvailable = body.FinalFields !== undefined && body.FinalFields !== null
  if (!previousAvailable && !finalAvailable) {
    return { before: {}, after: {}, fieldNames: [] }
  }

  const previous = requiredRecord(body.PreviousFields, 'PreviousFields')
  const final = requiredRecord(body.FinalFields, 'FinalFields')
  return { before: previous, after: final, fieldNames: Object.keys(previous) }
}

function relationField(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  field: string,
): string | null {
  return optionalString(after[field]) ?? optionalString(before[field])
}

function assetKey(before: Record<string, unknown>, after: Record<string, unknown>): string | null {
  const value = after.Asset ?? before.Asset
  if (value === undefined) return null
  try {
    return normalizeXrplAsset(value).key
  } catch {
    return null
  }
}

function mptIssuanceId(before: Record<string, unknown>, after: Record<string, unknown>): string | null {
  const direct = relationField(before, after, 'ShareMPTID')
  if (direct) return direct
  const asset = after.Asset ?? before.Asset
  if (isRecord(asset)) return optionalString(asset.mpt_issuance_id)
  return null
}

function relationships(
  objectId: string,
  objectType: AffectedObjectType,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): ObjectChangeRelationships {
  return {
    vaultId: relationField(before, after, 'VaultID') ?? (objectType === 'Vault' ? objectId : null),
    loanBrokerId:
      relationField(before, after, 'LoanBrokerID') ?? (objectType === 'LoanBroker' ? objectId : null),
    loanId: relationField(before, after, 'LoanID') ?? (objectType === 'Loan' ? objectId : null),
    account: relationField(before, after, 'Account'),
    owner: relationField(before, after, 'Owner'),
    borrower: relationField(before, after, 'Borrower'),
    assetKey: assetKey(before, after),
    mptIssuanceId: mptIssuanceId(before, after),
  }
}

function unsupportedField(objectType: AffectedObjectType, fieldName: string): boolean {
  if (objectType === 'unknown') return true
  return !KNOWN_FIELDS[objectType].has(fieldName)
}

export function normalizeAffectedNodes(
  metadata: Record<string, unknown>,
  context: ObjectChangeContext,
): NormalizedObjectChange[] {
  const nodes = metadata.AffectedNodes
  if (!Array.isArray(nodes)) throw new Error('AffectedNodes must be an array')

  const changes: NormalizedObjectChange[] = []
  for (const [nodeIndex, value] of nodes.entries()) {
    const node = requiredRecord(value, 'AffectedNodes entry')
    const { action, body } = actionNode(node)
    const objectId = requiredString(body.LedgerIndex, 'LedgerIndex')
    const type = objectType(body.LedgerEntryType)
    const { before, after, fieldNames } = fieldsFor(action, body)
    const relationIds = relationships(objectId, type, before, after)

    for (const fieldName of [...new Set(fieldNames)].sort()) {
      const beforeValue = before[fieldName]
      const afterValue = after[fieldName]
      if (action === 'modified' && stableJson(beforeValue) === stableJson(afterValue)) continue
      changes.push({
        ...context,
        nodeIndex,
        objectType: type,
        objectId,
        action,
        fieldName,
        beforeValue,
        afterValue,
        beforeJson: stableJson(beforeValue),
        afterJson: stableJson(afterValue),
        valueType: valueType(afterValue ?? beforeValue),
        unsupportedField: unsupportedField(type, fieldName),
        relationships: relationIds,
      })
    }
  }
  return changes
}
