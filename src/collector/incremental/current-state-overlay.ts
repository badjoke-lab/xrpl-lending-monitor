import { normalizeXrplAsset } from '../../domain/asset/amount'
import type {
  LoanBrokerCurrentProjection,
  LoanCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import { canonicalJson } from '../../shared/current-state/canonical-json'
import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
} from '../current-state/normalize-current-objects'
import type { ScannedLedgerObject } from '../current-state/scan-ledger-objects'
import type {
  CurrentStateOverlayMutation,
  CurrentStateOverlayObjectType,
} from '../../worker/repositories/current-state-overlay'

interface OverlayDerivationContext {
  ledgerIndex: number
  transactionHash: string
}

type LendingLedgerEntryType = 'Vault' | 'LoanBroker' | 'Loan'

type NormalizedProjection =
  | VaultCurrentProjection
  | LoanBrokerCurrentProjection
  | LoanCurrentProjection

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

function lendingType(value: unknown): LendingLedgerEntryType | null {
  if (value === 'Vault' || value === 'LoanBroker' || value === 'Loan') return value
  return null
}

function overlayObjectType(type: LendingLedgerEntryType): CurrentStateOverlayObjectType {
  if (type === 'Vault') return 'vault'
  if (type === 'LoanBroker') return 'loan_broker'
  return 'loan'
}

function projectionObject(options: {
  type: LendingLedgerEntryType
  objectId: string
  fields: Record<string, unknown>
  context: OverlayDerivationContext
}): ScannedLedgerObject {
  return {
    ...options.fields,
    LedgerEntryType: options.type,
    index: options.objectId,
    PreviousTxnID: options.context.transactionHash,
    PreviousTxnLgrSeq: options.context.ledgerIndex,
  } as ScannedLedgerObject
}

function normalizeProjection(object: ScannedLedgerObject): NormalizedProjection {
  if (object.LedgerEntryType === 'Vault') return normalizeVault(object)
  if (object.LedgerEntryType === 'LoanBroker') return normalizeLoanBroker(object)
  return normalizeLoan(object)
}

function relationshipsForProjection(projection: NormalizedProjection) {
  if (projection.kind === 'vault') {
    return {
      owner: projection.owner,
      account: projection.account,
      assetKey: projection.asset.key,
    }
  }
  if (projection.kind === 'loan_broker') {
    return {
      owner: projection.owner,
      account: projection.account,
      vaultId: projection.vaultId,
    }
  }
  return {
    borrower: projection.borrower,
    loanBrokerId: projection.loanBrokerId,
    onLedgerStatus: projection.onLedgerStatus,
  }
}

function tombstoneRelationships(
  type: LendingLedgerEntryType,
  fields: Record<string, unknown>,
) {
  let assetKey: string | null = null
  if (type === 'Vault' && fields.Asset !== undefined) {
    try {
      assetKey = normalizeXrplAsset(fields.Asset).key
    } catch {
      assetKey = null
    }
  }

  return {
    owner: optionalString(fields.Owner),
    account: optionalString(fields.Account),
    borrower: optionalString(fields.Borrower),
    vaultId: optionalString(fields.VaultID),
    loanBrokerId: optionalString(fields.LoanBrokerID),
    assetKey,
  }
}

function actionBody(node: Record<string, unknown>): {
  action: 'created' | 'modified' | 'deleted'
  body: Record<string, unknown>
} {
  if (isRecord(node.CreatedNode)) return { action: 'created', body: node.CreatedNode }
  if (isRecord(node.ModifiedNode)) return { action: 'modified', body: node.ModifiedNode }
  if (isRecord(node.DeletedNode)) return { action: 'deleted', body: node.DeletedNode }
  throw new Error('AffectedNodes entry must contain CreatedNode, ModifiedNode, or DeletedNode')
}

export function deriveCurrentStateOverlayMutations(
  metadata: Record<string, unknown>,
  context: OverlayDerivationContext,
): CurrentStateOverlayMutation[] {
  const nodes = metadata.AffectedNodes
  if (!Array.isArray(nodes)) throw new Error('AffectedNodes must be an array')

  const mutations: CurrentStateOverlayMutation[] = []
  for (const [index, value] of nodes.entries()) {
    const node = requiredRecord(value, `AffectedNodes[${index}]`)
    const { action, body } = actionBody(node)
    const type = lendingType(body.LedgerEntryType)
    if (!type) continue

    const objectId = requiredString(body.LedgerIndex, 'LedgerIndex')
    const objectType = overlayObjectType(type)

    if (action === 'deleted') {
      const finalFields = requiredRecord(body.FinalFields, 'FinalFields')
      mutations.push({
        operation: 'deleted',
        objectType,
        objectId,
        relationships: tombstoneRelationships(type, finalFields),
      })
      continue
    }

    const fields = requiredRecord(
      action === 'created' ? body.NewFields : body.FinalFields,
      action === 'created' ? 'NewFields' : 'FinalFields',
    )
    const projection = normalizeProjection(
      projectionObject({ type, objectId, fields, context }),
    )
    mutations.push({
      operation: 'upsert',
      objectType,
      objectId,
      projectionJson: canonicalJson(projection),
      relationships: relationshipsForProjection(projection),
    })
  }

  return mutations
}
