import { isSyntheticFastLaneCatchUp } from './fast-lane-successor-cadence'

export interface ScheduledCadenceDecision {
  runFastLane: true
  runProtectedHeavyCycle: boolean
}

export function scheduledCadenceDecision(scheduledTimeMs: number): ScheduledCadenceDecision {
  if (!Number.isFinite(scheduledTimeMs) || scheduledTimeMs < 0) {
    throw new Error('scheduledTimeMs must be a non-negative finite number')
  }
  const scheduled = new Date(scheduledTimeMs)
  const minute = scheduled.getUTCMinutes()
  const hour = scheduled.getUTCHours()

  return {
    runFastLane: true,
    runProtectedHeavyCycle: minute === 0 && hour % 4 === 0,
  }
}

export function shouldRunProtectedHeavyCycle(scheduledTimeMs: number, cron: string): boolean {
  return scheduledCadenceDecision(scheduledTimeMs).runProtectedHeavyCycle
    && !isSyntheticFastLaneCatchUp(cron)
}
