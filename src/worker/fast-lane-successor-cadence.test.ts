import { describe, expect, it } from 'vitest'

import {
  FAST_LANE_CATCH_UP_CRON,
  FAST_LANE_CATCH_UP_INTERVAL_MS,
  FAST_LANE_NORMAL_CRON,
  isSyntheticFastLaneCatchUp,
  nextFastLaneSuccessor,
} from './fast-lane-successor-cadence'
import { shouldRunProtectedHeavyCycle } from './scheduled-cadence'

describe('fast-lane successor cadence', () => {
  it('uses a ten-second serial catch-up cadence', () => {
    let scheduledTime = Date.parse('2026-08-30T03:30:00Z')

    for (let slot = 0; slot < 5; slot += 1) {
      const successor = nextFastLaneSuccessor({
        currentScheduledTime: scheduledTime,
        now: scheduledTime + 3_500,
        caughtUp: false,
      })
      expect(successor.scheduledTime - scheduledTime).toBe(10_000)
      expect(successor.cron).toBe(FAST_LANE_CATCH_UP_CRON)
      scheduledTime = successor.scheduledTime
    }

    expect(FAST_LANE_CATCH_UP_INTERVAL_MS).toBe(10_000)
  })

  it('moves to the next ten-second boundary instead of replaying a stale schedule', () => {
    expect(nextFastLaneSuccessor({
      currentScheduledTime: Date.parse('2026-08-30T03:30:00Z'),
      now: Date.parse('2026-08-30T03:30:26Z'),
      caughtUp: false,
    })).toEqual({
      scheduledTime: Date.parse('2026-08-30T03:30:30Z'),
      cron: FAST_LANE_CATCH_UP_CRON,
    })
  })

  it('models exact contiguous non-overlapping 32-ledger catch-up ranges', () => {
    let cursor = 1_000
    const ranges = Array.from({ length: 5 }, () => {
      const range = { start: cursor + 1, end: cursor + 32 }
      cursor = range.end
      return range
    })

    expect(ranges).toEqual([
      { start: 1_001, end: 1_032 },
      { start: 1_033, end: 1_064 },
      { start: 1_065, end: 1_096 },
      { start: 1_097, end: 1_128 },
      { start: 1_129, end: 1_160 },
    ])
  })

  it('returns to the next five-minute boundary at lag zero', () => {
    expect(nextFastLaneSuccessor({
      currentScheduledTime: Date.parse('2026-07-31T12:03:00Z'),
      now: Date.parse('2026-07-31T12:03:12Z'),
      caughtUp: true,
    })).toEqual({
      scheduledTime: Date.parse('2026-07-31T12:05:00Z'),
      cron: FAST_LANE_NORMAL_CRON,
    })
  })

  it('marks only the bounded catch-up delivery as synthetic', () => {
    expect(isSyntheticFastLaneCatchUp(FAST_LANE_CATCH_UP_CRON)).toBe(true)
    expect(isSyntheticFastLaneCatchUp(FAST_LANE_NORMAL_CRON)).toBe(false)
  })

  it('never lets a synthetic catch-up delivery invoke the protected collector', () => {
    const protectedBoundary = Date.parse('2026-07-31T12:00:00Z')
    expect(shouldRunProtectedHeavyCycle(protectedBoundary, FAST_LANE_CATCH_UP_CRON)).toBe(false)
    expect(shouldRunProtectedHeavyCycle(protectedBoundary, FAST_LANE_NORMAL_CRON)).toBe(true)
  })
})
