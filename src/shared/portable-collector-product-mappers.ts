import type { NormalizedSemanticClassV1 } from './portable-collector-payload'
import {
  canonicalPortableJson,
  type PortableReferenceRow,
} from './portable-collector-reference-store'

export interface PortableProductProvenanceV1 {
  schemaVersion: 1
  workId: string
  semanticClass: NormalizedSemanticClassV1
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  isTombstone: boolean
  createdAt: string
}

interface PortableProductRecordBaseV1 {
  schemaVersion: 1
  provenance: PortableProductProvenanceV1
}

export interface PortableValidatedLedgerProductV1 extends PortableProductRecordBaseV1 {
  kind: 'validated_ledger'
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  details: Record<string, unknown>
}

export interface PortableProtocolEventProductV1 extends PortableProductRecordBaseV1 {
  kind: 'protocol_event'
  eventId: string
  transactionHash: string
  eventIndex: number
  closeTime: number
  eventType: string
  resultCode: string
  details: Record<string, unknown>
}

export interface PortableObjectChangeProductV1 extends PortableProductRecordBaseV1 {
  kind: 'object_change'
  transactionHash: string
  transactionIndex: number
  closeTime: number
  transactionType: string
  resultCode: string
  nodeIndex: number
  objectType: string
  objectId: string
  action: 'created' | 'modified' | 'deleted'
  fieldName: string
  before: unknown | null
  after: unknown | null
  details: Record<string, unknown>
}

export interface PortableLoanLifecycleProductV1 extends PortableProductRecordBaseV1 {
  kind: 'loan_lifecycle'
  loanId: string
  transactionHash: string
  transactionIndex: number
  closeTime: number
  eventType: string
  transactionType: string
  resultCode: string
  statusBefore: string
  statusAfter: string
  details: Record<string, unknown>
}

export interface PortableArchivedObjectProductV1 extends PortableProductRecordBaseV1 {
  kind: 'archived_object'
  objectType: string
  objectId: string
  deletionTransactionHash: string
  deletionTransactionIndex: number
  deletionCloseTime: number
  deletionReason: string
  finalState: unknown
  details: Record<string, unknown>
}

export interface PortableBalanceHistoryProductV1 extends PortableProductRecordBaseV1 {
  kind: 'balance_history'
  subjectType: string
  subjectId: string
  transactionHash: string
  transactionIndex: number
  closeTime: number
  metricType: string
  assetKey: string | null
  beforeValue: string | null
  afterValue: string | null
  details: Record<string, unknown>
}

export interface PortableCurrentProjectionProductV1 extends PortableProductRecordBaseV1 {
  kind: 'current_projection'
  projectionKind: 'vault' | 'loan_broker' | 'loan'
  objectId: string
  state: 'present' | 'deleted'
  previousTransactionHash: string | null
  previousLedgerIndex: number | null
  projection: Record<string, unknown> | null
}

export type PortableProductRecordV1 =
  | PortableValidatedLedgerProductV1
  | PortableProtocolEventProductV1
  | PortableObjectChangeProductV1
  | PortableLoanLifecycleProductV1
  | PortableArchivedObjectProductV1
  | PortableBalanceHistoryProductV1
  | PortableCurrentProjectionProductV1

