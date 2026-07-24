import { describe, expect, it } from 'vitest'

import { fastLanePassScheduledTime } from './fast-lane-pass-cadence'
import { scheduledCadenceDecision } from './scheduled-cadence'

function utc(value: string): number {
  return Date.parse(value)
}

describe('fast-lane catch-up pass cadence', () => {
  it('does not let a 03:55 Queue slot synthesize a protected 04:00 cycle', () => {
    const slot = utc('2026-07-24T03:55:00Z')

    expect(scheduledCadenceDecision(fastLanePassScheduledTime(slot, 0)).runProtectedHeavyCycle)
      .toBe(false)
    for (let pass = 1; pass < 8; pass += 1) {
      expect(scheduledCadenceDecision(fastLanePassScheduledTime(slot, pass)).runProtectedHeavyCycle)
        .toBe(false)
    }
  })

  it('runs the protected cycle exactly once for a real 04:00 Queue slot', () => {
    const slot = utc('2026-07-24T04:00:00Z')

    const decisions = Array.from({ length: 8 }, (_, pass) => (
      scheduledCadenceDecision(fastLanePassScheduledTime(slot, pass)).runProtectedHeavyCycle
    ))

    expect(decisions).toEqual([true, false, false, false, false, false, false, false])
  })

  it('rejects invalid slot and pass values', () => {
    expect(() => fastLanePassScheduledTime(Number.NaN, 0)).toThrow('queueSlotScheduledTime')
    expect(() => fastLanePassScheduledTime(0, -1)).toThrow('pass')
  })
})
