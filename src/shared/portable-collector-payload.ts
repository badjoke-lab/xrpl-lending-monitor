import { canonicalPortableJson } from './portable-collector-reference-store'

export const NORMALIZED_COLLECTOR_PAYLOAD_SCHEMA_VERSION = 1 as const
export const NORMALIZED_PAYLOAD_CHUNK_MAX_RECORDS = 40
export const NORMALIZED_PAYLOAD_CHUNK_MAX_BYTES = 512_000
const SHA256_PREFIX = 'sha256:'
const SHA256_HEX_LENGTH = 64

export type PortableJsonPrimitive = null | boolean | number | string
export type PortableJsonValue =
  | PortableJsonPrimitive
  | PortableJsonValue[]
  | { [key: string]: PortableJsonValue }

export type NormalizedSemanticClassV1 =
  | 'validated-ledger'
  | 'protocol-event'
  | 'object-change'
  | 'loan-lifecycle'
  | 'archived-object'
  | 'balance-history'
  | 'current-projection'

export interface ValidatedLedgerValueV1 {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
}

export interface NormalizedCandidateV1 {
  semanticClass: NormalizedSemanticClassV1
  canonicalKey: string
  sourceLedgerIndex: number
  sourceLedgerHash: string
  sourceTransactionHash: string | null
  objectId: string | null
  relationshipIds: string[]
  isTombstone: boolean
  value: PortableJsonValue
}

export interface SemanticCountsV1 {
  validatedLedgers: number
  protocolEvents: number
  objectChanges: number
  loanLifecycleEvents: number
  archivedObjects: number
  balanceHistory: number
  currentProjectionMutations: number
  totalRecords: number
}

export interface NormalizedCollectorPayloadV1 {
  schemaVersion: 1
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  endLedgerIndex: number
  finalLedgerHash: string
  ledgers: NormalizedCandidateV1[]
  protocolEvents: NormalizedCandidateV1[]
  objectChanges: NormalizedCandidateV1[]
  loanLifecycleEvents: NormalizedCandidateV1[]
  archivedObjects: NormalizedCandidateV1[]
  balanceHistory: NormalizedCandidateV1[]
  currentProjectionMutations: NormalizedCandidateV1[]
  semanticCounts: SemanticCountsV1
  digest: string
}

export interface BuildNormalizedCollectorPayloadInput {
  workId: string
  network: string
  epochId: string
  baseIdentity: string
  previousLedgerIndex: number
  expectedParentHash: string
  startLedgerIndex: number
  endLedgerIndex: number
  finalLedgerHash: string
  ledgers: NormalizedCandidateV1[]
  protocolEvents: NormalizedCandidateV1[]
  objectChanges: NormalizedCandidateV1[]
  loanLifecycleEvents: NormalizedCandidateV1[]
  archivedObjects: NormalizedCandidateV1[]
  balanceHistory: NormalizedCandidateV1[]
  currentProjectionMutations: NormalizedCandidateV1[]
}

export interface NormalizedPayloadChunkV1 {
  schemaVersion: 1
  workId: string
  chunkIndex: number
  totalChunks: number
  payloadDigest: string
  records: NormalizedCandidateV1[]
  chunkDigest: string
}

export interface BuiltNormalizedPayloadChunkV1 {
  chunk: NormalizedPayloadChunkV1
  encodedJson: string
  encoded: Uint8Array
}

export interface NormalizedPayloadChunkLimits {
  maxRecords: number
  maxEncodedBytes: number
}

export class PortablePayloadValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortablePayloadValidationError'
  }
}

export class PortablePayloadResourceHaltError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PortablePayloadResourceHaltError'
  }
}

const GROUPS = [
  ['ledgers', 'validated-ledger'],
  ['protocolEvents', 'protocol-event'],
  ['objectChanges', 'object-change'],
  ['loanLifecycleEvents', 'loan-lifecycle'],
  ['archivedObjects', 'archived-object'],
  ['balanceHistory', 'balance-history'],
  ['currentProjectionMutations', 'current-projection'],
] as const

const SEMANTIC_CLASS_ORDER: Record<NormalizedSemanticClassV1, number> = {
  'validated-ledger': 0,
  'protocol-event': 1,
  'object-change': 2,
  'loan-lifecycle': 3,
  'archived-object': 4,
  'balance-history': 5,
  'current-projection': 6,
}