export class PortableProductMappingError extends Error {
  constructor(
    readonly code: 'class_mismatch' | 'identity_failure' | 'value_failure',
    message: string,
  ) {
    super(message)
    this.name = 'PortableProductMappingError'
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PortableProductMappingError('value_failure', `${name} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null
  return requireString(value, name)
}

function requireInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PortableProductMappingError(
      'value_failure',
      `${name} must be a non-negative safe integer`,
    )
  }
  return value
}

function requireHash(value: unknown, name: string): string {
  const hash = requireString(value, name).toUpperCase()
  if (!/^[0-9A-F]{64}$/u.test(hash)) {
    throw new PortableProductMappingError(
      'identity_failure',
      `${name} must be a 64-character hexadecimal hash`,
    )
  }
  return hash
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PortableProductMappingError('value_failure', `${name} must be an object`)
  }
  return value as Record<string, unknown>
}

function parseValue(row: PortableReferenceRow): Record<string, unknown> {
  if (row.valueJson === null) {
    throw new PortableProductMappingError(
      'value_failure',
      `${row.semanticClass}/${row.canonicalKey} requires a value`,
    )
  }
  let value: unknown
  try {
    value = JSON.parse(row.valueJson)
  } catch {
    throw new PortableProductMappingError('value_failure', 'valueJson is not valid JSON')
  }
  if (canonicalPortableJson(value) !== row.valueJson) {
    throw new PortableProductMappingError('value_failure', 'valueJson is not canonical JSON')
  }
  return requireObject(value, 'valueJson')
}

function requireTransactionHash(row: PortableReferenceRow): string {
  if (row.sourceTransactionHash === null) {
    throw new PortableProductMappingError(
      'identity_failure',
      `${row.semanticClass}/${row.canonicalKey} requires a transaction hash`,
    )
  }
  return requireHash(row.sourceTransactionHash, 'sourceTransactionHash')
}

function requireObjectId(row: PortableReferenceRow): string {
  if (row.objectId === null) {
    throw new PortableProductMappingError(
      'identity_failure',
      `${row.semanticClass}/${row.canonicalKey} requires an object ID`,
    )
  }
  return requireString(row.objectId, 'objectId')
}

function provenance(
  row: PortableReferenceRow,
  semanticClass: NormalizedSemanticClassV1,
): PortableProductProvenanceV1 {
  if (row.semanticClass !== semanticClass) {
    throw new PortableProductMappingError(
      'class_mismatch',
      `expected ${semanticClass}, received ${row.semanticClass}`,
    )
  }
  const sourceLedgerHash = requireHash(row.sourceLedgerHash, 'sourceLedgerHash')
  if (sourceLedgerHash !== row.sourceLedgerHash) {
    throw new PortableProductMappingError(
      'identity_failure',
      'sourceLedgerHash is not canonical uppercase',
    )
  }
  const relationshipIds = [...new Set(row.relationshipIds)].sort((left, right) =>
    left.localeCompare(right),
  )
  if (
    relationshipIds.some((relationshipId) => !relationshipId.trim()) ||
    canonicalPortableJson(relationshipIds) !== canonicalPortableJson(row.relationshipIds)
  ) {
    throw new PortableProductMappingError(
      'identity_failure',
      'relationshipIds are not canonical',
    )
  }
  if (row.sourceTransactionHash !== null) {
    const transactionHash = requireHash(row.sourceTransactionHash, 'sourceTransactionHash')
    if (transactionHash !== row.sourceTransactionHash) {
      throw new PortableProductMappingError(
        'identity_failure',
        'sourceTransactionHash is not canonical uppercase',
      )
    }
  }
  return {
    schemaVersion: 1,
    workId: requireString(row.workId, 'workId'),
    semanticClass,
    canonicalKey: requireString(row.canonicalKey, 'canonicalKey'),
    sourceLedgerIndex: requireInteger(row.sourceLedgerIndex, 'sourceLedgerIndex'),
    sourceLedgerHash,
    sourceTransactionHash: row.sourceTransactionHash,
    objectId: row.objectId === null ? null : requireString(row.objectId, 'objectId'),
    relationshipIds,
    isTombstone: row.isTombstone,
    createdAt: requireString(row.createdAt, 'createdAt'),
  }
}

export function mapValidatedLedgerProduct(
  row: PortableReferenceRow,
): PortableValidatedLedgerProductV1 {
  const source = provenance(row, 'validated-ledger')
  if (source.sourceTransactionHash !== null || source.objectId !== null || source.isTombstone) {
    throw new PortableProductMappingError(
      'identity_failure',
      'validated ledger identity contains transaction, object, or tombstone state',
    )
  }
  const details = parseValue(row)
  const ledgerIndex = requireInteger(details.ledgerIndex, 'ledgerIndex')
  const ledgerHash = requireHash(details.ledgerHash, 'ledgerHash')
  const parentHash = requireHash(details.parentHash, 'parentHash')
  if (ledgerIndex !== row.sourceLedgerIndex || ledgerHash !== row.sourceLedgerHash) {
    throw new PortableProductMappingError(
      'identity_failure',
      'validated ledger value does not match row identity',
    )
  }
  return {
    schemaVersion: 1,
    kind: 'validated_ledger',
    provenance: source,
    ledgerIndex,
    ledgerHash,
    parentHash,
    details,
  }
}

export function mapProtocolEventProduct(
  row: PortableReferenceRow,
): PortableProtocolEventProductV1 {
  const source = provenance(row, 'protocol-event')
  const details = parseValue(row)
  return {
    schemaVersion: 1,
    kind: 'protocol_event',
    provenance: source,
    eventId: source.canonicalKey,
    transactionHash: requireTransactionHash(row),
    eventIndex: requireInteger(details.eventIndex, 'eventIndex'),
    closeTime: requireInteger(details.closeTime, 'closeTime'),
    eventType: requireString(details.eventType, 'eventType'),
    resultCode: requireString(details.resultCode, 'resultCode'),
    details,
  }
}

export function mapObjectChangeProduct(
  row: PortableReferenceRow,
): PortableObjectChangeProductV1 {
  const source = provenance(row, 'object-change')
  const details = parseValue(row)
  const action = requireString(details.action, 'action')
  if (!['created', 'modified', 'deleted'].includes(action)) {
    throw new PortableProductMappingError('value_failure', `unknown object action: ${action}`)
  }
  const objectId = requireObjectId(row)
  if (optionalString(details.objectId, 'value.objectId') !== objectId) {
    throw new PortableProductMappingError(
      'identity_failure',
      'object-change value objectId does not match row identity',
    )
  }
  return {
    schemaVersion: 1,
    kind: 'object_change',
    provenance: source,
    transactionHash: requireTransactionHash(row),
    transactionIndex: requireInteger(details.transactionIndex, 'transactionIndex'),
    closeTime: requireInteger(details.closeTime, 'closeTime'),
    transactionType: requireString(details.transactionType, 'transactionType'),
    resultCode: requireString(details.resultCode, 'resultCode'),
    nodeIndex: requireInteger(details.nodeIndex, 'nodeIndex'),
    objectType: requireString(details.objectType, 'objectType'),
    objectId,
    action: action as 'created' | 'modified' | 'deleted',
    fieldName: requireString(details.fieldName, 'fieldName'),
    before: details.beforeJson ?? null,
    after: details.afterJson ?? null,
    details,
  }
}

export function mapLoanLifecycleProduct(
  row: PortableReferenceRow,
): PortableLoanLifecycleProductV1 {
  const source = provenance(row, 'loan-lifecycle')
  const details = parseValue(row)
  const loanId = requireObjectId(row)
  if (optionalString(details.loanId, 'value.loanId') !== loanId) {
    throw new PortableProductMappingError(
      'identity_failure',
      'loan-lifecycle value loanId does not match row identity',
    )
  }
  return {
    schemaVersion: 1,
    kind: 'loan_lifecycle',
    provenance: source,
    loanId,
    transactionHash: requireTransactionHash(row),
    transactionIndex: requireInteger(details.transactionIndex, 'transactionIndex'),
    closeTime: requireInteger(details.closeTime, 'closeTime'),
    eventType: requireString(details.eventType, 'eventType'),
    transactionType: requireString(details.transactionType, 'transactionType'),
    resultCode: requireString(details.resultCode, 'resultCode'),
    statusBefore: requireString(details.statusBefore, 'statusBefore'),
    statusAfter: requireString(details.statusAfter, 'statusAfter'),
    details,
  }
}

export function mapArchivedObjectProduct(
  row: PortableReferenceRow,
): PortableArchivedObjectProductV1 {
  const source = provenance(row, 'archived-object')
  const details = parseValue(row)
  const objectId = requireObjectId(row)
  if (optionalString(details.objectId, 'value.objectId') !== objectId) {
    throw new PortableProductMappingError(
      'identity_failure',
      'archived-object value objectId does not match row identity',
    )
  }
  if (!('finalStateJson' in details)) {
    throw new PortableProductMappingError(
      'value_failure',
      'archived-object finalStateJson is required',
    )
  }
  return {
    schemaVersion: 1,
    kind: 'archived_object',
    provenance: source,
    objectType: requireString(details.objectType, 'objectType'),
    objectId,
    deletionTransactionHash: requireTransactionHash(row),
    deletionTransactionIndex: requireInteger(
      details.deletionTransactionIndex,
      'deletionTransactionIndex',
    ),
    deletionCloseTime: requireInteger(details.deletionCloseTime, 'deletionCloseTime'),
    deletionReason: requireString(details.deletionReason, 'deletionReason'),
    finalState: details.finalStateJson,
    details,
  }
}

export function mapBalanceHistoryProduct(
  row: PortableReferenceRow,
): PortableBalanceHistoryProductV1 {
  const source = provenance(row, 'balance-history')
  const details = parseValue(row)
  return {
    schemaVersion: 1,
    kind: 'balance_history',
    provenance: source,
    subjectType: requireString(details.subjectType, 'subjectType'),
    subjectId: requireString(details.subjectId, 'subjectId'),
    transactionHash: requireTransactionHash(row),
    transactionIndex: requireInteger(details.transactionIndex, 'transactionIndex'),
    closeTime: requireInteger(details.closeTime, 'closeTime'),
    metricType: requireString(details.metricType, 'metricType'),
    assetKey: optionalString(details.assetKey, 'assetKey'),
    beforeValue: optionalString(details.beforeValue, 'beforeValue'),
    afterValue: optionalString(details.afterValue, 'afterValue'),
    details,
  }
}

export function mapCurrentProjectionProduct(
  row: PortableReferenceRow,
): PortableCurrentProjectionProductV1 {
  const source = provenance(row, 'current-projection')
  const objectId = requireObjectId(row)
  if (row.isTombstone) {
    if (row.valueJson !== null) {
      throw new PortableProductMappingError(
        'value_failure',
        'current projection tombstone must have a null value',
      )
    }
    return {
      schemaVersion: 1,
      kind: 'current_projection',
      provenance: source,
      projectionKind: projectionKindFromRelationships(row.relationshipIds),
      objectId,
      state: 'deleted',
      previousTransactionHash: row.sourceTransactionHash,
      previousLedgerIndex: row.sourceLedgerIndex,
      projection: null,
    }
  }

  const projection = parseValue(row)
  const kind = requireString(projection.kind, 'projection.kind')
  if (!['vault', 'loan_broker', 'loan'].includes(kind)) {
    throw new PortableProductMappingError(
      'value_failure',
      `unknown current projection kind: ${kind}`,
    )
  }
  if (requireString(projection.id, 'projection.id') !== objectId) {
    throw new PortableProductMappingError(
      'identity_failure',
      'current projection value id does not match row identity',
    )
  }
  const previousTransactionHash = optionalString(
    projection.previousTxHash,
    'projection.previousTxHash',
  )
  if (
    previousTransactionHash !== null &&
    requireHash(previousTransactionHash, 'projection.previousTxHash') !==
      row.sourceTransactionHash
  ) {
    throw new PortableProductMappingError(
      'identity_failure',
      'current projection previous transaction does not match row identity',
    )
  }
  const previousLedgerIndex = requireInteger(
    projection.previousLedgerIndex,
    'projection.previousLedgerIndex',
  )
  if (previousLedgerIndex !== row.sourceLedgerIndex) {
    throw new PortableProductMappingError(
      'identity_failure',
      'current projection previous ledger does not match row identity',
    )
  }
  return {
    schemaVersion: 1,
    kind: 'current_projection',
    provenance: source,
    projectionKind: kind as 'vault' | 'loan_broker' | 'loan',
    objectId,
    state: 'present',
    previousTransactionHash,
    previousLedgerIndex,
    projection,
  }
}

function projectionKindFromRelationships(
  relationshipIds: readonly string[],
): 'vault' | 'loan_broker' | 'loan' {
  if (relationshipIds.some((relationshipId) => relationshipId.startsWith('vault:'))) {
    return 'vault'
  }
  if (relationshipIds.some((relationshipId) => relationshipId.startsWith('broker:'))) {
    return 'loan_broker'
  }
  return 'loan'
}

export function mapPortableProductRow(row: PortableReferenceRow): PortableProductRecordV1 {
  switch (row.semanticClass) {
    case 'validated-ledger':
      return mapValidatedLedgerProduct(row)
    case 'protocol-event':
      return mapProtocolEventProduct(row)
    case 'object-change':
      return mapObjectChangeProduct(row)
    case 'loan-lifecycle':
      return mapLoanLifecycleProduct(row)
    case 'archived-object':
      return mapArchivedObjectProduct(row)
    case 'balance-history':
      return mapBalanceHistoryProduct(row)
    case 'current-projection':
      return mapCurrentProjectionProduct(row)
    default:
      throw new PortableProductMappingError(
        'class_mismatch',
        `unsupported semantic class: ${String(row.semanticClass)}`,
      )
  }
}
