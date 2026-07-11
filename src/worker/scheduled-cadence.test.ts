import { describe, expect, it } from 'vitest'

import { scheduledCadenceDecision } from './scheduled-cadence'

function utc(value: string): number {
  return Date.parse(value)
}

describe('scheduledCadenceDecision', () => {
  it('runs only fast lane on ordinary five-minute ticks', () => {
    expect(scheduledCadenceDecision(utc('2026-07-11T03:25:00Z'))).toEqual({
      runFastLane: true,
      runProtectedHeavyCycle: false,
    })
  })

  it.each([
    '2026-07-11T00:00:00Z',
    '2026-07-11T04:00:00Z',
    '2026-07-11T08:00:00Z',
    '2026-07-11T12:00:00Z',
    '2026-07-11T16:00:00Z',
    '2026-07-11T20:00:00Z',
  ])('runs the protected heavy cycle at %s', (value) => {
    expect(scheduledCadenceDecision(utc(value)).runProtectedHeavyCycle).toBe(true)
  })

  it('does not run the heavy cycle at a five-minute tick inside a protected hour', () => {
    expect(scheduledCadenceDecision(utc('2026-07-11T04:05:00Z')).runProtectedHeavyCycle).toBe(false)
  })

  it('rejects invalid scheduled times', () => {
    expect(() => scheduledCadenceDecision(Number.NaN)).toThrow('scheduledTimeMs')
  })
})
