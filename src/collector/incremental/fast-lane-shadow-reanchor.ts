import type { FastLaneShadowState } from '../../worker/repositories/fast-lane-shadow-repository'

export interface FastLaneHeadIdentity {
  ledgerIndex: number
  ledgerHash: string
}

export type FastLaneShadowReanchorReason =
  | 'missing_state'
  | 'epoch_mismatch'
  | 'head_regression'
  | 'head_hash_mismatch'
  | null

export function fastLaneShadowReanchorReason(options: {
  state: FastLaneShadowState | null
  head: FastLaneHeadIdentity
  expectedEpochId: string
  reanchorLagLedgers: number
}): FastLaneShadowReanchorReason {
  const { state, head } = options
  if (!state) return 'missing_state'
  if (state.epochId !== options.expectedEpochId) return 'epoch_mismatch'
  if (state.lastProcessedLedger > head.ledgerIndex) return 'head_regression'
  if (
    state.lastProcessedLedger === head.ledgerIndex
    && state.lastProcessedHash !== head.ledgerHash
  ) return 'head_hash_mismatch'

  // A large but forward-only lag is catch-up work, not a reset signal. Reanchoring
  // here would skip validated ledgers and create a permanent live-history gap.
  // The retained option remains part of the runtime contract while deployments
  // transition away from lag-driven reanchoring.
  void options.reanchorLagLedgers
  return null
}
