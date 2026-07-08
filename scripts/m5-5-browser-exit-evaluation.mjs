export const EXPECTED_ROUTE_NAMES = [
  'overview',
  'vaults',
  'vault-detail',
  'loan-brokers',
  'loan-broker-detail',
  'loans',
  'loan-detail',
  'activity',
  'transaction-detail',
  'lifecycle',
  'archived-objects',
  'archived-detail',
  'cover-loss',
  'search',
  'network-status',
]

export const REQUIRED_BEHAVIOR_CHECKS = [
  'vault_detail_rendering',
  'loan_broker_vault_link',
  'loan_relationship_links',
  'loan_lifecycle_history_rendering',
  'lifecycle_current_link',
  'archived_context_presentation',
  'search_current_loan_link',
  'network_status_freshness_presentation',
]

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string'))]
}

function exactSetMatch(actual, expected) {
  if (actual.length !== expected.length) return false
  const actualSet = new Set(actual)
  return expected.every((value) => actualSet.has(value))
}

function finiteNonNegative(value) {
  return Number.isFinite(value) && value >= 0
}

function addCheck(checks, name, passed, details = null) {
  checks.push({ name, passed: Boolean(passed), details })
}

export function evaluateM55BrowserExitEvidence({ browserSummary, d1Summary, collectorPreflight }) {
  const checks = []

  const routes = Array.isArray(browserSummary?.routes) ? browserSummary.routes : []
  const routeNames = routes.map((route) => route?.name)
  const uniqueRouteNames = uniqueStrings(routeNames)
  addCheck(
    checks,
    'exact_route_matrix',
    exactSetMatch(uniqueRouteNames, EXPECTED_ROUTE_NAMES)
      && routeNames.length === EXPECTED_ROUTE_NAMES.length
      && routes.every((route) => route?.passed === true),
    { expected: EXPECTED_ROUTE_NAMES, observed: routeNames },
  )

  const behaviors = Array.isArray(browserSummary?.behavior_checks) ? browserSummary.behavior_checks : []
  const behaviorNames = behaviors.map((item) => item?.check)
  const uniqueBehaviorNames = uniqueStrings(behaviorNames)
  addCheck(
    checks,
    'required_behavior_checks',
    exactSetMatch(uniqueBehaviorNames, REQUIRED_BEHAVIOR_CHECKS)
      && behaviorNames.length === REQUIRED_BEHAVIOR_CHECKS.length
      && behaviors.every((item) => item?.passed === true),
    { expected: REQUIRED_BEHAVIOR_CHECKS, observed: behaviorNames },
  )

  addCheck(
    checks,
    'browser_result',
    browserSummary?.result?.passed === true
      && browserSummary?.result?.route_count === EXPECTED_ROUTE_NAMES.length
      && browserSummary?.result?.behavior_check_count === REQUIRED_BEHAVIOR_CHECKS.length
      && browserSummary?.result?.human_visual_review_separate === true,
    browserSummary?.result ?? null,
  )

  const findings = Array.isArray(browserSummary?.technical_findings)
    ? browserSummary.technical_findings
    : null
  addCheck(checks, 'technical_findings_empty', Array.isArray(findings) && findings.length === 0, {
    finding_count: findings?.length ?? null,
  })

  const collector = browserSummary?.collector
  addCheck(
    checks,
    'browser_collector_healthy',
    collector?.status === 'healthy'
      && collector?.lag === 0
      && collector?.consecutive_failures === 0
      && Number.isFinite(collector?.cursor)
      && Number.isFinite(collector?.head),
    collector ?? null,
  )

  addCheck(
    checks,
    'preflight_collector_healthy',
    collectorPreflight?.status === 'healthy'
      && collectorPreflight?.cursor?.lag_ledgers === 0
      && collectorPreflight?.consecutive_failures === 0
      && collectorPreflight?.error === null,
    {
      status: collectorPreflight?.status ?? null,
      lag: collectorPreflight?.cursor?.lag_ledgers ?? null,
      consecutive_failures: collectorPreflight?.consecutive_failures ?? null,
      error: collectorPreflight?.error ?? null,
    },
  )

  addCheck(
    checks,
    'd1_headroom_passed',
    d1Summary?.passed === true
      && finiteNonNegative(d1Summary?.rows_read_fraction)
      && finiteNonNegative(d1Summary?.rows_written_fraction)
      && Number.isFinite(d1Summary?.required_headroom_fraction)
      && d1Summary.rows_read_fraction < d1Summary.required_headroom_fraction
      && d1Summary.rows_written_fraction < d1Summary.required_headroom_fraction,
    {
      date_utc: d1Summary?.date_utc ?? null,
      rows_read_fraction: d1Summary?.rows_read_fraction ?? null,
      rows_written_fraction: d1Summary?.rows_written_fraction ?? null,
      required_headroom_fraction: d1Summary?.required_headroom_fraction ?? null,
      passed: d1Summary?.passed ?? null,
    },
  )

  const witnessMode = browserSummary?.witnesses?.lifecycle_selection_mode
  const detailProbes = browserSummary?.witnesses?.lifecycle_detail_probes
  addCheck(
    checks,
    'bounded_witness_selection',
    ['bounded_set_intersection', 'bounded_detail_fallback'].includes(witnessMode)
      && Number.isSafeInteger(detailProbes)
      && detailProbes >= 0
      && detailProbes <= 4
      && (witnessMode !== 'bounded_set_intersection' || detailProbes === 0),
    { selection_mode: witnessMode ?? null, detail_probes: detailProbes ?? null },
  )

  const requestCounts = browserSummary?.request_counts
  addCheck(
    checks,
    'request_count_evidence_present',
    Number.isSafeInteger(requestCounts?.discovery_logical_api_requests)
      && requestCounts.discovery_logical_api_requests > 0
      && Number.isSafeInteger(requestCounts?.discovery_http_attempts)
      && requestCounts.discovery_http_attempts >= requestCounts.discovery_logical_api_requests
      && Number.isSafeInteger(requestCounts?.browser_api_requests)
      && requestCounts.browser_api_requests > 0,
    requestCounts ?? null,
  )

  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.name)

  return {
    evaluated_at: new Date().toISOString(),
    gate: 'm5-5-browser-exit-evidence',
    checks,
    result: {
      passed: failedChecks.length === 0,
      failed_checks: failedChecks,
      ready_for_m5_5_exit_reconciliation: failedChecks.length === 0,
      api_cross_audit_prerequisite: 'must remain satisfied by retained M5-5 production cross-audit evidence',
      human_screenshot_review_separate: true,
    },
  }
}

export function renderM55BrowserExitEvaluationMarkdown(evaluation) {
  const lines = [
    '# M5-5 browser exit evidence evaluation',
    '',
    `- Result: **${evaluation.result.passed ? 'passed' : 'failed'}**`,
    `- Ready for M5-5 exit reconciliation: **${evaluation.result.ready_for_m5_5_exit_reconciliation}**`,
    `- Failed checks: **${evaluation.result.failed_checks.length}**`,
    '',
    'Checks:',
    ...evaluation.checks.map((check) => `- ${check.name}: **${check.passed ? 'passed' : 'failed'}**`),
    '',
    'This evaluator covers browser-exit evidence only. Retained API cross-audit evidence remains a separate prerequisite for final M5-5 exit reconciliation.',
    'Human screenshot review remains a separate Track B requirement.',
    '',
  ]
  return lines.join('\n')
}
