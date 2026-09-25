import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { captureSample } from './run-first-24h-soak-segment.mjs'

const ARTIFACT_ROOT = process.env.ARTIFACT_ROOT ?? 'soak-artifacts'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'first-24h-soak-final'
const METRICS_PATH = process.env.METRICS_PATH ?? 'first-24h-soak-final/metrics.json'

function iso(ms = Date.now()) { return new Date(ms).toISOString() }
function parseIso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

async function walk(root) {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else out.push(full)
  }
  return out
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
  const index = Math.max(0, Math.ceil(p * sorted.length) - 1)
  return sorted[index]
}

function maxOrNull(values) {
  return values.length ? Math.max(...values) : null
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const files = await walk(ARTIFACT_ROOT)
  const startPath = files.find((file) => file.endsWith('/start.json') || file === path.join(ARTIFACT_ROOT, 'start.json'))
  if (!startPath) throw new Error('start.json is missing')
  const start = await readJson(startPath)

  const samples = []
  for (const file of files.filter((item) => item.endsWith('/samples.ndjson') || item === path.join(ARTIFACT_ROOT, 'samples.ndjson'))) {
    const text = await readFile(file, 'utf8')
    for (const line of text.split(/\r?\n/).filter(Boolean)) samples.push(JSON.parse(line))
  }
  samples.sort((a, b) => (parseIso(a.scheduledAt ?? a.capturedAt) ?? 0) - (parseIso(b.scheduledAt ?? b.capturedAt) ?? 0))

  const summaries = []
  for (const file of files.filter((item) => item.endsWith('/summary.json') || item === path.join(ARTIFACT_ROOT, 'summary.json'))) {
    const value = await readJson(file)
    if (Number.isInteger(value.segmentIndex)) summaries.push(value)
  }
  summaries.sort((a, b) => a.segmentIndex - b.segmentIndex)

  const lastSample = samples.at(-1)
  if (!lastSample) throw new Error('No soak samples were retained')
  const finalSample = await captureSample({
    scheduledAt: start.expectedEndIso,
    previousUpdatedAt: lastSample.currentState?.updatedAt ?? null,
    previousLedger: lastSample.currentState?.ledgerIndex ?? null,
    startDeploymentId: start.deployment?.id ?? null,
    startVersionId: start.deployment?.versionId ?? null,
  })
  await writeJson(`${OUTPUT_DIR}/final-sample.json`, finalSample)

  const metricsPayload = await readJson(METRICS_PATH)
  const metrics = Array.isArray(metricsPayload) ? (metricsPayload[0]?.results ?? []) : (metricsPayload?.result?.[0]?.results ?? [])
  const orderedMetrics = [...metrics].sort((a, b) => (parseIso(a.run_at) ?? 0) - (parseIso(b.run_at) ?? 0))
  const runTimes = orderedMetrics.map((row) => parseIso(row.run_at)).filter((value) => value !== null)
  const runGaps = []
  for (let index = 1; index < runTimes.length; index += 1) runGaps.push((runTimes[index] - runTimes[index - 1]) / 1000)

  const t0Ms = Number(start.t0EpochMs)
  const expectedEndMs = t0Ms + 24 * 60 * 60 * 1000
  const lastObservedMs = parseIso(finalSample.capturedAt) ?? 0
  const firstRunDelaySeconds = runTimes.length ? (runTimes[0] - t0Ms) / 1000 : null
  const finalRunAgeSeconds = runTimes.length ? (lastObservedMs - runTimes.at(-1)) / 1000 : null
  const statuses = orderedMetrics.map((row) => row.status)
  const allowedStatuses = new Set(['committed', 'caught_up'])
  const metricsReadRows = orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_read ?? 0), 0)
  const metricsWriteRows = orderedMetrics.reduce((sum, row) => sum + Number(row.persistence_rows_written ?? 0), 0)

  const sampleAges = samples.concat(finalSample).map((sample) => Number(sample.currentState?.ageSeconds)).filter(Number.isFinite)
  const sampleLags = samples.concat(finalSample).map((sample) => Number(sample.currentState?.lagLedgers)).filter(Number.isFinite)
  const sampleDelays = samples.map((sample) => Number(sample.delaySeconds)).filter(Number.isFinite)
  const segmentIndexes = summaries.map((summary) => summary.segmentIndex)

  const checks = {
    start_state_passed: start.firstSample?.passed === true,
    all_six_segments_present: JSON.stringify(segmentIndexes) === JSON.stringify([1, 2, 3, 4, 5, 6]),
    every_segment_passed: summaries.length === 6 && summaries.every((summary) => summary.passed === true && summary.sampleCount === 48),
    expected_sample_count: samples.length === 289,
    every_sample_passed: samples.every((sample) => sample.passed === true),
    final_sample_passed: finalSample.passed === true,
    full_24_hours_elapsed: lastObservedMs >= expectedEndMs,
    deployment_unchanged: finalSample.runtime?.deployment?.id === start.deployment?.id && finalSample.runtime?.deployment?.versionId === start.deployment?.versionId,
    runtime_remained_devnet: samples.concat(finalSample).every((sample) => sample.runtime?.appNetwork === 'devnet'),
    mainnet_remained_disabled: samples.concat(finalSample).every((sample) => String(sample.runtime?.mainnetEnabled).toLowerCase() === 'false'),
    cron_remained_single_five_minute: samples.concat(finalSample).every((sample) => JSON.stringify(sample.runtime?.schedules) === JSON.stringify(['*/5 * * * *'])),
    checkpoint_remained_fixed: samples.concat(finalSample).every((sample) => sample.checks?.overview_base_fixed === true && sample.checks?.readiness_base_fixed === true),
    no_projection_or_readiness_failure: samples.concat(finalSample).every((sample) => sample.checks?.every_readiness_check_passed === true && sample.checks?.readiness_passed === true),
    collector_remained_failure_free: samples.concat(finalSample).every((sample) => sample.collector?.consecutiveFailures === 0 && sample.collector?.error === null),
    metrics_cover_expected_cycles: orderedMetrics.length >= 287 && orderedMetrics.length <= 291,
    metrics_only_success_statuses: statuses.length > 0 && statuses.every((status) => allowedStatuses.has(status)),
    no_reanchor: !statuses.includes('reanchored'),
    maximum_run_gap_within_420s: runGaps.length > 0 && Math.max(...runGaps) <= 420,
    start_to_first_run_within_420s: firstRunDelaySeconds !== null && firstRunDelaySeconds >= 0 && firstRunDelaySeconds <= 420,
    last_run_to_final_sample_within_420s: finalRunAgeSeconds !== null && finalRunAgeSeconds >= 0 && finalRunAgeSeconds <= 420,
    run_metrics_lag_within_10: orderedMetrics.every((row) => Number(row.lag_ledgers ?? 0) <= 10),
  }

  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const result = {
    schemaVersion: 1,
    gate: 'first-24-hour-devnet-production-soak',
    generatedAt: iso(),
    t0Iso: start.t0Iso,
    expectedEndIso: start.expectedEndIso,
    actualEndIso: finalSample.capturedAt,
    production: {
      deployment: start.deployment,
      expected: start.expected,
    },
    samples: {
      expected: 289,
      observed: samples.length,
      segmentSummaries: summaries,
      maximumAgeSeconds: maxOrNull(sampleAges),
      maximumLagLedgers: maxOrNull(sampleLags),
      maximumSchedulerDelaySeconds: maxOrNull(sampleDelays),
    },
    fastLaneRuns: {
      observed: orderedMetrics.length,
      statuses: Object.fromEntries([...new Set(statuses)].map((status) => [status, statuses.filter((item) => item === status).length])),
      maximumGapSeconds: maxOrNull(runGaps),
      p95GapSeconds: percentile(runGaps, 0.95),
      firstRunDelaySeconds,
      finalRunAgeSeconds,
      maximumLagLedgers: maxOrNull(orderedMetrics.map((row) => Number(row.lag_ledgers ?? 0))),
      persistenceRowsRead: metricsReadRows,
      persistenceRowsWritten: metricsWriteRows,
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
    '# First 24-hour XRPL Devnet production soak',
    '',
    `- Result: **${result.result.passed ? 'passed' : 'failed'}**`,
    `- Start: \`${result.t0Iso}\``,
    `- End: \`${result.actualEndIso}\``,
    `- Samples: **${result.samples.observed}/${result.samples.expected}**`,
    `- Fast-lane runs: **${result.fastLaneRuns.observed}**`,
    `- Maximum run gap: **${result.fastLaneRuns.maximumGapSeconds ?? 'n/a'} seconds**`,
    `- Maximum public lag: **${result.samples.maximumLagLedgers ?? 'n/a'} ledgers**`,
    `- Maximum public age: **${result.samples.maximumAgeSeconds ?? 'n/a'} seconds**`,
    `- Reanchors: **${statuses.filter((status) => status === 'reanchored').length}**`,
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
  await writeJson(`${OUTPUT_DIR}/fatal-error.json`, { generatedAt: iso(), error: error?.stack ?? error?.message ?? String(error) }).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
