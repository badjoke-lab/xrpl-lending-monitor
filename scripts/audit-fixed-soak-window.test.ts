import { describe, expect, it } from 'vitest'

import { evaluateFixedSoakWindow } from './audit-fixed-soak-window.mjs'

const T0 = Date.parse('2026-07-13T08:15:00.000Z')
const END = T0 + 24 * 60 * 60 * 1000

function anchor() {
  return {
    t0Iso: new Date(T0).toISOString(),
    expectedEndIso: new Date(END).toISOString(),
    deployment: { id: 'deployment-1', versionId: 'version-1' },
    firstSample: { passed: true },
  }
}

function metrics() {
  return Array.from({ length: 288 }, (_, index) => ({
    run_at: new Date(T0 + (index + 1) * 5 * 60 * 1000).toISOString(),
    status: 'committed',
    lag_ledgers: 0,
    persistence_rows_read: 1,
    persistence_rows_written: 2,
  }))
}

function finalSample() {
  return {
    passed: true,
    failedChecks: [],
    checks: {
      deployment_identity_fixed: true,
      deployment_version_fixed: true,
      overview_base_fixed: true,
      readiness_base_fixed: true,
      readiness_passed: true,
      every_readiness_check_passed: true,
      collector_has_no_failures: true,
    },
    runtime: {
      appNetwork: 'devnet',
      mainnetEnabled: 'false',
      schedules: ['*/5 * * * *'],
    },
    observationPolicy: {
      deferredToFinalRunMetrics: [],
    },
  }
}

describe('fixed-window soak audit', () => {
  it('passes from the immutable anchor and exact D1 runs without monitor artifacts', () => {
    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metrics(),
      finalSample: finalSample(),
      nowMs: END,
    })

    expect(result.result.state).toBe('passed')
    expect(result.result.passed).toBe(true)
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.metrics.observedRuns).toBe(288)
    expect(result.metrics.maximumGapSeconds).toBe(300)
  })

  it('keeps the same clock when an audit is run before the window ends', () => {
    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metrics(),
      finalSample: finalSample(),
      nowMs: END - 1,
    })

    expect(result.result.state).toBe('not_ready')
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.anchor.t0Iso).toBe(new Date(T0).toISOString())
    expect(result.result.failedChecks).toContain('fixed_24_hour_window_elapsed')
  })

  it('fails a real D1 execution gap without inventing a new T0', () => {
    const rows = metrics()
    rows.splice(100, 1)

    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: rows,
      finalSample: finalSample(),
      nowMs: END,
    })

    expect(result.result.state).toBe('failed')
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.result.failedChecks).toContain('maximum_run_gap_within_420s')
    expect(result.metrics.maximumGapSeconds).toBe(600)
  })

  it('allows a delayed final RPC observation only when exact D1 metrics support it', () => {
    const delayed = finalSample()
    delayed.observationPolicy.deferredToFinalRunMetrics = ['current_state_lag_within_10']

    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metrics(),
      finalSample: delayed,
      nowMs: END,
    })

    expect(result.result.state).toBe('passed')
    expect(result.checks.delayed_final_observation_backed_by_exact_metrics).toBe(true)
  })
})
