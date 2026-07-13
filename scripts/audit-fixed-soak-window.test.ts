import { describe, expect, it } from 'vitest'

import { evaluateFixedSoakWindow } from './audit-fixed-soak-window.mjs'

const T0 = Date.parse('2026-07-13T08:15:00.000Z')
const FIRST_RUN = T0 + 5 * 60 * 1000
const FIRST_ELIGIBLE_END = FIRST_RUN + 24 * 60 * 60 * 1000

function anchor() {
  return {
    t0Iso: new Date(T0).toISOString(),
    expectedEndIso: new Date(T0 + 24 * 60 * 60 * 1000).toISOString(),
    deployment: { id: 'deployment-1', versionId: 'version-1' },
    firstSample: { passed: true },
  }
}

function metricRows(startMs: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    run_at: new Date(startMs + index * 5 * 60 * 1000).toISOString(),
    status: 'committed',
    lag_ledgers: 0,
    persistence_rows_read: 1,
    persistence_rows_written: 2,
  }))
}

function finalSample(): any {
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

describe('restart-safe soak audit', () => {
  it('passes from the immutable anchor and one continuous D1 sequence', () => {
    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metricRows(FIRST_RUN, 288),
      finalSample: finalSample(),
      nowMs: FIRST_ELIGIBLE_END,
    })

    expect(result.result.state).toBe('passed')
    expect(result.result.passed).toBe(true)
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.selectedWindow.observedRuns).toBe(288)
    expect(result.selectedWindow.maximumGapSeconds).toBe(300)
  })

  it('keeps the same anchor when an audit runs before 24 hours are available', () => {
    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metricRows(FIRST_RUN, 288),
      finalSample: finalSample(),
      nowMs: FIRST_ELIGIBLE_END - 1,
    })

    expect(result.result.state).toBe('not_ready')
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.result.retryWithSameAnchor).toBe(true)
    expect(result.anchor.t0Iso).toBe(new Date(T0).toISOString())
    expect(result.result.failedChecks).toContain('continuous_24h_window_found')
  })

  it('does not invent a new manual T0 after a real execution gap', () => {
    const rows = metricRows(FIRST_RUN, 288)
    rows.splice(100, 1)

    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: rows,
      finalSample: finalSample(),
      nowMs: FIRST_ELIGIBLE_END,
    })

    expect(result.result.state).toBe('not_ready')
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.result.retryWithSameAnchor).toBe(true)
    expect(result.metrics.discontinuities).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'execution_gap_exceeded', gapSeconds: 600 }),
    ]))
  })

  it('automatically accepts the first later 24-hour sequence after a real gap', () => {
    const firstSequence = metricRows(FIRST_RUN, 100)
    const secondStart = Date.parse(firstSequence.at(-1)!.run_at) + 10 * 60 * 1000
    const secondSequence = metricRows(secondStart, 288)

    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: [...firstSequence, ...secondSequence],
      finalSample: finalSample(),
      nowMs: secondStart + 24 * 60 * 60 * 1000,
    })

    expect(result.result.state).toBe('passed')
    expect(result.result.clockResetRequired).toBe(false)
    expect(result.anchor.t0Iso).toBe(new Date(T0).toISOString())
    expect(result.selectedWindow.startIso).toBe(new Date(secondStart).toISOString())
    expect(result.metrics.discontinuities).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'execution_gap_exceeded' }),
    ]))
  })

  it('backs a delayed final RPC observation with the selected exact D1 window', () => {
    const delayed = finalSample()
    delayed.observationPolicy.deferredToFinalRunMetrics = ['current_state_lag_within_10']

    const result = evaluateFixedSoakWindow({
      start: anchor(),
      metrics: metricRows(FIRST_RUN, 288),
      finalSample: delayed,
      nowMs: FIRST_ELIGIBLE_END,
    })

    expect(result.result.state).toBe('passed')
    expect(result.checks.delayed_final_observation_backed_by_exact_metrics).toBe(true)
  })
})