const CANDIDATE_KEYS = [
  'semanticClass',
  'canonicalKey',
  'sourceLedgerIndex',
  'sourceLedgerHash',
  'sourceTransactionHash',
  'objectId',
  'relationshipIds',
  'isTombstone',
  'value',
].sort()

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PortablePayloadValidationError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function optionalString(value: unknown, name: string): string | null {
  if (value === null) return null
  return requiredString(value, name)
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new PortablePayloadValidationError(`${name} must be a non-negative safe integer`)
  }
  return value
}

function positiveInteger(value: unknown, name: string): number {
  const normalized = nonNegativeInteger(value, name)
  if (normalized < 1) {
    throw new PortablePayloadValidationError(`${name} must be a positive safe integer`)
  }
  return normalized
}

function canonicalHash(value: unknown, name: string): string {
  return requiredString(value, name).toUpperCase()
}

function exactCandidateKeys(candidate: object): void {
  const actual = Object.keys(candidate).sort()
  if (
    actual.length !== CANDIDATE_KEYS.length ||
    actual.some((key, index) => key !== CANDIDATE_KEYS[index])
  ) {
    throw new PortablePayloadValidationError('candidate fields are invalid')
  }
}

function normalizePortableJsonValue(value: unknown, path = 'value'): PortableJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new PortablePayloadValidationError(`${path} must contain only finite numbers`)
    }
    return value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => normalizePortableJsonValue(entry, `${path}[${index}]`))
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new PortablePayloadValidationError(`${path} must contain only plain objects`)
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizePortableJsonValue(entry, `${path}.${key}`)]),
    )
  }
  throw new PortablePayloadValidationError(`${path} is not portable JSON`)
}

function compareCandidates(left: NormalizedCandidateV1, right: NormalizedCandidateV1): number {
  return (
    left.sourceLedgerIndex - right.sourceLedgerIndex ||
    SEMANTIC_CLASS_ORDER[left.semanticClass] - SEMANTIC_CLASS_ORDER[right.semanticClass] ||
    left.canonicalKey.localeCompare(right.canonicalKey) ||
    (left.sourceTransactionHash ?? '').localeCompare(right.sourceTransactionHash ?? '')
  )
}

function requiresTransactionIdentity(semanticClass: NormalizedSemanticClassV1): boolean {
  return semanticClass !== 'validated-ledger'
}

function requiresObjectIdentity(semanticClass: NormalizedSemanticClassV1): boolean {
  return (
    semanticClass === 'object-change' ||
    semanticClass === 'loan-lifecycle' ||
    semanticClass === 'archived-object' ||
    semanticClass === 'current-projection'
  )
}

function normalizeCandidate(
  candidate: NormalizedCandidateV1,
  expectedClass: NormalizedSemanticClassV1,
  startLedgerIndex: number,
  endLedgerIndex: number,
): NormalizedCandidateV1 {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new PortablePayloadValidationError('candidate must be an object')
  }
  exactCandidateKeys(candidate)
  if (candidate.semanticClass !== expectedClass) {
    throw new PortablePayloadValidationError(
      `candidate semantic class mismatch: expected ${expectedClass}, received ${String(candidate.semanticClass)}`,
    )
  }
  const sourceLedgerIndex = nonNegativeInteger(
    candidate.sourceLedgerIndex,
    'candidate.sourceLedgerIndex',
  )
  if (sourceLedgerIndex < startLedgerIndex || sourceLedgerIndex > endLedgerIndex) {
    throw new PortablePayloadValidationError(
      `candidate source ledger ${sourceLedgerIndex} is outside ${startLedgerIndex}-${endLedgerIndex}`,
    )
  }
  if (!Array.isArray(candidate.relationshipIds)) {
    throw new PortablePayloadValidationError('candidate.relationshipIds must be an array')
  }
  if (typeof candidate.isTombstone !== 'boolean') {
    throw new PortablePayloadValidationError('candidate.isTombstone must be a boolean')
  }

  const sourceTransactionHash =
    candidate.sourceTransactionHash === null
      ? null
      : canonicalHash(candidate.sourceTransactionHash, 'candidate.sourceTransactionHash')
  const objectId = optionalString(candidate.objectId, 'candidate.objectId')
  if (requiresTransactionIdentity(expectedClass) && sourceTransactionHash === null) {
    throw new PortablePayloadValidationError(
      `${expectedClass} candidate requires a source transaction hash`,
    )
  }
  if (requiresObjectIdentity(expectedClass) && objectId === null) {
    throw new PortablePayloadValidationError(`${expectedClass} candidate requires an object ID`)
  }
  if (expectedClass === 'validated-ledger' && (sourceTransactionHash !== null || objectId !== null)) {
    throw new PortablePayloadValidationError(
      'validated ledger identity must not contain transaction or object identity',
    )
  }

  const relationshipIds = [
    ...new Set(
      candidate.relationshipIds.map((relationshipId) =>
        requiredString(relationshipId, 'candidate.relationshipIds[]'),
      ),
    ),
  ].sort((left, right) => left.localeCompare(right))

  return {
    semanticClass: expectedClass,
    canonicalKey: requiredString(candidate.canonicalKey, 'candidate.canonicalKey'),
    sourceLedgerIndex,
    sourceLedgerHash: canonicalHash(
      candidate.sourceLedgerHash,
      'candidate.sourceLedgerHash',
    ),
    sourceTransactionHash,
    objectId,
    relationshipIds,
    isTombstone: candidate.isTombstone,
    value: normalizePortableJsonValue(candidate.value),
  }
}

