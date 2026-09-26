export type DbLessCurrentProjectionObjectTypeV1 =
  | 'vault'
  | 'loan_broker'
  | 'loan'

const PREFIX = /^projection:(vault|loan_broker|loan):/

function nonEmpty(value: string, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

export function buildDbLessCurrentProjectionCanonicalKey(
  objectType: DbLessCurrentProjectionObjectTypeV1,
  objectId: string,
): string {
  return `projection:${objectType}:${encodeURIComponent(nonEmpty(objectId, 'objectId'))}`
}

export function parseDbLessCurrentProjectionCanonicalKey(
  canonicalKey: string,
  objectId: string,
): DbLessCurrentProjectionObjectTypeV1 {
  const key = nonEmpty(canonicalKey, 'canonicalKey')
  const match = PREFIX.exec(key)
  if (!match) {
    throw new Error('Current projection canonical key is invalid')
  }
  const objectType = match[1] as DbLessCurrentProjectionObjectTypeV1
  if (key !== buildDbLessCurrentProjectionCanonicalKey(objectType, objectId)) {
    throw new Error('Current projection canonical key does not match object identity')
  }
  return objectType
}

export function compareDbLessCurrentProjectionCanonicalKeys(
  left: string,
  right: string,
): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}
