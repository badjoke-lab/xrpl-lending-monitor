import { HISTORY_SEGMENT_FILE_KINDS } from '../history-segments/manifest'
import { reconstructionSegmentRange } from './identity'

export const RECONSTRUCTION_MEASUREMENT_SEGMENTS = [0, 1, 32, 64, 96, 128, 160, 192, 224, 240, 261, 262] as const
export const RECONSTRUCTION_MEASUREMENT_READ_WINDOW_SIZE = 16
export const RECONSTRUCTION_PROTECTION_PATHS = ['rulesets', 'branches/main/protection', 'actions/permissions', 'actions/permissions/workflow'] as const

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value as Record<string, unknown>
}

function nonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${field} must be non-negative and finite`)
  return value
}

function nonNegativeInteger(value: unknown, field: string): number {
  const result = nonNegative(value, field)
  if (!Number.isSafeInteger(result)) throw new Error(`${field} must be an integer`)
  return result
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be non-empty`)
  return value
}

function validateSegment(raw: unknown, expectedIndex: number): void {
  const segment = object(raw, 'Measurement segment')
  const id = RECONSTRUCTION_MEASUREMENT_SEGMENTS[expectedIndex]
  if (id === undefined || segment.segmentId !== id || segment.productionMutation !== false) throw new Error('Measurement segment identity is invalid')
  const range = reconstructionSegmentRange(id)
  const measured = object(segment.range, 'Measurement segment range')
  if (measured.startLedgerIndex !== range.startLedgerIndex || measured.endLedgerIndex !== range.endLedgerIndex || measured.ledgerCount !== range.ledgerCount) throw new Error('Measurement segment range is invalid')
  text(segment.firstParentHash, 'firstParentHash'); text(segment.terminalHash, 'terminalHash'); text(segment.endpoint, 'endpoint')
  for (const field of ['wallMilliseconds', 'cpuUserSeconds', 'cpuSystemSeconds', 'peakRssKiB', 'compressedBytes', 'decompressedBytes', 'exactRecords']) nonNegative(segment[field], field)
  const rpc = object(segment.rpc, 'rpc')
  for (const field of ['requests', 'retries', 'timeouts', 'errors']) nonNegativeInteger(rpc[field], `rpc.${field}`)
  const responseClasses = object(rpc.responseClasses, 'rpc.responseClasses')
  Object.entries(responseClasses).forEach(([responseClass, count]) => nonNegativeInteger(count, `rpc.responseClasses.${responseClass}`))
  if (!Array.isArray(segment.files) || segment.files.length !== HISTORY_SEGMENT_FILE_KINDS.length) throw new Error('Measurement segment files are incomplete')
  segment.files.forEach((rawFile, fileIndex) => {
    const file = object(rawFile, 'Measurement file')
    if (file.kind !== HISTORY_SEGMENT_FILE_KINDS[fileIndex]) throw new Error('Measurement segment file kinds are not canonical')
    for (const field of ['compressedBytes', 'decompressedBytes', 'recordCount']) nonNegativeInteger(file[field], `files.${file.kind}.${field}`)
  })
  const semantic = object(segment.semanticCounts, 'semanticCounts')
  for (const field of ['protocolEvents', 'objectChanges', 'loanLifecycle', 'archivedObjects', 'balanceHistory']) nonNegativeInteger(semantic[field], `semanticCounts.${field}`)
  if (id === 224) {
    const witness = object(segment.witness, 'witness')
    if (witness.transactionFound !== true || witness.objectChangeFound !== true) throw new Error('Fixed measurement witness is absent')
  }
}

export function assertReadOnlyMeasurementSummary(value: unknown): void {
  const summary = object(value, 'Measurement summary')
  if (summary.schemaVersion !== 1 || summary.kind !== 'read-only-history-reconstruction-measurement' || summary.productionMutation !== false) throw new Error('Measurement summary identity is invalid')
  if (!Array.isArray(summary.segments)) throw new Error('Measurement segments are missing')
  summary.segments.forEach(validateSegment)
  if (summary.status === 'failed') {
    if (!Array.isArray(summary.failures) || summary.failures.length === 0 || !summary.failures.every((failure) => typeof failure === 'string' && failure.length > 0)) throw new Error('Failed measurement evidence is invalid')
    text(summary.failedPhase, 'failedPhase')
    if (summary.failedSegmentId !== null && !RECONSTRUCTION_MEASUREMENT_SEGMENTS.includes(summary.failedSegmentId as never)) throw new Error('Failed segment ID is invalid')
    return
  }
  if (summary.status !== 'passed' || !Array.isArray(summary.failures) || summary.failures.length !== 0 || summary.segments.length !== RECONSTRUCTION_MEASUREMENT_SEGMENTS.length) throw new Error('Passed measurement status is invalid')

  const exact = object(summary.exactIndexMeasurement, 'exactIndexMeasurement')
  if (exact.productionMutation !== false) throw new Error('Exact-index production mutation signal is invalid')
  for (const field of ['extractedRecords', 'semanticRecords', 'serializedBytes', 'peakRssKiB']) nonNegative(exact[field], `exactIndexMeasurement.${field}`)
  if (exact.amplification !== null) nonNegative(exact.amplification, 'exactIndexMeasurement.amplification')
  for (const [field, length] of [['bucketDistribution', 256], ['superBucketDistribution', 16]] as const) {
    if (!Array.isArray(exact[field]) || exact[field].length !== length) throw new Error(`${field} is invalid`)
    exact[field].forEach((count) => nonNegativeInteger(count, field))
  }
  const extractedRecords = nonNegativeInteger(exact.extractedRecords, 'exactIndexMeasurement.extractedRecords')
  if ((exact.bucketDistribution as number[]).reduce((total, count) => total + count, 0) !== extractedRecords || (exact.superBucketDistribution as number[]).reduce((total, count) => total + count, 0) !== extractedRecords) throw new Error('Exact-index distribution totals do not reconcile')

  const localGit = object(summary.localGitMeasurement, 'localGitMeasurement')
  if (localGit.productionMutation !== false) throw new Error('Local Git production mutation signal is invalid')
  text(localGit.beforePack, 'localGitMeasurement.beforePack'); text(localGit.afterPack, 'localGitMeasurement.afterPack')
  nonNegativeInteger(localGit.packBytes, 'localGitMeasurement.packBytes'); nonNegativeInteger(localGit.largestBlob, 'localGitMeasurement.largestBlob')

  if (!Array.isArray(summary.githubProtection) || summary.githubProtection.length !== RECONSTRUCTION_PROTECTION_PATHS.length) throw new Error('GitHub protection inventory is incomplete')
  const paths = new Set<string>()
  summary.githubProtection.forEach((raw, index) => {
    const evidence = object(raw, 'GitHub protection evidence')
    const path = text(evidence.path, 'GitHub protection path')
    if (path !== RECONSTRUCTION_PROTECTION_PATHS[index] || paths.has(path)) throw new Error('GitHub protection path is missing, duplicated, or unapproved')
    paths.add(path); nonNegativeInteger(evidence.status, 'GitHub protection status'); object(evidence.body, 'GitHub protection body')
  })
}