function normalizeGroup(
  candidates: NormalizedCandidateV1[],
  expectedClass: NormalizedSemanticClassV1,
  startLedgerIndex: number,
  endLedgerIndex: number,
): NormalizedCandidateV1[] {
  if (!Array.isArray(candidates)) {
    throw new PortablePayloadValidationError(`${expectedClass} candidates must be an array`)
  }
  return candidates
    .map((candidate) =>
      normalizeCandidate(candidate, expectedClass, startLedgerIndex, endLedgerIndex),
    )
    .sort(compareCandidates)
}

function semanticCounts(groups: {
  ledgers: NormalizedCandidateV1[]
  protocolEvents: NormalizedCandidateV1[]
  objectChanges: NormalizedCandidateV1[]
  loanLifecycleEvents: NormalizedCandidateV1[]
  archivedObjects: NormalizedCandidateV1[]
  balanceHistory: NormalizedCandidateV1[]
  currentProjectionMutations: NormalizedCandidateV1[]
}): SemanticCountsV1 {
  const counts = {
    validatedLedgers: groups.ledgers.length,
    protocolEvents: groups.protocolEvents.length,
    objectChanges: groups.objectChanges.length,
    loanLifecycleEvents: groups.loanLifecycleEvents.length,
    archivedObjects: groups.archivedObjects.length,
    balanceHistory: groups.balanceHistory.length,
    currentProjectionMutations: groups.currentProjectionMutations.length,
  }
  return {
    ...counts,
    totalRecords: Object.values(counts).reduce((total, count) => total + count, 0),
  }
}

function asLedgerValue(candidate: NormalizedCandidateV1): ValidatedLedgerValueV1 {
  if (!candidate.value || typeof candidate.value !== 'object' || Array.isArray(candidate.value)) {
    throw new PortablePayloadValidationError('validated ledger value must be an object')
  }
  const value = candidate.value as Record<string, PortableJsonValue>
  return {
    ledgerIndex: nonNegativeInteger(value.ledgerIndex, 'ledger.value.ledgerIndex'),
    ledgerHash: canonicalHash(value.ledgerHash, 'ledger.value.ledgerHash'),
    parentHash: canonicalHash(value.parentHash, 'ledger.value.parentHash'),
  }
}

function validateLedgerChain(
  ledgers: NormalizedCandidateV1[],
  startLedgerIndex: number,
  endLedgerIndex: number,
  expectedParentHash: string,
  finalLedgerHash: string,
): Map<number, string> {
  const expectedCount = endLedgerIndex - startLedgerIndex + 1
  if (ledgers.length !== expectedCount) {
    throw new PortablePayloadValidationError(
      `validated ledger count mismatch: expected ${expectedCount}, received ${ledgers.length}`,
    )
  }

  const ledgerHashes = new Map<number, string>()
  let previousHash = expectedParentHash
  for (let offset = 0; offset < ledgers.length; offset += 1) {
    const candidate = ledgers[offset]!
    const expectedLedgerIndex = startLedgerIndex + offset
    const value = asLedgerValue(candidate)
    if (candidate.sourceLedgerIndex !== expectedLedgerIndex || value.ledgerIndex !== expectedLedgerIndex) {
      throw new PortablePayloadValidationError(
        `validated ledger sequence mismatch at ${expectedLedgerIndex}`,
      )
    }
    if (candidate.sourceLedgerHash !== value.ledgerHash) {
      throw new PortablePayloadValidationError(
        `validated ledger hash mismatch at ${expectedLedgerIndex}`,
      )
    }
    if (value.parentHash !== previousHash) {
      throw new PortablePayloadValidationError(
        `validated ledger parent hash mismatch at ${expectedLedgerIndex}`,
      )
    }
    previousHash = value.ledgerHash
    ledgerHashes.set(expectedLedgerIndex, value.ledgerHash)
  }

  if (previousHash !== finalLedgerHash) {
    throw new PortablePayloadValidationError('final ledger hash does not match ledger evidence')
  }
  return ledgerHashes
}

