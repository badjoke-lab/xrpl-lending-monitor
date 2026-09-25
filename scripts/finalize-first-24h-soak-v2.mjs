import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { captureSample } from './run-first-24h-soak-segment.mjs'
import {
  evaluateSoakObservation,
  shouldCaptureCompletionSample,
} from './soak-observation-policy.mjs'

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT ?? 'stable-soak-artifacts'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'stable-soak-final-v2'
const METRICS_PATH = process.env.METRICS_PATH ?? `${OUTPUT_DIR}/metrics.json`

function iso(ms = Date.now()) {
  return new Date(ms).toISOString()
}

function parseIso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

async function walk(root) {
  const output = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) output.push(...await walk(full))
    else output.push(full)
  }
  return output
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

function maxOrNull(values) {
  return values.length > 0 ? Math.max(...values) : null
}

function readMetricRows(payload) {
  if (Array.isArray(payload)) return payload[0]?.results ?? []
  return payload?.result?.[0]?.results ?? []
}

async function readNdjsonFiles(files) {
  const rows = []
  for (const file of files) {
    const text = await readFile(file, 'utf8')
    for (const line of text.split(/\r?\n/).filter(Boolean)) rows.push(JSON.parse(line))
  }
  return rows
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const files = await walk(ARTIFACT_ROOT)
  const startPath = files.find((file) => file.endsWith('/start.json') || file === path.join(ARTIFACT_ROOT, 'start.json'))
  if (!startPath) throw new Error('start.json is missing')

  const start = await readJson(startPath)
  const samples = await readNdjsonFiles(files.filter((file) => file.endsWith('/samples.ndjson')))
  samples.sort((a, b) => (parseIso(a.scheduledAt ?? a.capturedAt) ?? 0) - (parseIso(b.scheduledAt ?? b.capturedAt) ?? 0))

  const attempts = await readNdjsonFiles(files.filter((file) => file.endsWith('/attempts.ndjson')))
  const summaries = []
  for (const file of files.filter((item) => item.endsWith('/summary.json'))) {
    const value = await readJson(file)
    if (Number.isInteger(value.segmentIndex)) summaries.push(value)
  }
  summaries.sort((a, b) => a.segmentIndex - b.segmentIndex)

  const segmentIndexes = summaries.map((summary) => summary.segmentIndex)
  const t0Ms = Number(start.t0EpochMs)
  const expectedEndMs = t0Ms + 24 * 60 * 60 * 1000
  const completeWindow = shouldCaptureCompletionSample({
    segmentIndexes,
    expectedEndMs,
    nowMs: Date.now(),
  })

  let finalSample = null
  if (completeWindow) {
    const lastSample = samples.at(-1)
    if (!lastSample) throw new Error('No soak samples were retained')
    const rawFinalSample = await captureSample({
      scheduledAt: start.expectedEndIso,
      previousUpdatedAt: lastSample.currentState?.updatedAt ?? null,
      previousLedger: lastSample.currentState?.ledgerIndex ?? null,
      startDeploymentId: start.deployment?.id ?? null,
      startVersionId: start.deployment?.versionId ?? null,
    })
    finalSample = evaluateSoakObservation(rawFinalSample, { attempt: 4, maxAttempts: 4 }).sample
    await writeJson(`${OUTPUT_DIR}/final-sample.json`, finalSample)
  } else {
    await writeJson(`${OUTPUT_DIR}/termination.json`, {
      generatedAt: iso(),
      state: 'incomplete',
      reason: 'all six successful segments and the full 24-hour window were not present',
      segmentIndexes,
      expectedEndIso: start.expectedEndIso,
      actualTerminationIso: iso(),
      finalSampleCaptured: false,
    })
  }

  const metricsPayload = await readJson(METRICS_PATH)
  const orderedMetrics = [...readMetricRows(metricsPayload)].sort((a, b) => (parseIso(a.run_at) ?? 0) - (parseIso(b.run_at) ?? 0))
  const runTimes = orderedMetrics.map((row) => parseIso(row.run_at)).filter((value) => value !== null)
  const runGaps = []
  for (let index = 1; index < runTimes.length; index += 1) runGaps.push((runTimes[index] - runTimes[index - 1]) / 1000)

  const lastObservedMs = finalSample ? (parseIso(finalSample.capturedAt) ?? 0) : Date.now()
  const firstRunDelaySeconds = runTimes.length > 0 ? (runTimes[0] - t0Ms) / 1000 : null
  const finalRunAgeSeconds = runTimes.length > 0 ? (lastObservedMs - runTimes.at(-1)) / 1000 : null
  const statuses = orderedMetrics.map((row) => row.status)
  const allowedStatuses = new Set(['committed', 'caught_up'])
  const metricLags = orderedMetrics.map((row) => Number(row.lag_ledgers ?? 0))
  const metricsOnlySuccess = statuses.length > 0 && statuses.every((status) => allowedStatuses.has(status))
  const metricsGapPassed = runGaps.length > 0 && Math.max(...runGaps) <= 420
  const metricsLagPassed = orderedMetrics.length > 0 && metricLags.every((lag) => lag <= 10)

  const allObservations = finalSample ? [...samples, finalSample] : samples
  const deferredObservations = allObservations.filter((sample) =>
    Array.isArray(sample?.observationPolicy?.deferredToFinalRunMetrics)
    && sample.observationPolicy.deferredToFinalRunMetrics.length > 0)

  const checks = {
    start_state_passed: start.firstSample?.passed === true,
    all_six_segments_present: JSON.stringify(segmentIndexes) === JSON.stringify([1, 2, 3, 4, 5, 6]),
    every_segment_passed: summaries.length === 6 && summaries.every((summary) => summary.passed === true && summary.sampleCount === 48),
    expected_sample_count: samples.length === 289,
    every_sample_passed: samples.length > 0 && samples.every((sample) => sample.passed === true),
    every_segment_attempt_retained: summaries.length === 6 && attempts.length >= 288,
    final_sample_captured_only_after_completion: completeWindow === (finalSample !== null),
    final_sample_passed: finalSample?.passed === true,
    full_24_hours_elapsed: finalSample !== null && (parseIso(finalSample.capturedAt) ?? 0) >= expectedEndMs,
    deployment_unchanged: allObservations.length > 0 && allObservations.every((sample) => sample.checks?.deployment_identity_fixed === true && sample.checks?.deployment_version_fixed === true),
    runtime_remained_devnet: allObservations.length > 0 && allObservations.every((sample) => sample.runtime?.appNetwork === 'devnet'),
    mainnet_remained_disabled: allObservations.length > 0 && allObservations.every((sample) => String(sample.runtime?.mainnetEnabled).toLowerCase() === 'false'),
    cron_remained_single_five_minute: allObservations.length > 0 && allObservations.every((sample) => JSON.stringify(sample.runtime?.schedules) === JSON.stringify(['*/5 * * * *'])),
    checkpoint_remained_fixed: allObservations.length > 0 && allObservations.every((sample) => sample.checks?.overview_base_fixed === true && sample.checks?.readiness_base_fixed === true),
    no_projection_or_readiness_failure: allObservations.length > 0 && allObservations.every((sample) => sample.checks?.every_readiness_check_passed === true && sample.checks?.readiness_passed === true),
    collector_remained_failure_free: allObservations.length > 0 && allObservations.every((sample) => sample.collector?.consecutiveFailures === 0 && sample.collector?.error === null),
    metrics_cover_expected_cycles: orderedMetrics.length >= 287 && orderedMetrics.length <= 291,
    metrics_only_success_statuses: metricsOnlySuccess,
    no_reanchor: !statuses.includes('reanchored'),
    maximum_run_gap_within_420s: metricsGapPassed,
    start_to_first_run_within_420s: firstRunDelaySeconds !== null && firstRunDelaySeconds >= 0 && firstRunDelaySeconds <= 420,
    last_run_to_final_sample_within_420s: finalSample !== null && finalRunAgeSeconds !== null && finalRunAgeSeconds >= 0 && finalRunAgeSeconds <= 420,
    run_metrics_lag_within_10: metricsLagPassed,
    delayed_observations_backed_by_exact_run_metrics:
      deferredObservations.length === 0 || (metricsOnlySuccess && metricsGapPassed && metricsLagPassed),
  }

  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const sampleAges = allObservations.map((sample) => Number(sample.currentState?.ageSeconds)).filter(Number.isFinite)
  const sampleLags = allObservations.map((sample) => Number(sample.currentState?.lagLedgers)).filter(Number.isFinite)
  const sampleDelays = samples.map((sample) => Number(sample.delaySeconds)).filter(Number.isFinite)

  const result = {
    schemaVersion: 2,
    gate: 'first-24-hour-devnet-production-soak',
    generatedAt: iso(),
    t0Iso: start.t0Iso,
    expectedEndIso: start.expectedEndIso,
    actualEndIso: finalSample?.capturedAt ?? null,
    incompleteTermination: finalSample === null,
    samples: {
      expected: 289,
      observed: samples.length,
      attemptRecords: attempts.length,
      segmentSummaries: summaries,
      deferredMetricObservations: deferredObservations.length,
      maximumAgeSeconds: maxOrNull(sampleAges),
      maximumObservedLiveLagLedgers: maxOrNull(sampleLags),
      maximumSchedulerDelaySeconds: maxOrNull(sampleDelays),
    },
    fastLaneRuns: {
      observed: orderedMetrics.length,
      statuses: Object.fromEntries([...new Set(statuses)].map((status) => [status, statuses.filter((item) => item === status).length])),
      maximumGapSeconds: maxOrNull(runGaps),
      p95GapSeconds: percentile(runGaps, 0.95),
      firstRunDelaySeconds,
      finalRunAgeSeconds,
      maximumLagLedgers: maxOrNull(metricLags),
      persistenceRowsRead: orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_read ?? 0), 0),
      persistenceRowsWritten: orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_written ?? 0), 0),
    },
    checks,
    result: {
      passed: failedChecks.length === 0,
      failedChecks,
      state: failedChecks.length === 0 ? 'passed' : 'failed',
    },
  }

  await writeJson(`${OUTPUT_DIR}/result.json`, result)
  const markdown = [
    '# First 24-hour XRPL Devnet production soak v2',
    '',
    `- Result: **${result.result.passed ? 'passed' : 'failed'}**`,
    `- Incomplete termination: **${result.incompleteTermination}**`,
    `- Samples: **${result.samples.observed}/${result.samples.expected}**`,
    `- Attempt records: **${result.samples.attemptRecords}**`,
    `- Deferred observations: **${result.samples.deferredMetricObservations}**`,
    `- Fast-lane runs: **${result.fastLaneRuns.observed}**`,
    `- Maximum exact run gap: **${result.fastLaneRuns.maximumGapSeconds ?? 'n/a'} seconds**`,
    `- Maximum exact run lag: **${result.fastLaneRuns.maximumLagLedgers ?? 'n/a'} ledgers**`,
    `- Failed checks: **${failedChecks.length}**`,
    '',
    ...failedChecks.map((check) => `- ${check}`),
    '',
  ].join('\n')
  await writeFile(`${OUTPUT_DIR}/result.md`, markdown, 'utf8')
  console.log(markdown)
  if (!result.result.passed) process.exitCode = 1
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
  await writeJson(`${OUTPUT_DIR}/fatal-error.json`, {
    generatedAt: iso(),
    error: error?.stack ?? error?.message ?? String(error),
  }).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
