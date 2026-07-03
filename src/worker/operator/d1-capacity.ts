import {
  BOOTSTRAP_STOP_ESTIMATE_BYTES,
  DATABASE_SIZE_LIMIT_BYTES,
  MAX_BATCH_OBJECTS,
  ROW_SIZE_LIMIT_BYTES,
} from '../repositories/d1-snapshot'

const DEFAULT_ROW_OVERHEAD_BYTES = 256
const DEFAULT_INDEX_OVERHEAD_BASIS_POINTS = 5_000
const DEFAULT_RETAINED_SNAPSHOTS = 2
const DEFAULT_INCLUDED_SNAPSHOTS = 1

export interface D1CapacityObservation {
  currentDatabaseBytes: number
  normalizedSnapshotBytes: number
  manifestBytes: number
  objectRows: number
  batchRows: number
  maximumRowBytes: number
  maximumObjectsPerBatch: number
  historyReserveBytes: number
  retainedSnapshots?: number
  includedSnapshots?: number
  rowOverheadBytes?: number
  indexOverheadBasisPoints?: number
}

export interface D1CapacityReport {
  currentDatabaseBytes: number
  oneSnapshotDataBytes: number
  oneSnapshotIndexBytes: number
  additionalSnapshotCount: number
  additionalSnapshotBytes: number
  historyReserveBytes: number
  projectedDatabaseBytes: number
  projectedAdditionalRows: number
  thresholdHeadroomBytes: number
  budgetHeadroomBytes: number
  accepted: boolean
  reasons: string[]
}

function requireNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`)
  }
}

export function buildD1CapacityReport(observation: D1CapacityObservation): D1CapacityReport {
  const retainedSnapshots = observation.retainedSnapshots ?? DEFAULT_RETAINED_SNAPSHOTS
  const includedSnapshots = observation.includedSnapshots ?? DEFAULT_INCLUDED_SNAPSHOTS
  const rowOverheadBytes = observation.rowOverheadBytes ?? DEFAULT_ROW_OVERHEAD_BYTES
  const indexOverheadBasisPoints = observation.indexOverheadBasisPoints ?? DEFAULT_INDEX_OVERHEAD_BASIS_POINTS

  const values: Record<string, number> = {
    currentDatabaseBytes: observation.currentDatabaseBytes,
    normalizedSnapshotBytes: observation.normalizedSnapshotBytes,
    manifestBytes: observation.manifestBytes,
    objectRows: observation.objectRows,
    batchRows: observation.batchRows,
    maximumRowBytes: observation.maximumRowBytes,
    maximumObjectsPerBatch: observation.maximumObjectsPerBatch,
    historyReserveBytes: observation.historyReserveBytes,
    retainedSnapshots,
    includedSnapshots,
    rowOverheadBytes,
    indexOverheadBasisPoints,
  }
  for (const [field, value] of Object.entries(values)) requireNonNegativeInteger(value, field)
  if (retainedSnapshots < 1) throw new Error('retainedSnapshots must be at least one')
  if (includedSnapshots > retainedSnapshots) throw new Error('includedSnapshots must not exceed retainedSnapshots')
  if (indexOverheadBasisPoints > 20_000) throw new Error('indexOverheadBasisPoints must not exceed 20000')

  const rowsPerSnapshot = observation.objectRows + observation.batchRows + 3
  const oneSnapshotDataBytes = observation.normalizedSnapshotBytes + observation.manifestBytes + rowsPerSnapshot * rowOverheadBytes
  const oneSnapshotIndexBytes = Math.ceil((oneSnapshotDataBytes * indexOverheadBasisPoints) / 10_000)
  const additionalSnapshotCount = retainedSnapshots - includedSnapshots
  const additionalSnapshotBytes = (oneSnapshotDataBytes + oneSnapshotIndexBytes) * additionalSnapshotCount
  const projectedDatabaseBytes = observation.currentDatabaseBytes + additionalSnapshotBytes + observation.historyReserveBytes

  const reasons: string[] = []
  if (observation.maximumRowBytes > ROW_SIZE_LIMIT_BYTES) reasons.push('maximum row exceeds the D1 safety limit')
  if (observation.maximumObjectsPerBatch > MAX_BATCH_OBJECTS) reasons.push('maximum object batch exceeds the bounded write limit')
  if (projectedDatabaseBytes > BOOTSTRAP_STOP_ESTIMATE_BYTES) reasons.push('projected database use exceeds the bootstrap stop threshold')
  if (projectedDatabaseBytes > DATABASE_SIZE_LIMIT_BYTES) reasons.push('projected database use exceeds the project database budget')

  return {
    currentDatabaseBytes: observation.currentDatabaseBytes,
    oneSnapshotDataBytes,
    oneSnapshotIndexBytes,
    additionalSnapshotCount,
    additionalSnapshotBytes,
    historyReserveBytes: observation.historyReserveBytes,
    projectedDatabaseBytes,
    projectedAdditionalRows: rowsPerSnapshot * additionalSnapshotCount,
    thresholdHeadroomBytes: BOOTSTRAP_STOP_ESTIMATE_BYTES - projectedDatabaseBytes,
    budgetHeadroomBytes: DATABASE_SIZE_LIMIT_BYTES - projectedDatabaseBytes,
    accepted: reasons.length === 0,
    reasons,
  }
}

export function assertD1CapacityAccepted(report: D1CapacityReport): void {
  if (!report.accepted) throw new Error(`D1 capacity check failed: ${report.reasons.join('; ')}`)
}