function validateCandidateSourceHashes(
  groups: readonly NormalizedCandidateV1[][],
  ledgerHashes: ReadonlyMap<number, string>,
): void {
  for (const candidate of groups.flat()) {
    const expectedHash = ledgerHashes.get(candidate.sourceLedgerIndex)
    if (!expectedHash || candidate.sourceLedgerHash !== expectedHash) {
      throw new PortablePayloadValidationError(
        `candidate source ledger hash mismatch: ${candidate.semanticClass}/${candidate.canonicalKey}`,
      )
    }
  }
}

function validateCandidateUniqueness(groups: readonly NormalizedCandidateV1[][]): void {
  const identities = new Set<string>()
  for (const candidate of groups.flat()) {
    const identity = `${candidate.semanticClass}\u0000${candidate.canonicalKey}`
    if (identities.has(identity)) {
      throw new PortablePayloadValidationError(
        `duplicate candidate identity: ${candidate.semanticClass}/${candidate.canonicalKey}`,
      )
    }
    identities.add(identity)
  }
}

export async function sha256PortableJson(value: unknown): Promise<string> {
  const cryptoImplementation = globalThis.crypto
  if (!cryptoImplementation?.subtle) {
    throw new PortablePayloadValidationError('standards-based SHA-256 is unavailable')
  }
  const encoded = new TextEncoder().encode(canonicalPortableJson(value))
  const digest = await cryptoImplementation.subtle.digest('SHA-256', encoded)
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
  return `${SHA256_PREFIX}${hex}`
}

export async function buildNormalizedCollectorPayload(
  input: BuildNormalizedCollectorPayloadInput,
): Promise<NormalizedCollectorPayloadV1> {
  const previousLedgerIndex = nonNegativeInteger(
    input.previousLedgerIndex,
    'previousLedgerIndex',
  )
  const startLedgerIndex = positiveInteger(input.startLedgerIndex, 'startLedgerIndex')
  const endLedgerIndex = positiveInteger(input.endLedgerIndex, 'endLedgerIndex')
  if (startLedgerIndex !== previousLedgerIndex + 1) {
    throw new PortablePayloadValidationError(
      'startLedgerIndex must immediately follow previousLedgerIndex',
    )
  }
  if (endLedgerIndex < startLedgerIndex) {
    throw new PortablePayloadValidationError('endLedgerIndex must not precede startLedgerIndex')
  }

  const expectedParentHash = canonicalHash(input.expectedParentHash, 'expectedParentHash')
  const finalLedgerHash = canonicalHash(input.finalLedgerHash, 'finalLedgerHash')
  const normalizedGroups = {
    ledgers: normalizeGroup(
      input.ledgers,
      'validated-ledger',
      startLedgerIndex,
      endLedgerIndex,
    ),
    protocolEvents: normalizeGroup(
      input.protocolEvents,
      'protocol-event',
      startLedgerIndex,
      endLedgerIndex,
    ),
    objectChanges: normalizeGroup(
      input.objectChanges,
      'object-change',
      startLedgerIndex,
      endLedgerIndex,
    ),
    loanLifecycleEvents: normalizeGroup(
      input.loanLifecycleEvents,
      'loan-lifecycle',
      startLedgerIndex,
      endLedgerIndex,
    ),
    archivedObjects: normalizeGroup(
      input.archivedObjects,
      'archived-object',
      startLedgerIndex,
      endLedgerIndex,
    ),
    balanceHistory: normalizeGroup(
      input.balanceHistory,
      'balance-history',
      startLedgerIndex,
      endLedgerIndex,
    ),
    currentProjectionMutations: normalizeGroup(
      input.currentProjectionMutations,
      'current-projection',
      startLedgerIndex,
      endLedgerIndex,
    ),
  }

  const groups = Object.values(normalizedGroups)
  validateCandidateUniqueness(groups)
  const ledgerHashes = validateLedgerChain(
    normalizedGroups.ledgers,
    startLedgerIndex,
    endLedgerIndex,
    expectedParentHash,
    finalLedgerHash,
  )
  validateCandidateSourceHashes(groups, ledgerHashes)

  const body: Omit<NormalizedCollectorPayloadV1, 'digest'> = {
    schemaVersion: NORMALIZED_COLLECTOR_PAYLOAD_SCHEMA_VERSION,
    workId: requiredString(input.workId, 'workId'),
    network: requiredString(input.network, 'network'),
    epochId: requiredString(input.epochId, 'epochId'),
    baseIdentity: requiredString(input.baseIdentity, 'baseIdentity'),
    previousLedgerIndex,
    expectedParentHash,
    startLedgerIndex,
    endLedgerIndex,
    finalLedgerHash,
    ...normalizedGroups,
    semanticCounts: semanticCounts(normalizedGroups),
  }

  return {
    ...body,
    digest: await sha256PortableJson(body),
  }
}

