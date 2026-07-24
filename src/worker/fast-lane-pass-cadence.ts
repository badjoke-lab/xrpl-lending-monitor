const SYNTHETIC_FAST_LANE_PASS_OFFSET_MS = 60_000

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

/**
 * The first pass keeps the real five-minute Queue slot timestamp so the
 * scheduled worker may run the protected four-hour cycle exactly at a real
 * boundary. Every additional bounded catch-up pass uses one fixed non-boundary
 * timestamp. This prevents synthetic pass offsets from crossing into a future
 * four-hour boundary and prevents a real boundary slot from starting the heavy
 * collector more than once.
 */
export function fastLanePassScheduledTime(
  queueSlotScheduledTime: number,
  pass: number,
): number {
  const slot = nonNegativeSafeInteger(queueSlotScheduledTime, 'queueSlotScheduledTime')
  const passIndex = nonNegativeSafeInteger(pass, 'pass')
  return passIndex === 0 ? slot : slot + SYNTHETIC_FAST_LANE_PASS_OFFSET_MS
}
