import type { VerificationPath } from '../../collector/incremental/live-continuation-verification'

export function managedTransitionPath(
  sourceCount: number,
  lifecycleCount: number,
  label: string,
): VerificationPath {
  if (sourceCount === 0 && lifecycleCount === 0) {
    return {
      state: 'missing',
      reason: `${label} source transition and lifecycle evidence not yet observed`,
    }
  }
  if (sourceCount === 0 || lifecycleCount === 0) {
    return {
      state: 'inconsistent',
      reason: `${label} source transition and lifecycle evidence disagree`,
    }
  }
  return {
    state: 'observed',
    reason: `${label} source transition and lifecycle evidence observed`,
  }
}
