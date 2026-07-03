export const DATABASE_LIMIT_BYTES = 500_000_000
export const BOOTSTRAP_STOP_BYTES = 350_000_000
export const MAX_SAFE_ROW_BYTES = 1_900_000
export const MAX_OBJECTS_PER_BATCH = 80

export interface CapacityObservation {
  existingDatabaseBytes: number
  normalizedSnapshotBytes: number
  manifestBytes: number
  objectRows: number
  batchRows: number
  maximumRowBytes: number
  maximumObjectsPerBatch: number
  historyReserveBytes: number
  retainedSnapshots?: number
  rowOverheadBytes?: number
  indexOverheadBasisPoints?: number
}

export interface CapacityReport {
  projectedDatabaseBytes: number
  oneSnapshotDataBytes: number
  oneSnapshotIndexBytes: number
  retainedSnapshotBytes: number
  projectedRowsWritten: number
  thresholdHeadroomBytes: number
  limitHeadroomBytes: number
  accepted: boolean
  reasons: string[]
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

export function buildCapacityReport(observation: CapacityObservation): CapacityReport {
  const retainedSnapshots = observation.retainedSnapshots ?? 2
  const rowOverheadBytes = observation.rowOverheadBytes ?? 256
  const indexOverheadBasisPoints = observation.indexOverheadBasisPoints ?? 5_000

  const values: Record<string, number> = {
    existingDatabaseBytes: observation.existingDatabaseBytes,
    normalizedSnapshotBytes: observation.normalizedSnapshotBytes,
    manifestBytes: observation.manifestBytes,
    objectRows: observation.objectRows,
    batchRows: observation.batchRows,
    maximumRowBytes: observation.maximumRowBytes,
    maximumObjectsPerBatch: observation.maximumObjectsPerBatch,
    historyReserveBytes: observation.historyReserveBytes,
    retainedSnapshots,
    rowOverheadBytes,
    indexOverheadBasisPoints,
  }
  for (const [field, value] of Object.entries(values)) {
    requireNonNegativeInteger(value, field)
  }
  if (retainedSnapshots < 1) throw new Error('retainedSnapshots must be at least one')
  if (indexOverheadBasisPoints > 20_000) {
    throw new Error('indexOverheadBasisPoints must not exceed 20000')
  }

  const rowsPerSnapshot = observation.objectRows + observation.batchRows + 2
  const oneSnapshotDataBytes =
    observation.normalizedSnapshotBytes +
    observation.manifestBytes +
    rowsPerSnapshot * rowOverheadBytes
  const oneSnapshotIndexBytes = Math.ceil(
    (oneSnapshotDataBytes * indexOverheadBasisPoints) / 10_000,
  )
  const retainedSnapshotBytes =
    (oneSnapshotDataBytes + oneSnapshotIndexBytes) * retainedSnapshots
  const projectedDatabaseBytes =
    observation.existingDatabaseBytes +
    observation.historyReserveBytes +
    retainedSnapshotBytes

  const reasons: string[] = []
  if (observation.maximumRowBytes > MAX_SAFE_ROW_BYTES) {
    reasons.push('maximum row exceeds the D1 safety limit')
  }
  if (observation.maximumObjectsPerBatch > MAX_OBJECTS_PER_BATCH) {
    reasons.push('maximum object batch exceeds the bounded write limit')
  }
  if (projectedDatabaseBytes > BOOTSTRAP_STOP_BYTES) {
    reasons.push('projected database use exceeds the bootstrap stop threshold')
  }
  if (projectedDatabaseBytes > DATABASE_LIMIT_BYTES) {
    reasons.push('projected database use exceeds the database limit')
  }

  return {
    projectedDatabaseBytes,
    oneSnapshotDataBytes,
    oneSnapshotIndexBytes,
    retainedSnapshotBytes,
    projectedRowsWritten: rowsPerSnapshot * retainedSnapshots,
    thresholdHeadroomBytes: BOOTSTRAP_STOP_BYTES - projectedDatabaseBytes,
    limitHeadroomBytes: DATABASE_LIMIT_BYTES - projectedDatabaseBytes,
    accepted: reasons.length === 0,
    reasons,
  }
}

export function assertCapacityAccepted(report: CapacityReport): void {
  if (!report.accepted) {
    throw new Error(`D1 current-state capacity gate failed: ${report.reasons.join('; ')}`)
  }
}
