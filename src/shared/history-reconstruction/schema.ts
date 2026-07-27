import {
  HISTORY_RECONSTRUCTION_EPOCH_ID,
  HISTORY_RECONSTRUCTION_ID,
  HISTORY_RECONSTRUCTION_NETWORK,
  reconstructionSegmentRange,
} from './identity'

const SHA256 = /^[a-f0-9]{64}$/
const LEDGER_HASH = /^[A-F0-9]{64}$/
const COMMIT_SHA = /^[a-f0-9]{40}$/

export const SEMANTIC_KEYS = [
  'protocolEvents', 'objectChanges', 'loanLifecycle', 'archivedObjects', 'balanceHistory',
] as const

export interface ReconstructionSemanticCounts {
  protocolEvents: number
  objectChanges: number
  loanLifecycle: number
  archivedObjects: number
  balanceHistory: number
}

export interface RawCheckpoint {
  schemaVersion: 1
  kind: 'immutable-history-raw-checkpoint'
  reconstructionId: string
  network: 'devnet'
  epochId: string
  segmentId: number
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
  firstParentHash: string
  terminalHash: string
  predecessorDigest: string | null
  manifestSha256: string
  semanticCounts: ReconstructionSemanticCounts
  decodePassed: true
  conflictCount: 0
  sourceImplementationSha: string
  productionMutation: false
}

export interface ReconstructionAttempt {
  schemaVersion: 1
  kind: 'immutable-history-attempt'
  reconstructionId: string
  segmentId: number
  attempt: number
  state: 'started' | 'failed' | 'completed'
  lastSuccessfulLedgerIndex: number | null
  lastSuccessfulLedgerHash: string | null
  lastPersistedCheckpointDigest: string | null
  productionMutation: false
}

export interface SpillShardEvidence {
  schemaVersion: 1
  kind: 'history-exact-spill-shard'
  reconstructionId: string
  shardId: number
  rawInputDigest: string
  firstSegmentId: number
  lastSegmentId: number
  superBucketCount: 16
  recordCount: number
  digest: string
  productionMutation: false
}

export interface SuperBucketEvidence {
  schemaVersion: 1
  kind: 'history-exact-super-bucket'
  reconstructionId: string
  superBucket: number
  rawInputDigest: string
  firstBucket: number
  lastBucket: number
  recordCount: number
  digest: string
  productionMutation: false
}

export interface FinalReadinessEvidence {
  schemaVersion: 1
  kind: 'history-reconstruction-final-readiness'
  reconstructionId: string
  rawComplete: true
  exactIndexComplete: true
  witnessPassed: true
  finalTreePassed: true
  remoteRehearsalPassed: true
  productionMutation: false
}

export interface ReconciliationEvidence {
  schemaVersion: 1
  kind: 'history-reconstruction-reconciliation'
  reconstructionId: string
  phase: 'raw' | 'exact-index' | 'final-tree'
  expectedRecords: number
  actualRecords: number
  conflicts: 0
  passed: true
  productionMutation: false
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], field: string): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error(`${field} has unexpected or missing fields`)
  }
}

function integer(value: unknown, field: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${field} is invalid`)
}

function digest(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${field} must be a lowercase SHA-256 digest`)
}

function ledgerHash(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !LEDGER_HASH.test(value)) throw new Error(`${field} must be an uppercase ledger hash`)
}

export function assertSemanticCounts(value: unknown): asserts value is ReconstructionSemanticCounts {
  const counts = object(value, 'semanticCounts')
  exactKeys(counts, SEMANTIC_KEYS, 'semanticCounts')
  for (const key of SEMANTIC_KEYS) integer(counts[key], `semanticCounts.${key}`)
}

