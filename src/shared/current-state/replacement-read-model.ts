export type ReplacementReadKind = 'vault' | 'loan-broker' | 'loan'
export type ReplacementMutationObjectType = 'vault' | 'loan_broker' | 'loan'

export type ReplacementProjectionMutation =
  | {
      operation: 'upsert'
      objectType: ReplacementMutationObjectType
      objectId: string
      projectionJson: string
    }
  | {
      operation: 'deleted'
      objectType: ReplacementMutationObjectType
      objectId: string
    }

export interface ReplacementProjectionMutationEnvelope {
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
  mutation: ReplacementProjectionMutation
}

export interface PreparedReplacementMutation {
  operation: 'upsert' | 'deleted'
  readKind: ReplacementReadKind
  objectId: string
  projectionJson: string | null
  ledgerIndex: number
  ledgerHash: string
  transactionHash: string
  transactionIndex: number
}

const HASH = /^[A-F0-9]{64}$/

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be non-empty`)
  return value
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${field} must be a positive safe integer`)
  return Number(value)
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${field} must be a non-negative safe integer`)
  return Number(value)
}

function hash(value: unknown, field: string): string {
  const normalized = string(value, field).toUpperCase()
  if (!HASH.test(normalized)) throw new Error(`${field} must be a 64-character hexadecimal hash`)
  return normalized
}

function objectType(value: unknown): ReplacementMutationObjectType {
  if (value === 'vault' || value === 'loan_broker' || value === 'loan') return value
  throw new Error('mutation.objectType is invalid')
}

export function replacementReadKind(type: ReplacementMutationObjectType): ReplacementReadKind {
  return type === 'loan_broker' ? 'loan-broker' : type
}

function expectedProjectionKind(type: ReplacementMutationObjectType): string {
  return type
}

export function prepareReplacementMutation(value: unknown): PreparedReplacementMutation {
  const envelope = record(value, 'mutation envelope')
  const mutation = record(envelope.mutation, 'mutation')
  const operation = mutation.operation
  if (operation !== 'upsert' && operation !== 'deleted') throw new Error('mutation.operation is invalid')

  const type = objectType(mutation.objectType)
  const objectId = hash(mutation.objectId, 'mutation.objectId')
  const ledgerIndex = positiveInteger(envelope.ledgerIndex, 'ledgerIndex')
  const ledgerHash = hash(envelope.ledgerHash, 'ledgerHash')
  const transactionHash = hash(envelope.transactionHash, 'transactionHash')
  const transactionIndex = nonNegativeInteger(envelope.transactionIndex, 'transactionIndex')

  if (operation === 'deleted') {
    if (mutation.projectionJson !== undefined) throw new Error('deleted mutation must not carry projectionJson')
    return {
      operation,
      readKind: replacementReadKind(type),
      objectId,
      projectionJson: null,
      ledgerIndex,
      ledgerHash,
      transactionHash,
      transactionIndex,
    }
  }

  const projectionJson = string(mutation.projectionJson, 'mutation.projectionJson')
  const projection = record(JSON.parse(projectionJson), 'mutation projection')
  if (hash(projection.id, 'projection.id') !== objectId) {
    throw new Error('mutation projection id does not match objectId')
  }
  if (projection.kind !== expectedProjectionKind(type)) {
    throw new Error('mutation projection kind does not match objectType')
  }

  return {
    operation,
    readKind: replacementReadKind(type),
    objectId,
    projectionJson,
    ledgerIndex,
    ledgerHash,
    transactionHash,
    transactionIndex,
  }
}

export function compareReplacementMutationPosition(
  left: Pick<PreparedReplacementMutation, 'ledgerIndex' | 'transactionIndex'>,
  right: Pick<PreparedReplacementMutation, 'ledgerIndex' | 'transactionIndex'>,
): number {
  return left.ledgerIndex - right.ledgerIndex || left.transactionIndex - right.transactionIndex
}
