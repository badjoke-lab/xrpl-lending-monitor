import { readFileSync } from 'node:fs'

const runStatus = process.env.RUN_STATUS ?? 'unknown'
const runId = process.env.RUN_ID ?? 'unknown'
const runUrl = process.env.RUN_URL ?? 'unknown'
const headSha = process.env.HEAD_SHA ?? 'unknown'
const directory = 'supabase-remote-probe-evidence'

function read(name) {
  try {
    return JSON.parse(readFileSync(`${directory}/${name}`, 'utf8'))
  } catch {
    return null
  }
}

const success = read('verified-resource-headroom-guard.json')
const failure = read('failed-resource-headroom-guard-verification.json')
const external = read('resource-external-snapshot.json')
const externalFailure = read('failed-resource-external-snapshot.json')
const runtime = read('runtime-resource-log-snapshot.json')
const runtimeFailure = read('failed-runtime-resource-log-snapshot.json')
const orgUsage = read('org-usage-billing-snapshot.json')
const orgUsageFailure = read('failed-org-usage-billing-snapshot.json')
const bundle = read('resource-headroom-guard-bundle.json')
const lines = [
  '',
  '## R4C2d resource headroom guard',
  '',
  `- run: [${runId}](${runUrl})`,
  `- commit: \`${headSha}\``,
  `- job status: \`${runStatus}\``,
]

if (bundle) {
  lines.push(
    `- resource guard bundle bytes: \`${String(bundle.bytes ?? 'unknown')}\``,
    `- resource guard bundle sha256: \`${String(bundle.sha256 ?? 'unknown')}\``,
    `- resource guard bundle relative imports: \`${String(bundle.relativeImports ?? 'unknown')}\``,
    `- resource guard bundle Cloudflare imports: \`${String(bundle.cloudflareImports ?? 'unknown')}\``,
  )
}

if (external) {
  lines.push(
    '- external resource snapshot: `success`',
    `- external snapshot observed at: \`${String(external.observedAt ?? 'unknown')}\``,
    `- external snapshot digest: \`${String(external.evidenceDigest ?? 'unknown')}\``,
    `- Management API available: \`${String(external.checks?.managementApiAvailable ?? 'unknown')}\``,
    `- invocation source: \`${String(external.invocationSource ?? 'unknown')}\``,
    `- Logs backend required: \`${String(!(external.checks?.logsBackendNotRequired ?? false))}\``,
    `- Edge invocations 24h: \`${String(external.invocationCount24h ?? 'unknown')}\``,
    `- projected Edge invocations 31d: \`${String(external.projectedInvocations31d ?? 'unknown')}\``,
    `- active function count: \`${String(external.functionCount ?? 'unknown')}\``,
    `- exact bundle count: \`${String(external.bundleCount ?? 'unknown')}\``,
    `- maximum bundle bytes: \`${String(external.maxBundleBytes ?? 'unknown')}\``,
    `- maximum bundle function: \`${String(external.maxBundleName ?? 'unknown')}\``,
  )
} else if (externalFailure) {
  lines.push(
    '- external resource snapshot: `failed`',
    `- external snapshot failed at: \`${String(externalFailure.failedAt ?? 'unknown')}\``,
    `- external snapshot reason: \`${String(externalFailure.reason ?? 'unknown')}\``,
  )
} else {
  lines.push('- external resource snapshot: `not reached or no sanitized evidence produced`')
}

if (runtime) {
  lines.push(
    '- function combined-statistics snapshot: `success`',
    `- combined statistics observed at: \`${String(runtime.observedAt ?? 'unknown')}\``,
    `- combined statistics interval: \`${String(runtime.interval ?? 'unknown')}\``,
    `- active functions covered: \`${String(runtime.functionCount ?? 'unknown')}\``,
    `- metric rows: \`${String(runtime.metricRowCount ?? 'unknown')}\``,
    `- classified invocations: \`${String(runtime.invocationCount24h ?? 'unknown')}\``,
    `- total requests: \`${String(runtime.requestsCount24h ?? 'unknown')}\``,
    `- max CPU ms p50/p95/max: \`${String(runtime.maxCpuMilliseconds?.p50 ?? 'unknown')} / ${String(runtime.maxCpuMilliseconds?.p95 ?? 'unknown')} / ${String(runtime.maxCpuMilliseconds?.maximum ?? 'unknown')}\``,
    `- average memory MB p50/p95/max: \`${String(runtime.averageMemoryMegabytes?.p50 ?? 'unknown')} / ${String(runtime.averageMemoryMegabytes?.p95 ?? 'unknown')} / ${String(runtime.averageMemoryMegabytes?.maximum ?? 'unknown')}\``,
    `- max execution ms p50/p95/max: \`${String(runtime.maxExecutionMilliseconds?.p50 ?? 'unknown')} / ${String(runtime.maxExecutionMilliseconds?.p95 ?? 'unknown')} / ${String(runtime.maxExecutionMilliseconds?.maximum ?? 'unknown')}\``,
    `- CPU below halt threshold: \`${String(runtime.checks?.cpuBelowHaltThreshold ?? 'unknown')}\``,
    `- average memory below halt threshold: \`${String(runtime.checks?.averageMemoryBelowHaltThreshold ?? 'unknown')}\``,
    `- exact memory maximum covered: \`${String(runtime.checks?.exactMemoryMaximumCovered ?? 'unknown')}\``,
    `- raw analytics rows retained: \`${String(runtime.checks?.rawAnalyticsRowsRetained ?? 'unknown')}\``,
    `- function IDs retained: \`${String(runtime.checks?.functionIdsRetained ?? 'unknown')}\``,
  )
} else if (runtimeFailure) {
  lines.push(
    '- function combined-statistics snapshot: `failed`',
    `- combined statistics failed at: \`${String(runtimeFailure.failedAt ?? 'unknown')}\``,
    `- combined statistics reason: \`${String(runtimeFailure.reason ?? 'unknown')}\``,
  )
} else {
  lines.push('- function combined-statistics snapshot: `not reached or no sanitized evidence produced`')
}

