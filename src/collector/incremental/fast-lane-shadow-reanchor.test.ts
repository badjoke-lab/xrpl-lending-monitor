import { describe, expect, it } from 'vitest'

import type { FastLaneShadowState } from '../../worker/repositories/fast-lane-shadow-repository'
import { fastLaneShadowReanchorReason } from './fast-lane-shadow-reanchor'

function state(overrides: Partial<FastLaneShadowState> = {}): FastLaneShadowState {
  return {
    epochId: 'fast-lane-shadow-devnet',
    lastProcessedLedger: 100,
    lastProcessedHash: 'A'.repeat(64),
    latestObservedLedger: 100,
    latestObservedHash: 'A'.repeat(64),
    status: 'healthy',
    updatedAt: '2026-07-11T03:00:00.000Z',
    ...overrides,
  }
}

describe('fastLaneShadowReanchorReason', () => {
  it('reanchors when state is missing', () => {
    expect(fastLaneShadowReanchorReason({
      state: null,
      head: { ledgerIndex: 100, ledgerHash: 'A'.repeat(64) },
      expectedEpochId: 'fast-lane-shadow-devnet',
      reanchorLagLedgers: 720,
    })).toBe('missing_state')
  })

  it('reanchors when the validated head regresses below the stored cursor', () => {
    expect(fastLaneShadowReanchorReason({
      state: state({ lastProcessedLedger: 200 }),
      head: { ledgerIndex: 100, ledgerHash: 'B'.repeat(64) },
      expectedEpochId: 'fast-lane-shadow-devnet',
      reanchorLagLedgers: 720,
    })).toBe('head_regression')
  })

  it('reanchors when the same ledger index has a different validated hash', () => {
    expect(fastLaneShadowReanchorReason({
      state: state(),
      head: { ledgerIndex: 100, ledgerHash: 'B'.repeat(64) },
      expectedEpochId: 'fast-lane-shadow-devnet',
      reanchorLagLedgers: 720,
    })).toBe('head_hash_mismatch')
  })

  it('reanchors when lag exceeds the configured threshold', () => {
    expect(fastLaneShadowReanchorReason({
      state: state({ lastProcessedLedger: 100 }),
      head: { ledgerIndex: 821, ledgerHash: 'B'.repeat(64) },
      expectedEpochId: 'fast-lane-shadow-devnet',
      reanchorLagLedgers: 720,
    })).toBe('lag_threshold_exceeded')
  })

  it('keeps a healthy continuation state', () => {
    expect(fastLaneShadowReanchorReason({
      state: state(),
      head: { ledgerIndex: 150, ledgerHash: 'B'.repeat(64) },
      expectedEpochId: 'fast-lane-shadow-devnet',
      reanchorLagLedgers: 720,
    })).toBeNull()
  })
})
