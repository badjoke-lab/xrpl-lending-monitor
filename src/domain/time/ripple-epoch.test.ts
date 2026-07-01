import { describe, expect, it } from 'vitest'

import {
  RIPPLE_EPOCH_UNIX_OFFSET_SECONDS,
  rippleEpochToIso,
  rippleEpochToUnixSeconds,
  unixSecondsToRippleEpoch,
} from './ripple-epoch'

describe('Ripple epoch conversion', () => {
  it('maps Ripple epoch zero to 2000-01-01T00:00:00Z', () => {
    expect(rippleEpochToIso(0)).toBe('2000-01-01T00:00:00.000Z')
    expect(rippleEpochToUnixSeconds(0)).toBe(RIPPLE_EPOCH_UNIX_OFFSET_SECONDS)
  })

  it('round-trips whole seconds exactly', () => {
    const rippleSeconds = 831_439_690
    expect(unixSecondsToRippleEpoch(rippleEpochToUnixSeconds(rippleSeconds))).toBe(
      rippleSeconds,
    )
  })

  it('rejects values outside UInt32 range', () => {
    expect(() => rippleEpochToIso(-1)).toThrow('unsigned 32-bit integer')
    expect(() => rippleEpochToIso(0x1_0000_0000)).toThrow('unsigned 32-bit integer')
  })
})
