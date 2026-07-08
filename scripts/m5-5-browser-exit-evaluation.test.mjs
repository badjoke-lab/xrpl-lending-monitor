import { describe, expect, it } from 'vitest'

import {
  EXPECTED_ROUTE_NAMES,
  REQUIRED_BEHAVIOR_CHECKS,
  evaluateM55BrowserExitEvidence,
} from './m5-5-browser-exit-evaluation.mjs'

function passingEvidence() {
  return {
    browserSummary: {
      collector: {
        status: 'healthy',
        cursor: 100,
        head: 100,
        lag: 0,
        consecutive_failures: 0,
      },
      witnesses: {
        lifecycle_selection_mode: 'bounded_set_intersection',
        lifecycle_detail_probes: 0,
      },
      request_counts: {
        discovery_logical_api_requests: 8,
        discovery_http_attempts: 8,
        browser_api_requests: 31,
      },
      routes: EXPECTED_ROUTE_NAMES.map((name) => ({ name, route: `/${name}`, heading: name, passed: true })),
      behavior_checks: REQUIRED_BEHAVIOR_CHECKS.map((check) => ({ check, passed: true })),
      technical_findings: [],
      result: {
        passed: true,
        route_count: EXPECTED_ROUTE_NAMES.length,
        behavior_check_count: REQUIRED_BEHAVIOR_CHECKS.length,
        human_visual_review_separate: true,
      },
    },
    d1Summary: {
      date_utc: '2026-07-09',
      rows_read_fraction: 0.2,
      rows_written_fraction: 0.1,
      required_headroom_fraction: 0.8,
      passed: true,
    },
    collectorPreflight: {
      status: 'healthy',
      cursor: { lag_ledgers: 0 },
      consecutive_failures: 0,
      error: null,
    },
  }
}

describe('M5-5 browser exit evidence evaluation', () => {
  it('passes complete browser evidence and marks it ready for exit reconciliation', () => {
    const evaluation = evaluateM55BrowserExitEvidence(passingEvidence())

    expect(evaluation.result.passed).toBe(true)
    expect(evaluation.result.ready_for_m5_5_exit_reconciliation).toBe(true)
    expect(evaluation.result.failed_checks).toEqual([])
  })

  it('fails when one required route is missing', () => {
    const evidence = passingEvidence()
    evidence.browserSummary.routes.pop()
    evidence.browserSummary.result.route_count -= 1

    const evaluation = evaluateM55BrowserExitEvidence(evidence)

    expect(evaluation.result.passed).toBe(false)
    expect(evaluation.result.failed_checks).toContain('exact_route_matrix')
    expect(evaluation.result.failed_checks).toContain('browser_result')
  })

  it('fails duplicate behavior evidence even when every item reports passed', () => {
    const evidence = passingEvidence()
    evidence.browserSummary.behavior_checks = [
      ...evidence.browserSummary.behavior_checks.slice(0, -1),
      { check: REQUIRED_BEHAVIOR_CHECKS[0], passed: true },
    ]

    const evaluation = evaluateM55BrowserExitEvidence(evidence)

    expect(evaluation.result.failed_checks).toContain('required_behavior_checks')
  })

  it('fails technical findings and an unhealthy collector preflight', () => {
    const evidence = passingEvidence()
    evidence.browserSummary.technical_findings.push({ type: 'http_5xx', status: 500 })
    evidence.collectorPreflight.cursor.lag_ledgers = 3

    const evaluation = evaluateM55BrowserExitEvidence(evidence)

    expect(evaluation.result.failed_checks).toContain('technical_findings_empty')
    expect(evaluation.result.failed_checks).toContain('preflight_collector_healthy')
  })

  it('fails a D1 summary that claims passed while exceeding the threshold', () => {
    const evidence = passingEvidence()
    evidence.d1Summary.rows_read_fraction = 0.84

    const evaluation = evaluateM55BrowserExitEvidence(evidence)

    expect(evaluation.result.failed_checks).toContain('d1_headroom_passed')
  })

  it('accepts bounded detail fallback up to four probes and rejects five', () => {
    const evidence = passingEvidence()
    evidence.browserSummary.witnesses.lifecycle_selection_mode = 'bounded_detail_fallback'
    evidence.browserSummary.witnesses.lifecycle_detail_probes = 4

    expect(evaluateM55BrowserExitEvidence(evidence).result.passed).toBe(true)

    evidence.browserSummary.witnesses.lifecycle_detail_probes = 5
    expect(evaluateM55BrowserExitEvidence(evidence).result.failed_checks).toContain('bounded_witness_selection')
  })

  it('fails when request-count evidence is absent or inconsistent', () => {
    const evidence = passingEvidence()
    evidence.browserSummary.request_counts.discovery_http_attempts = 4

    const evaluation = evaluateM55BrowserExitEvidence(evidence)

    expect(evaluation.result.failed_checks).toContain('request_count_evidence_present')
  })
})
