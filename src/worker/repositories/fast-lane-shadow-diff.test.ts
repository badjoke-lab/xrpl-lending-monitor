import { describe, expect, it } from 'vitest'

import { evaluateFastLaneShadowDiffSample } from './fast-lane-shadow-diff'

function sample(overrides: Partial<Parameters<typeof evaluateFastLaneShadowDiffSample>[0]> = {}) {
  return {
    limit: 500,
    sampledRows: 500,
    canonicalMissingRows: 0,
    canonicalAheadRows: 0,
    fastAheadRows: 0,
    exactSourceMatches: 500,
    exactProjectionMatches: 500,
    exactProjectionMismatches: 0,
    ...overrides,
  }
}

describe('fast-lane shadow differential gate', () => {
  it('passes a non-empty exact comparison with zero mismatches', () => {
    expect(evaluateFastLaneShadowDiffSample(sample())).toEqual({
      passed: true,
      reason: null,
    })
  })

  it('rejects an empty sample', () => {
    expect(evaluateFastLaneShadowDiffSample(sample({
      sampledRows: 0,
      exactSourceMatches: 0,
      exactProjectionMatches: 0,
    }))).toEqual({
      passed: false,
      reason: 'fast_lane_sample_empty',
    })
  })

  it('rejects a sample where every canonical comparison row is missing', () => {
    expect(evaluateFastLaneShadowDiffSample(sample({
      canonicalMissingRows: 500,
      exactSourceMatches: 0,
      exactProjectionMatches: 0,
    }))).toEqual({
      passed: false,
      reason: 'canonical_comparison_population_empty',
    })
  })

  it('rejects a non-empty population without any exact source-position comparison', () => {
    expect(evaluateFastLaneShadowDiffSample(sample({
      canonicalMissingRows: 100,
      canonicalAheadRows: 200,
      fastAheadRows: 200,
      exactSourceMatches: 0,
      exactProjectionMatches: 0,
    }))).toEqual({
      passed: false,
      reason: 'exact_source_comparison_population_empty',
    })
  })

  it('rejects an exact source projection mismatch', () => {
    expect(evaluateFastLaneShadowDiffSample(sample({
      exactProjectionMatches: 499,
      exactProjectionMismatches: 1,
    }))).toEqual({
      passed: false,
      reason: 'exact_source_projection_mismatch',
    })
  })

  it('rejects an incomplete exact source comparison', () => {
    expect(evaluateFastLaneShadowDiffSample(sample({
      exactSourceMatches: 500,
      exactProjectionMatches: 499,
    }))).toEqual({
      passed: false,
      reason: 'exact_source_projection_comparison_incomplete',
    })
  })
})