if (orgUsage) {
  lines.push(
    '- organization usage and billing snapshot: `success`',
    `- organization usage observed at: \`${String(orgUsage.observedAt ?? 'unknown')}\``,
    `- organization usage window: \`${String(orgUsage.windowStart ?? 'unknown')} .. ${String(orgUsage.windowEnd ?? 'unknown')}\``,
    `- organization plan: \`${String(orgUsage.planId ?? 'unknown')}\``,
    `- automatic overage enabled: \`${String(orgUsage.usageBillingEnabled ?? 'unknown')}\``,
    `- uncached egress bytes 31d: \`${String(orgUsage.uncachedEgressBytes31d ?? 'unknown')}\``,
    `- cached egress bytes 31d: \`${String(orgUsage.cachedEgressBytes31d ?? 'unknown')}\``,
    `- function invocations 31d: \`${String(orgUsage.functionInvocations31d ?? 'unknown')}\``,
    `- Free plan confirmed: \`${String(orgUsage.checks?.freePlanConfirmed ?? 'unknown')}\``,
    `- provider no-charge state confirmed: \`${String(orgUsage.checks?.providerNoChargeStateConfirmed ?? 'unknown')}\``,
    `- uncached egress below halt threshold: \`${String(orgUsage.checks?.uncachedEgressBelowHaltThreshold ?? 'unknown')}\``,
    `- cached egress below halt threshold: \`${String(orgUsage.checks?.cachedEgressBelowHaltThreshold ?? 'unknown')}\``,
    `- organization slug retained: \`${String(orgUsage.checks?.organizationSlugRetained ?? 'unknown')}\``,
    `- billing identifiers retained: \`${String(orgUsage.checks?.billingIdentifiersRetained ?? 'unknown')}\``,
  )
} else if (orgUsageFailure) {
  lines.push(
    '- organization usage and billing snapshot: `failed`',
    `- organization usage failed at: \`${String(orgUsageFailure.failedAt ?? 'unknown')}\``,
    `- organization usage reason: \`${String(orgUsageFailure.reason ?? 'unknown')}\``,
  )
} else {
  lines.push('- organization usage and billing snapshot: `not reached or no sanitized evidence produced`')
}

if (success) {
  const snapshot = success.liveSnapshot ?? {}
  const measurements = snapshot.measurements ?? {}
  const coverage = snapshot.coverage ?? {}
  const failures = Array.isArray(snapshot.failures)
    ? snapshot.failures.map((entry) => entry?.kind).filter(Boolean)
    : []
  lines.push(
    '- resource headroom guard verifier: `success`',
    `- resource guard verified at: \`${String(success.verifiedAt ?? 'unknown')}\``,
    `- external snapshot fresh: \`${String(success.checks?.externalSnapshotFresh ?? 'unknown')}\``,
    `- function invocation coverage: \`${String(success.checks?.functionInvocationCoverage ?? 'unknown')}\``,
    `- bundle size coverage: \`${String(success.checks?.bundleSizeCoverage ?? 'unknown')}\``,
    `- six fail-closed thresholds proved: \`${String(success.checks?.sixFailClosedThresholdsProved ?? 'unknown')}\``,
    `- pre-reservation halt proved: \`${String(success.checks?.preReservationHaltProved ?? 'unknown')}\``,
    `- active profile read only: \`${String(success.checks?.activeProfileReadOnly ?? 'unknown')}\``,
    `- current guard allowed: \`${String(snapshot.allowed ?? 'unknown')}\``,
    `- current guard failures: \`${JSON.stringify(failures)}\``,
    `- database bytes: \`${String(measurements.databaseBytes ?? 'unknown')}\``,
    `- database connections: \`${String(measurements.connectionCount ?? 'unknown')}\``,
    `- max Edge wall ms 24h: \`${String(measurements.maxEdgeWallMilliseconds24h ?? 'unknown')}\``,
    `- Edge invocations 24h recorded: \`${String(measurements.invocationCount24h ?? 'unknown')}\``,
    `- projected Edge invocations 31d recorded: \`${String(measurements.projectedInvocations31d ?? 'unknown')}\``,
    `- maximum bundle bytes recorded: \`${String(measurements.maxBundleBytes ?? 'unknown')}\``,
    `- CPU coverage: \`${String(coverage.edgeCpu ?? 'unknown')}\``,
    `- memory coverage: \`${String(coverage.edgeMemory ?? 'unknown')}\``,
    `- bandwidth coverage: \`${String(coverage.bandwidth ?? 'unknown')}\``,
    `- billing and overage coverage: \`${String(coverage.billingAndOverage ?? 'unknown')}\``,
    `- G8 qualified: \`${String(success.checks?.g8Qualified ?? 'unknown')}\``,
    `- profile selected: \`${String(success.checks?.profileSelected ?? 'unknown')}\``,
  )
} else if (failure) {
  lines.push(
    '- resource headroom guard verifier: `failed`',
    `- resource guard failed at: \`${String(failure.failedAt ?? 'unknown')}\``,
    `- resource guard reason: \`${String(failure.reason ?? 'unknown')}\``,
  )
} else {
  lines.push('- resource headroom guard verifier: `not reached or no sanitized evidence produced`')
}

process.stdout.write(`${lines.join('\n')}\n`)