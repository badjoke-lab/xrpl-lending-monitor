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
  | 'lag_threshold_exceeded'
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
  if (head.ledgerIndex - state.lastProcessedLedger > options.reanchorLagLedgers) {
    return 'lag_threshold_exceeded'
  }
  return null
}
