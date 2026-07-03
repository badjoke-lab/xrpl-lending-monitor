import { describe, expect, it } from 'vitest'

import { buildD1CapacityReport } from './d1-capacity'

describe('D1 capacity report', () => {
  it('projects one additional snapshot', () => {
    const report = buildD1CapacityReport({
      currentDatabaseBytes: 14_000_000,
      normalizedSnapshotBytes: 4_000_000,
      manifestBytes: 50_000,
      objectRows: 3_402,
      batchRows: 50,
      maximumRowBytes: 12_000,
      maximumObjectsPerBatch: 80,
      historyReserveBytes: 50_000_000,
    })

    expect(report.additionalSnapshotCount).toBe(1)
    expect(report.accepted).toBe(true)
  })
})
