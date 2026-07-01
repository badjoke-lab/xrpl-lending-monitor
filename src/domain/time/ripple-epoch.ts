export const RIPPLE_EPOCH_UNIX_OFFSET_SECONDS = 946_684_800
const MAX_UINT32 = 0xffffffff

function assertRippleSeconds(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UINT32) {
    throw new Error('Ripple epoch seconds must be an unsigned 32-bit integer')
  }
}

export function rippleEpochToUnixSeconds(rippleSeconds: number): number {
  assertRippleSeconds(rippleSeconds)
  return rippleSeconds + RIPPLE_EPOCH_UNIX_OFFSET_SECONDS
}

export function rippleEpochToDate(rippleSeconds: number): Date {
  return new Date(rippleEpochToUnixSeconds(rippleSeconds) * 1_000)
}

export function rippleEpochToIso(rippleSeconds: number): string {
  return rippleEpochToDate(rippleSeconds).toISOString()
}

export function unixSecondsToRippleEpoch(unixSeconds: number): number {
  if (!Number.isSafeInteger(unixSeconds)) {
    throw new Error('Unix seconds must be an integer')
  }

  const rippleSeconds = unixSeconds - RIPPLE_EPOCH_UNIX_OFFSET_SECONDS
  assertRippleSeconds(rippleSeconds)
  return rippleSeconds
}
