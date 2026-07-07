import type { VerificationPath } from '../../collector/incremental/live-continuation-verification'
import type { BalanceHistorySourceDiagnostics } from '../repositories/balance-history-source-diagnostics'
import { crossSurfaceState } from './cross-surface-state'
import { hasBalanceLinkageGap } from './balance-linkage-gap'

export function crossSurfaceVerificationPath(input: {
  loan: boolean
  lifecycle: boolean
  source: boolean
  history: boolean
  balance?: BalanceHistorySourceDiagnostics
}): VerificationPath {
  const state = crossSurfaceState({
    loan: input.loan,
    lifecycle: input.lifecycle,
    source: input.source,
    history: input.history,
    gap: hasBalanceLinkageGap(input.balance),
  })
  const reason = state === 'observed'
    ? 'linked cross-surface evidence observed'
    : state === 'inconsistent'
      ? 'cross-surface source and derived evidence disagree'
      : 'required cross-surface evidence not yet observed'
  return { state, reason }
}
