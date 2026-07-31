export const FAST_LANE_CATCH_UP_CRON = 'queue-catch-up'
export const FAST_LANE_NORMAL_CRON = 'queue-self-schedule'
export const FAST_LANE_CATCH_UP_INTERVAL_MS = 60_000
export const FAST_LANE_NORMAL_INTERVAL_MS = 5 * 60_000

function nextBoundary(now: number, intervalMs: number): number {
  return Math.ceil((now + 1_000) / intervalMs) * intervalMs
}

export function nextFastLaneSuccessor(options: {
  currentScheduledTime: number
  now: number
  caughtUp: boolean
}): { scheduledTime: number; cron: string } {
  if (options.caughtUp) {
    return {
      scheduledTime: nextBoundary(options.now, FAST_LANE_NORMAL_INTERVAL_MS),
      cron: FAST_LANE_NORMAL_CRON,
    }
  }
  const intervalMs = FAST_LANE_CATCH_UP_INTERVAL_MS
  return {
    scheduledTime: Math.max(
      options.currentScheduledTime + intervalMs,
      nextBoundary(options.now, intervalMs),
    ),
    cron: FAST_LANE_CATCH_UP_CRON,
  }
}

export function isSyntheticFastLaneCatchUp(cron: string): boolean {
  return cron === FAST_LANE_CATCH_UP_CRON
}
