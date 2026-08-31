import { describe, expect, it } from 'vitest'

import {
  evaluateSoakObservation,
  shouldCaptureCompletionSample,
} from './soak-observation-policy.mjs'

function soundChecks() {
  return {
    current_state_age_within_600s: true,
    current_state_lag_within_10: true,
    current_state_advanced_since_previous: true,
    current_ledger_monotonic: true,
    readiness_passed: true,
    every_readiness_check_passed: true,
    collector_has_no_failures: true,
    deployment_identity_fixed: true,
    deployment_version_fixed: true,
    exactly_one_five_minute_cron: true,
  }
}

describe('soak observation policy', () => {
  it('accepts a normal passing observation', () => {
    const result = evaluateSoakObservation({
      passed: true,
      failedChecks: [],
      delaySeconds: 0.1,
      checks: soundChecks(),
    })

    expect(result.decision).toBe('accept')
    expect(result.sample.passed).toBe(true)
    expect(result.sample.observationPolicy.rawPassed).toBe(true)
  })

  it('defers only a delay-biased live lag observation after the final retry', () => {
    const checks = soundChecks()
    checks.current_state_lag_within_10 = false

    const result = evaluateSoakObservation({
      passed: false,
      failedChecks: ['current_state_lag_within_10'],
      delaySeconds: 62.229,
      checks,
      currentState: {
        ageSeconds: 76.97,
        lagLedgers: 23,
      },
    }, { attempt: 4, maxAttempts: 4 })

    expect(result.decision).toBe('accept_with_deferred_metrics')
    expect(result.sample.passed).toBe(true)
    expect(result.sample.failedChecks).toEqual([])
    expect(result.sample.observationPolicy.rawFailedChecks).toEqual(['current_state_lag_within_10'])
    expect(result.sample.observationPolicy.deferredToFinalRunMetrics).toEqual(['current_state_lag_within_10'])
  })

  it('does not soften a prompt live lag failure', () => {
    const checks = soundChecks()
    checks.current_state_lag_within_10 = false

    const result = evaluateSoakObservation({
      passed: false,
      failedChecks: ['current_state_lag_within_10'],
      delaySeconds: 0.2,
      checks,
    }, { attempt: 4, maxAttempts: 4 })

    expect(result.decision).toBe('reject')
    expect(result.sample.passed).toBe(false)
  })

  it('never softens a deployment or advancement failure', () => {
    const checks = soundChecks()
    checks.current_state_lag_within_10 = false
    checks.current_state_advanced_since_previous = false
    checks.deployment_identity_fixed = false

    const result = evaluateSoakObservation({
      passed: false,
      failedChecks: [
        'current_state_lag_within_10',
        'current_state_advanced_since_previous',
        'deployment_identity_fixed',
      ],
      delaySeconds: 62.229,
      checks,
    }, { attempt: 4, maxAttempts: 4 })

    expect(result.decision).toBe('reject')
    expect(result.sample.passed).toBe(false)
  })

  it('captures a completion sample only after all six segments and the full window', () => {
    const expectedEndMs = Date.parse('2026-07-14T04:56:03.485Z')

    expect(shouldCaptureCompletionSample({
      segmentIndexes: [1],
      expectedEndMs,
      nowMs: Date.parse('2026-07-13T07:37:25.392Z'),
    })).toBe(false)

    expect(shouldCaptureCompletionSample({
      segmentIndexes: [1, 2, 3, 4, 5, 6],
      expectedEndMs,
      nowMs: expectedEndMs - 1,
    })).toBe(false)

    expect(shouldCaptureCompletionSample({
      segmentIndexes: [1, 2, 3, 4, 5, 6],
      expectedEndMs,
      nowMs: expectedEndMs,
    })).toBe(true)
  })
})
