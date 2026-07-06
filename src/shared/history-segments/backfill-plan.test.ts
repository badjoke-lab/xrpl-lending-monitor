import { describe, expect, it } from 'vitest'

import {
  assertHistoryBackfillPlan,
  buildHistoryBackfillPlan,
} from './backfill-plan'

describe('history backfill plan', () => {
  it('covers an uneven range without gaps or overlaps', () => {
    const plan = buildHistoryBackfillPlan({
      epochId: 'devnet-3371675',
      startLedgerIndex: 1001,
      endLedgerIndex: 2205,
      segmentLedgerLimit: 500,
      checkpointEverySegments: 2,
    })

    expect(plan.ledgerCount).toBe(1205)
    expect(plan.segmentCount).toBe(3)
    expect(plan.checkpointCount).toBe(2)
    expect(plan.segments).toEqual([
      {
        ordinal: 1,
        segmentId: 'devnet-3371675-1001-1500',
        startLedgerIndex: 1001,
        endLedgerIndex: 1500,
        ledgerCount: 500,
        checkpointAfter: false,
      },
      {
        ordinal: 2,
        segmentId: 'devnet-3371675-1501-2000',
        startLedgerIndex: 1501,
        endLedgerIndex: 2000,
        ledgerCount: 500,
        checkpointAfter: true,
      },
      {
        ordinal: 3,
        segmentId: 'devnet-3371675-2001-2205',
        startLedgerIndex: 2001,
        endLedgerIndex: 2205,
        ledgerCount: 205,
        checkpointAfter: true,
      },
    ])
    expect(() => assertHistoryBackfillPlan(plan)).not.toThrow()
  })

  it('marks the final segment as a checkpoint even before cadence', () => {
    const plan = buildHistoryBackfillPlan({
      epochId: 'epoch-1',
      startLedgerIndex: 10,
      endLedgerIndex: 19,
      segmentLedgerLimit: 10,
      checkpointEverySegments: 5,
    })
    expect(plan.segments).toEqual([{
      ordinal: 1,
      segmentId: 'epoch-1-10-19',
      startLedgerIndex: 10,
      endLedgerIndex: 19,
      ledgerCount: 10,
      checkpointAfter: true,
    }])
  })

  it('rejects an inverted range and oversized segments', () => {
    expect(() => buildHistoryBackfillPlan({
      epochId: 'epoch-1',
      startLedgerIndex: 20,
      endLedgerIndex: 10,
      segmentLedgerLimit: 100,
      checkpointEverySegments: 2,
    })).toThrow('range is inverted')

    expect(() => buildHistoryBackfillPlan({
      epochId: 'epoch-1',
      startLedgerIndex: 10,
      endLedgerIndex: 20,
      segmentLedgerLimit: 501,
      checkpointEverySegments: 2,
    })).toThrow('may not exceed 500')
  })

  it('rejects a tampered plan with broken coverage', () => {
    const plan = buildHistoryBackfillPlan({
      epochId: 'epoch-1',
      startLedgerIndex: 100,
      endLedgerIndex: 299,
      segmentLedgerLimit: 100,
      checkpointEverySegments: 2,
    })
    plan.segments[1]!.startLedgerIndex = 201
    expect(() => assertHistoryBackfillPlan(plan)).toThrow('gap or overlap')
  })
})