export async function verifyNormalizedCollectorPayload(
  payload: NormalizedCollectorPayloadV1,
): Promise<void> {
  const rebuilt = await buildNormalizedCollectorPayload(payload)
  if (canonicalPortableJson(rebuilt) !== canonicalPortableJson(payload)) {
    throw new PortablePayloadValidationError('normalized collector payload integrity mismatch')
  }
}

function flattenPayload(payload: NormalizedCollectorPayloadV1): NormalizedCandidateV1[] {
  return GROUPS.flatMap(([groupName]) => payload[groupName])
}

function chunkBody(input: {
  workId: string
  chunkIndex: number
  totalChunks: number
  payloadDigest: string
  records: NormalizedCandidateV1[]
}): Omit<NormalizedPayloadChunkV1, 'chunkDigest'> {
  return {
    schemaVersion: NORMALIZED_COLLECTOR_PAYLOAD_SCHEMA_VERSION,
    workId: input.workId,
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    payloadDigest: input.payloadDigest,
    records: input.records,
  }
}

function encodedChunkSizeWithPlaceholder(
  body: Omit<NormalizedPayloadChunkV1, 'chunkDigest'>,
): number {
  return new TextEncoder().encode(
    canonicalPortableJson({
      ...body,
      chunkDigest: `${SHA256_PREFIX}${'0'.repeat(SHA256_HEX_LENGTH)}`,
    }),
  ).byteLength
}

export async function buildNormalizedPayloadChunks(
  payload: NormalizedCollectorPayloadV1,
  limits: NormalizedPayloadChunkLimits = {
    maxRecords: NORMALIZED_PAYLOAD_CHUNK_MAX_RECORDS,
    maxEncodedBytes: NORMALIZED_PAYLOAD_CHUNK_MAX_BYTES,
  },
): Promise<BuiltNormalizedPayloadChunkV1[]> {
  await verifyNormalizedCollectorPayload(payload)
  const maxRecords = positiveInteger(limits.maxRecords, 'maxRecords')
  const maxEncodedBytes = positiveInteger(limits.maxEncodedBytes, 'maxEncodedBytes')
  const records = flattenPayload(payload)
  if (records.length === 0) {
    throw new PortablePayloadValidationError('normalized payload must contain ledger evidence')
  }

  const partitions: NormalizedCandidateV1[][] = []
  let current: NormalizedCandidateV1[] = []
  const conservativeTotalChunks = records.length

  for (const record of records) {
    const prospective = [...current, record]
    const prospectiveBody = chunkBody({
      workId: payload.workId,
      chunkIndex: partitions.length,
      totalChunks: conservativeTotalChunks,
      payloadDigest: payload.digest,
      records: prospective,
    })
    const exceedsRecords = prospective.length > maxRecords
    const exceedsBytes = encodedChunkSizeWithPlaceholder(prospectiveBody) > maxEncodedBytes

    if ((exceedsRecords || exceedsBytes) && current.length > 0) {
      partitions.push(current)
      current = []
    }

    const singleBody = chunkBody({
      workId: payload.workId,
      chunkIndex: partitions.length,
      totalChunks: conservativeTotalChunks,
      payloadDigest: payload.digest,
      records: [record],
    })
    if (encodedChunkSizeWithPlaceholder(singleBody) > maxEncodedBytes) {
      throw new PortablePayloadResourceHaltError(
        `one normalized record exceeds the ${maxEncodedBytes}-byte chunk guard`,
      )
    }

    current.push(record)
  }
  if (current.length > 0) partitions.push(current)

  const built: BuiltNormalizedPayloadChunkV1[] = []
  for (let chunkIndex = 0; chunkIndex < partitions.length; chunkIndex += 1) {
    const body = chunkBody({
      workId: payload.workId,
      chunkIndex,
      totalChunks: partitions.length,
      payloadDigest: payload.digest,
      records: partitions[chunkIndex]!,
    })
    const chunk: NormalizedPayloadChunkV1 = {
      ...body,
      chunkDigest: await sha256PortableJson(body),
    }
    const encodedJson = canonicalPortableJson(chunk)
    const encoded = new TextEncoder().encode(encodedJson)
    if (encoded.byteLength > maxEncodedBytes) {
      throw new PortablePayloadResourceHaltError(
        `normalized chunk ${chunkIndex} exceeds the ${maxEncodedBytes}-byte chunk guard`,
      )
    }
    built.push({ chunk, encodedJson, encoded })
  }
  return built
}