export function assertRawCheckpoint(value: unknown): asserts value is RawCheckpoint {
  const checkpoint = object(value, 'checkpoint')
  exactKeys(checkpoint, [
    'schemaVersion', 'kind', 'reconstructionId', 'network', 'epochId', 'segmentId',
    'startLedgerIndex', 'endLedgerIndex', 'ledgerCount', 'firstParentHash', 'terminalHash',
    'predecessorDigest', 'manifestSha256', 'semanticCounts', 'decodePassed', 'conflictCount',
    'sourceImplementationSha', 'productionMutation',
  ], 'checkpoint')
  if (checkpoint.schemaVersion !== 1 || checkpoint.kind !== 'immutable-history-raw-checkpoint') throw new Error('Checkpoint schema is invalid')
  if (checkpoint.reconstructionId !== HISTORY_RECONSTRUCTION_ID || checkpoint.network !== HISTORY_RECONSTRUCTION_NETWORK || checkpoint.epochId !== HISTORY_RECONSTRUCTION_EPOCH_ID) throw new Error('Checkpoint plan identity is stale or invalid')
  integer(checkpoint.segmentId, 'segmentId')
  const range = reconstructionSegmentRange(checkpoint.segmentId)
  if (checkpoint.startLedgerIndex !== range.startLedgerIndex || checkpoint.endLedgerIndex !== range.endLedgerIndex || checkpoint.ledgerCount !== range.ledgerCount) throw new Error('Checkpoint range does not match the deterministic plan')
  ledgerHash(checkpoint.firstParentHash, 'firstParentHash')
  ledgerHash(checkpoint.terminalHash, 'terminalHash')
  if (checkpoint.predecessorDigest !== null) digest(checkpoint.predecessorDigest, 'predecessorDigest')
  digest(checkpoint.manifestSha256, 'manifestSha256')
  assertSemanticCounts(checkpoint.semanticCounts)
  if (checkpoint.decodePassed !== true || checkpoint.conflictCount !== 0 || checkpoint.productionMutation !== false) throw new Error('Checkpoint did not pass fail-closed acceptance')
  if (typeof checkpoint.sourceImplementationSha !== 'string' || !COMMIT_SHA.test(checkpoint.sourceImplementationSha)) throw new Error('sourceImplementationSha is invalid')
}

export function assertAttempt(value: unknown): asserts value is ReconstructionAttempt {
  const attempt = object(value, 'attempt')
  exactKeys(attempt, ['schemaVersion', 'kind', 'reconstructionId', 'segmentId', 'attempt', 'state', 'lastSuccessfulLedgerIndex', 'lastSuccessfulLedgerHash', 'lastPersistedCheckpointDigest', 'productionMutation'], 'attempt')
  if (attempt.schemaVersion !== 1 || attempt.kind !== 'immutable-history-attempt' || attempt.reconstructionId !== HISTORY_RECONSTRUCTION_ID || attempt.productionMutation !== false) throw new Error('Attempt identity is invalid')
  integer(attempt.segmentId, 'segmentId'); reconstructionSegmentRange(attempt.segmentId)
  integer(attempt.attempt, 'attempt', 1)
  if (!['started', 'failed', 'completed'].includes(String(attempt.state))) throw new Error('Attempt state is invalid')
  if (attempt.lastSuccessfulLedgerIndex !== null) integer(attempt.lastSuccessfulLedgerIndex, 'lastSuccessfulLedgerIndex', 1)
  if (attempt.lastSuccessfulLedgerHash !== null) ledgerHash(attempt.lastSuccessfulLedgerHash, 'lastSuccessfulLedgerHash')
  if ((attempt.lastSuccessfulLedgerIndex === null) !== (attempt.lastSuccessfulLedgerHash === null)) throw new Error('Attempt ledger identity must be complete')
  if (attempt.lastPersistedCheckpointDigest !== null) digest(attempt.lastPersistedCheckpointDigest, 'lastPersistedCheckpointDigest')
}

export function assertFinalReadiness(value: unknown): asserts value is FinalReadinessEvidence {
  const evidence = object(value, 'finalReadiness')
  exactKeys(evidence, ['schemaVersion', 'kind', 'reconstructionId', 'rawComplete', 'exactIndexComplete', 'witnessPassed', 'finalTreePassed', 'remoteRehearsalPassed', 'productionMutation'], 'finalReadiness')
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'history-reconstruction-final-readiness' || evidence.reconstructionId !== HISTORY_RECONSTRUCTION_ID || evidence.productionMutation !== false) throw new Error('Final readiness identity is invalid')
  for (const field of ['rawComplete', 'exactIndexComplete', 'witnessPassed', 'finalTreePassed'] as const) if (evidence[field] !== true) throw new Error(`${field} must pass`)
  if (evidence.remoteRehearsalPassed !== true) throw new Error('remoteRehearsalPassed must pass')
}

