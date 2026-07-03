import { describe, expect, it } from 'vitest'

import {
  assertCapacityAccepted,
  buildCapacityReport,
} from './capacity'

const baseline = {
  existingDatabaseBytes: 10_000_000,
  normalizedSnapshotBytes: 4_000_000,
  manifestBytes: 50_000,
  objectRows: 3_402,
  batchRows: 50,
  maximumRowBytes: 12_000,
  maximumObjectsPerBatch: 80,
  historyReserveBytes: 50_000_000,
}

describe('D1 capacity report', () => {
  it('includes active and previous snapshots, indexes, row overhead, and history reserve', () => {
    const report = buildCapacityReport(baseline)

    expect(report.oneSnapshotDataBytes).toBeGreaterThan(baseline.normalizedSnapshotBytes)
    expect(report.oneSnapshotIndexBytes).toBeGreaterThan(0)
    expect(report.retainedSnapshotBytes).toBe(
      (report.oneSnapshotDataBytes + report.oneSnapshotIndexBytes) * 2,
    )
    expect(report.projectedRowsWritten).toBe((3_402 + 50 + 2) * 2)
    expect(report.accepted).toBe(true)
    expect(() => assertCapacityAccepted(report)).not.toThrow()
  })

  it('fails closed above the 350 MB bootstrap threshold', () => {
    const report = buildCapacityReport({
      ...baseline,
      normalizedSnapshotBytes: 220_000_000,
      historyReserveBytes: 80_000_000,
    })

    expect(report.accepted).toBe(false)
    expect(report.reasons).toContain(
      'projected database use exceeds the bootstrap stop threshold',
    )
    expect(() => assertCapacityAccepted(report)).toThrow('capacity gate failed')
  })

  it('rejects oversized rows and write batches independently of total storage', () => {
    const report = buildCapacityReport({
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
