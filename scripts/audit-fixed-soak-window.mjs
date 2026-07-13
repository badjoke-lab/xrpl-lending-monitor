import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

import { captureSample } from './run-first-24h-soak-segment.mjs'
import { evaluateSoakObservation } from './soak-observation-policy.mjs'

const START_PATH = process.env.START_PATH ?? 'first-24h-soak-anchor/start.json'
const METRICS_PATH = process.env.METRICS_PATH ?? 'first-24h-soak-audit/metrics.json'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'first-24h-soak-audit'
const MAX_RUN_GAP_SECONDS = 420
const MAX_RUN_LAG_LEDGERS = 10
const MIN_EXPECTED_RUNS = 287
const MAX_EXPECTED_RUNS = 290

function iso(ms = Date.now()) {
  return new Date(ms).toISOString()
}

function parseIso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function readMetricRows(payload) {
  if (Array.isArray(payload)) return payload[0]?.results ?? []
  return payload?.result?.[0]?.results ?? []
}

function maxOrNull(values) {
  return values.length > 0 ? Math.max(...values) : null
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

export function evaluateFixedSoakWindow({ start, metrics, finalSample, nowMs = Date.now() }) {
  const t0Ms = parseIso(start?.t0Iso)
  const expectedEndMs = parseIso(start?.expectedEndIso)
  if (t0Ms === null || expectedEndMs === null || expectedEndMs - t0Ms !== 24 * 60 * 60 * 1000) {
    throw new Error('The soak anchor does not define one fixed 24-hour window')
  }

  const orderedMetrics = [...metrics]
    .filter((row) => {
      const runMs = parseIso(row?.run_at)
      return runMs !== null && runMs >= t0Ms && runMs <= expectedEndMs
    })
    .sort((a, b) => parseIso(a.run_at) - parseIso(b.run_at))

  const runTimes = orderedMetrics.map((row) => parseIso(row.run_at))
  const runGaps = []
  for (let index = 1; index < runTimes.length; index += 1) {
    runGaps.push((runTimes[index] - runTimes[index - 1]) / 1000)
  }

  const statuses = orderedMetrics.map((row) => row.status)
  const allowedStatuses = new Set(['committed', 'caught_up'])
  const lags = orderedMetrics.map((row) => Number(row.lag_ledgers)).filter(Number.isFinite)
  const firstRunDelaySeconds = runTimes.length > 0 ? (runTimes[0] - t0Ms) / 1000 : null
  const finalRunBeforeEndSeconds = runTimes.length > 0 ? (expectedEndMs - runTimes.at(-1)) / 1000 : null
  const fullWindowElapsed = nowMs >= expectedEndMs

  const checks = {
    anchor_start_state_passed: start?.firstSample?.passed === true,
    fixed_24_hour_window_elapsed: fullWindowElapsed,
    final_state_passed: finalSample?.passed === true,
    deployment_identity_still_fixed:
      finalSample?.checks?.deployment_identity_fixed === true
      && finalSample?.checks?.deployment_version_fixed === true,
    runtime_still_devnet: finalSample?.runtime?.appNetwork === 'devnet',
    mainnet_still_disabled: String(finalSample?.runtime?.mainnetEnabled).toLowerCase() === 'false',
    cron_still_single_five_minute:
      JSON.stringify(finalSample?.runtime?.schedules) === JSON.stringify(['*/5 * * * *']),
    checkpoint_still_fixed:
      finalSample?.checks?.overview_base_fixed === true
      && finalSample?.checks?.readiness_base_fixed === true,
    readiness_still_passed:
      finalSample?.checks?.readiness_passed === true
      && finalSample?.checks?.every_readiness_check_passed === true,
    collector_current_state_failure_free: finalSample?.checks?.collector_has_no_failures === true,
    metrics_cover_expected_cycles:
      orderedMetrics.length >= MIN_EXPECTED_RUNS && orderedMetrics.length <= MAX_EXPECTED_RUNS,
    metrics_only_success_statuses:
      statuses.length > 0 && statuses.every((status) => allowedStatuses.has(status)),
    no_reanchor: !statuses.includes('reanchored'),
    first_run_within_420s:
      firstRunDelaySeconds !== null
      && firstRunDelaySeconds >= 0
      && firstRunDelaySeconds <= MAX_RUN_GAP_SECONDS,
    last_run_reaches_window_end_within_420s:
      finalRunBeforeEndSeconds !== null
      && finalRunBeforeEndSeconds >= 0
      && finalRunBeforeEndSeconds <= MAX_RUN_GAP_SECONDS,
    maximum_run_gap_within_420s:
      runGaps.length > 0 && Math.max(...runGaps) <= MAX_RUN_GAP_SECONDS,
    exact_run_lag_within_10:
      lags.length === orderedMetrics.length && lags.every((lag) => lag <= MAX_RUN_LAG_LEDGERS),
    delayed_final_observation_backed_by_exact_metrics:
      !Array.isArray(finalSample?.observationPolicy?.deferredToFinalRunMetrics)
      || finalSample.observationPolicy.deferredToFinalRunMetrics.length === 0
      || (
        statuses.length > 0
        && statuses.every((status) => allowedStatuses.has(status))
        && runGaps.length > 0
        && Math.max(...runGaps) <= MAX_RUN_GAP_SECONDS
        && lags.length === orderedMetrics.length
        && lags.every((lag) => lag <= MAX_RUN_LAG_LEDGERS)
      ),
  }

  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const state = !fullWindowElapsed ? 'not_ready' : failedChecks.length === 0 ? 'passed' : 'failed'

  return {
    schemaVersion: 1,
    gate: 'first-24-hour-devnet-production-soak-fixed-window',
    generatedAt: iso(nowMs),
    anchor: {
      t0Iso: start.t0Iso,
      expectedEndIso: start.expectedEndIso,
      deployment: start.deployment,
    },
    metrics: {
      observedRuns: orderedMetrics.length,
      statuses: Object.fromEntries(
        [...new Set(statuses)].map((status) => [status, statuses.filter((item) => item === status).length]),
      ),
      firstRunDelaySeconds,
      lastRunBeforeEndSeconds: finalRunBeforeEndSeconds,
      maximumGapSeconds: maxOrNull(runGaps),
      p95GapSeconds: percentile(runGaps, 0.95),
      maximumLagLedgers: maxOrNull(lags),
      persistenceRowsRead: orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_read ?? 0), 0),
      persistenceRowsWritten: orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_written ?? 0), 0),
    },
    finalSample,
    checks,
    result: {
      passed: state === 'passed',
      state,
      failedChecks,
      clockResetRequired: false,
    },
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const start = await readJson(START_PATH)
  const metricsPayload = await readJson(METRICS_PATH)
  const metrics = readMetricRows(metricsPayload)
  const expectedEndMs = parseIso(start.expectedEndIso)

  if (expectedEndMs === null) throw new Error('The soak anchor expectedEndIso is invalid')

  const rawFinalSample = await captureSample({
    scheduledAt: start.expectedEndIso,
    previousUpdatedAt: start.firstSample?.currentState?.updatedAt ?? null,
    previousLedger: start.firstSample?.currentState?.ledgerIndex ?? null,
    startDeploymentId: start.deployment?.id ?? null,
    startVersionId: start.deployment?.versionId ?? null,
  })
  const finalSample = evaluateSoakObservation(rawFinalSample, { attempt: 4, maxAttempts: 4 }).sample
  const result = evaluateFixedSoakWindow({ start, metrics, finalSample })

  await writeJson(`${OUTPUT_DIR}/final-sample.json`, finalSample)
  await writeJson(`${OUTPUT_DIR}/result.json`, result)

  const markdown = [
    '# First 24-hour XRPL Devnet production soak — fixed-window audit',
    '',
    `- Result: **${result.result.state}**`,
    `- T0: **${result.anchor.t0Iso}**`,
    `- Expected end: **${result.anchor.expectedEndIso}**`,
    `- Exact D1 runs: **${result.metrics.observedRuns}**`,
    `- Maximum run gap: **${result.metrics.maximumGapSeconds ?? 'n/a'} seconds**`,
    `- Maximum exact run lag: **${result.metrics.maximumLagLedgers ?? 'n/a'} ledgers**`,
    `- Clock reset required: **${result.result.clockResetRequired}**`,
    `- Failed checks: **${result.result.failedChecks.length}**`,
    '',
    ...result.result.failedChecks.map((check) => `- ${check}`),
    '',
  ].join('\n')

  await writeFile(`${OUTPUT_DIR}/result.md`, markdown, 'utf8')
  console.log(markdown)
  if (!result.result.passed) process.exitCode = 1
}

const directInvocation = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]
if (directInvocation) {
  main().catch(async (error) => {
    await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
    await writeJson(`${OUTPUT_DIR}/fatal-error.json`, {
      generatedAt: iso(),
      error: error?.stack ?? error?.message ?? String(error),
    }).catch(() => {})
    console.error(error)
    process.exitCode = 1
  })
}