function isSha256Digest(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    new RegExp(`^${SHA256_PREFIX}[0-9a-f]{${SHA256_HEX_LENGTH}}$`, 'u').test(value)
  )
}

export async function decodeAndVerifyNormalizedPayloadChunk(
  encoded: Uint8Array,
  expectedPayloadDigest?: string,
): Promise<NormalizedPayloadChunkV1> {
  const encodedJson = new TextDecoder().decode(encoded)
  let parsed: unknown
  try {
    parsed = JSON.parse(encodedJson)
  } catch {
    throw new PortablePayloadValidationError('normalized payload chunk is not valid JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PortablePayloadValidationError('normalized payload chunk must be an object')
  }
  const value = parsed as Record<string, unknown>
  const requiredKeys = [
    'schemaVersion',
    'workId',
    'chunkIndex',
    'totalChunks',
    'payloadDigest',
    'records',
    'chunkDigest',
  ].sort()
  const actualKeys = Object.keys(value).sort()
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index])
  ) {
    throw new PortablePayloadValidationError('normalized payload chunk fields are invalid')
  }
  if (value.schemaVersion !== NORMALIZED_COLLECTOR_PAYLOAD_SCHEMA_VERSION) {
    throw new PortablePayloadValidationError('unsupported normalized payload chunk version')
  }
  const workId = requiredString(value.workId, 'chunk.workId')
  const chunkIndex = nonNegativeInteger(value.chunkIndex, 'chunk.chunkIndex')
  const totalChunks = positiveInteger(value.totalChunks, 'chunk.totalChunks')
  if (chunkIndex >= totalChunks) {
    throw new PortablePayloadValidationError('chunkIndex must be less than totalChunks')
  }
  if (!isSha256Digest(value.payloadDigest) || !isSha256Digest(value.chunkDigest)) {
    throw new PortablePayloadValidationError('normalized payload chunk digest format is invalid')
  }
  if (expectedPayloadDigest && value.payloadDigest !== expectedPayloadDigest) {
    throw new PortablePayloadValidationError('normalized payload digest mismatch')
  }
  if (!Array.isArray(value.records) || value.records.length === 0) {
    throw new PortablePayloadValidationError('normalized payload chunk records must be non-empty')
  }

  const records = value.records.map((record, index) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new PortablePayloadValidationError(`chunk.records[${index}] must be an object`)
    }
    const semanticClass = (record as { semanticClass?: unknown }).semanticClass
    if (typeof semanticClass !== 'string' || !(semanticClass in SEMANTIC_CLASS_ORDER)) {
      throw new PortablePayloadValidationError(
        `chunk.records[${index}] has an invalid semantic class`,
      )
    }
    return normalizeCandidate(
      record as NormalizedCandidateV1,
      semanticClass as NormalizedSemanticClassV1,
      0,
      Number.MAX_SAFE_INTEGER,
    )
  })

  const body = chunkBody({
    workId,
    chunkIndex,
    totalChunks,
    payloadDigest: value.payloadDigest,
    records,
  })
  const expectedChunkDigest = await sha256PortableJson(body)
  if (value.chunkDigest !== expectedChunkDigest) {
    throw new PortablePayloadValidationError('normalized payload chunk digest mismatch')
  }
  const normalized: NormalizedPayloadChunkV1 = {
    ...body,
    chunkDigest: expectedChunkDigest,
  }
  if (canonicalPortableJson(normalized) !== encodedJson) {
    throw new PortablePayloadValidationError('normalized payload chunk is not canonical')
  }
  return normalized
}
