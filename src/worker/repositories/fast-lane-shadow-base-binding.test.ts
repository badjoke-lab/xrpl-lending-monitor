import { describe, expect, it } from 'vitest'

import {
  sameFastLaneShadowBaseBinding,
  type FastLaneShadowBaseBinding,
} from './fast-lane-shadow-base-binding'

const base = {
  epochId: 'devnet-3371675',
  snapshotId: 'devnet-3540657-de23e44e0906',
  ledgerIndex: 3540657,
  ledgerHash: 'D'.repeat(64),
}

function binding(overrides: Partial<FastLaneShadowBaseBinding> = {}): FastLaneShadowBaseBinding {
  return {
    shadowEpochId: 'fast-lane-shadow-devnet',
    base,
    boundAt: '2026-07-11T04:00:00.000Z',
    ...overrides,
  }
}

describe('fast-lane canonical base binding', () => {
  it('accepts an exact shadow/base identity match', () => {
    expect(sameFastLaneShadowBaseBinding({
      binding: binding(),
      shadowEpochId: 'fast-lane-shadow-devnet',
      base,
    })).toBe(true)
  })

  it('rejects a different canonical snapshot identity', () => {
    expect(sameFastLaneShadowBaseBinding({
      binding: binding(),
      shadowEpochId: 'fast-lane-shadow-devnet',
      base: { ...base, snapshotId: 'next-snapshot' },
    })).toBe(false)
  })

  it('rejects a different canonical ledger hash', () => {
    expect(sameFastLaneShadowBaseBinding({
      binding: binding(),
      shadowEpochId: 'fast-lane-shadow-devnet',
      base: { ...base, ledgerHash: 'E'.repeat(64) },
    })).toBe(false)
  })

  it('rejects a missing binding', () => {
    expect(sameFastLaneShadowBaseBinding({
      binding: null,
      shadowEpochId: 'fast-lane-shadow-devnet',
      base,
    })).toBe(false)
  })
})
