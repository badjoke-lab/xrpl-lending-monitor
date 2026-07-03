import { describe, expect, it } from 'vitest'

import {
  assertD1CapacityAccepted,
  buildD1CapacityReport,
} from './d1-capacity'

const baseline = {
  currentDatabaseBytes: 14_000_000,
  normalizedSnapshotBytes: 4_000_000,
  manifestBytes: 50_000,
  objectRows: 3_402,
  batchRows: 50,
  maximumRowBytes: 12_000,
  maximumObjectsPerBatch: 80,
  historyReserveBytes: 50_000_000,
}

describe('D1 retained-snapshot capacity report', () => {
  it('adds only the missing rollback generation to the current database size', () => {
    const report = buildD1CapacityReport(baseline)

    expect(report.additionalSnapshotCount).toBe(1)
    expect(report.additionalSnapshotBytes).toBe(
      report.oneSnapshotDataBytes + report.oneSnapshotIndexBytes,
    )
    expect(report.projectedDatabaseBytes).toBe(
      baseline.currentDatabaseBytes + report.additionalSnapshotBytes + baseline.historyReserveBytes,
    )
    expect(report.accepted).toBe(true)
    expect(() => assertD1CapacityAccepted(report)).not.toThrow()
  })

  it('does not double count snapshots already present in the database', () => {
    const report = buildD1CapacityReport({
      ...baseline,
      includedSnapshots: 2,
      retainedSnapshots: 2,
    })

    expect(report.additionalSnapshotCount).toBe(0)
    expect(report.additionalSnapshotBytes).toBe(0)
    expect(report.projectedDatabaseBytes).toBe(
      baseline.currentDatabaseBytes + baseline.historyReserveBytes,
    )
  })

  it('rejects a projection above the 350 MB stop threshold', () => {
    const report = buildD1CapacityReport({
      ...baseline,
      currentDatabaseBytes: 320_000_000,
      historyReserveBytes: 40_000_000,
    })

    expect(report.accepted).toBe(false)
    expect(report.reasons).toContain(
      'projected database use exceeds the bootstrap stop threshold',
    )
    expect(() => assertD1CapacityAccepted(report)).toThrow('capacity check failed')
  })

  it('rejects oversized rows and write batches independently', () => {
    const report = buildD1CapacityReport({
      ...baseline,
      maximumRowBytes: 1_900_001,
      maximumObjectsPerBatch: 81,
    })

    expect(report.accepted).toBe(false)
    expect(report.reasons).toEqual(expect.arrayContaining([
      'maximum row exceeds the D1 safety limit',
      'maximum object batch exceeds the bounded write limit',
    ]))
  })
})