export function assertSpillShardEvidence(value: unknown): asserts value is SpillShardEvidence {
  const evidence = object(value, 'spillShard')
  exactKeys(evidence, ['schemaVersion', 'kind', 'reconstructionId', 'shardId', 'rawInputDigest', 'firstSegmentId', 'lastSegmentId', 'superBucketCount', 'recordCount', 'digest', 'productionMutation'], 'spillShard')
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'history-exact-spill-shard' || evidence.reconstructionId !== HISTORY_RECONSTRUCTION_ID || evidence.superBucketCount !== 16 || evidence.productionMutation !== false) throw new Error('Spill shard identity is invalid')
  integer(evidence.shardId, 'shardId'); integer(evidence.firstSegmentId, 'firstSegmentId'); integer(evidence.lastSegmentId, 'lastSegmentId')
  if (evidence.shardId >= 33) throw new Error('Spill shard ID is out of range')
  const expectedFirst = evidence.shardId * 8
  const expectedLast = evidence.shardId === 32 ? 262 : expectedFirst + 7
  if (evidence.firstSegmentId !== expectedFirst || evidence.lastSegmentId !== expectedLast) {
    throw new Error('Spill shard does not match the deterministic segment range')
  }
  reconstructionSegmentRange(evidence.firstSegmentId); reconstructionSegmentRange(evidence.lastSegmentId)
  integer(evidence.recordCount, 'recordCount'); digest(evidence.rawInputDigest, 'rawInputDigest'); digest(evidence.digest, 'digest')
}

export function assertSuperBucketEvidence(value: unknown): asserts value is SuperBucketEvidence {
  const evidence = object(value, 'superBucket')
  exactKeys(evidence, ['schemaVersion', 'kind', 'reconstructionId', 'superBucket', 'rawInputDigest', 'firstBucket', 'lastBucket', 'recordCount', 'digest', 'productionMutation'], 'superBucket')
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'history-exact-super-bucket' || evidence.reconstructionId !== HISTORY_RECONSTRUCTION_ID || evidence.productionMutation !== false) throw new Error('Super-bucket identity is invalid')
  integer(evidence.superBucket, 'superBucket'); integer(evidence.firstBucket, 'firstBucket'); integer(evidence.lastBucket, 'lastBucket')
  if (evidence.superBucket >= 16 || evidence.firstBucket !== evidence.superBucket * 16 || evidence.lastBucket !== evidence.firstBucket + 15) throw new Error('Super-bucket range is invalid')
  integer(evidence.recordCount, 'recordCount'); digest(evidence.rawInputDigest, 'rawInputDigest'); digest(evidence.digest, 'digest')
}

export function assertReconciliationEvidence(value: unknown): asserts value is ReconciliationEvidence {
  const evidence = object(value, 'reconciliation')
  exactKeys(evidence, ['schemaVersion', 'kind', 'reconstructionId', 'phase', 'expectedRecords', 'actualRecords', 'conflicts', 'passed', 'productionMutation'], 'reconciliation')
  if (evidence.schemaVersion !== 1 || evidence.kind !== 'history-reconstruction-reconciliation' || evidence.reconstructionId !== HISTORY_RECONSTRUCTION_ID || evidence.productionMutation !== false) throw new Error('Reconciliation identity is invalid')
  if (!['raw', 'exact-index', 'final-tree'].includes(String(evidence.phase))) throw new Error('Reconciliation phase is invalid')
  integer(evidence.expectedRecords, 'expectedRecords'); integer(evidence.actualRecords, 'actualRecords')
  if (evidence.conflicts !== 0 || evidence.passed !== true || evidence.expectedRecords !== evidence.actualRecords) throw new Error('Reconciliation did not pass')
}
