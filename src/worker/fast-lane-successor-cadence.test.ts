import { describe, expect, it } from 'vitest'

import {
  FAST_LANE_CATCH_UP_CRON,
  FAST_LANE_NORMAL_CRON,
  isSyntheticFastLaneCatchUp,
  nextFastLaneSuccessor,
} from './fast-lane-successor-cadence'
import { shouldRunProtectedHeavyCycle } from './scheduled-cadence'

describe('fast-lane successor cadence', () => {
  it('provides catch-up capacity above the observed Devnet rate', () => {
    let cursor = 1_000
    let head = cursor + 300
    let scheduledTime = Date.parse('2026-07-31T12:00:00Z')

    for (let minute = 0; minute < 5; minute += 1) {
      cursor += Math.min(32, head - cursor)
      if (minute < 4) head += 84 / 5
      const successor = nextFastLaneSuccessor({
        currentScheduledTime: scheduledTime,
        now: scheduledTime,
        caughtUp: cursor >= head,
      })
      expect(successor.scheduledTime - scheduledTime).toBe(60_000)
      expect(successor.cron).toBe(FAST_LANE_CATCH_UP_CRON)
      scheduledTime = successor.scheduledTime
    }

    expect(head - cursor).toBeLessThan(300)
    expect(cursor).toBe(1_160)
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
