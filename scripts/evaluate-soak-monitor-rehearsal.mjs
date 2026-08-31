import { readFile, writeFile, mkdir } from 'node:fs/promises'
import process from 'node:process'

const START_DIR = process.env.START_DIR ?? 'soak-rehearsal-start'
const SEGMENT_DIR = process.env.SEGMENT_DIR ?? 'soak-rehearsal-segment'
const METRICS_PATH = process.env.METRICS_PATH ?? 'soak-rehearsal-result/metrics.json'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'soak-rehearsal-result'

function parseIso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

async function readNdjson(file) {
  const text = await readFile(file, 'utf8')
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function metricRows(payload) {
  if (Array.isArray(payload)) return payload[0]?.results ?? []
  return payload?.result?.[0]?.results ?? []
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const start = await readJson(`${START_DIR}/start.json`)
  const summary = await readJson(`${SEGMENT_DIR}/summary.json`)
  const samples = await readNdjson(`${SEGMENT_DIR}/samples.ndjson`)
  const attempts = await readNdjson(`${SEGMENT_DIR}/attempts.ndjson`)
  const metrics = metricRows(await readJson(METRICS_PATH))
    .sort((a, b) => (parseIso(a.run_at) ?? 0) - (parseIso(b.run_at) ?? 0))

  const runTimes = metrics.map((row) => parseIso(row.run_at)).filter((value) => value !== null)
  const runGaps = []
  for (let index = 1; index < runTimes.length; index += 1) runGaps.push((runTimes[index] - runTimes[index - 1]) / 1000)

  const statuses = metrics.map((row) => row.status)
  const allowedStatuses = new Set(['committed', 'caught_up'])
  const deferred = samples.filter((sample) =>
    Array.isArray(sample?.observationPolicy?.deferredToFinalRunMetrics)
    && sample.observationPolicy.deferredToFinalRunMetrics.length > 0)

  const checks = {
    start_passed: start.firstSample?.passed === true,
    four_samples_retained: summary.sampleCount === 4 && samples.length === 4,
    segment_passed: summary.passed === true && samples.every((sample) => sample.passed === true),
    every_attempt_retained: attempts.length >= 4,
    exact_runs_present: metrics.length >= 3 && metrics.length <= 6,
    exact_runs_only_success_statuses: statuses.length > 0 && statuses.every((status) => allowedStatuses.has(status)),
    exact_run_gap_within_420s: runGaps.length > 0 && Math.max(...runGaps) <= 420,
    exact_run_lag_within_10: metrics.length > 0 && metrics.every((row) => Number(row.lag_ledgers ?? 0) <= 10),
    no_reanchor: !statuses.includes('reanchored'),
    deferred_observations_backed_by_exact_metrics:
      deferred.length === 0
      || (
        statuses.every((status) => allowedStatuses.has(status))
        && runGaps.length > 0
        && Math.max(...runGaps) <= 420
        && metrics.every((row) => Number(row.lag_ledgers ?? 0) <= 10)
      ),
  }

  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    start: start.t0Iso,
    samples: samples.length,
    attempts: attempts.length,
    deferredObservations: deferred.length,
    exactRuns: metrics.length,
    maximumRunGapSeconds: runGaps.length > 0 ? Math.max(...runGaps) : null,
    maximumRunLagLedgers: metrics.length > 0 ? Math.max(...metrics.map((row) => Number(row.lag_ledgers ?? 0))) : null,
    checks,
    passed: failedChecks.length === 0,
    failedChecks,
  }

  await writeJson(`${OUTPUT_DIR}/result.json`, result)
  await writeFile(`${OUTPUT_DIR}/result.md`, [
    '# Soak monitor rehearsal',
    '',
    `- Result: **${result.passed ? 'passed' : 'failed'}**`,
    `- Samples: **${result.samples}/4**`,
    `- Attempts retained: **${result.attempts}**`,
    `- Deferred observations: **${result.deferredObservations}**`,
    `- Exact fast-lane runs: **${result.exactRuns}**`,
    `- Maximum exact run gap: **${result.maximumRunGapSeconds ?? 'n/a'} seconds**`,
    `- Maximum exact run lag: **${result.maximumRunLagLedgers ?? 'n/a'} ledgers**`,
    `- Failed checks: **${failedChecks.length}**`,
    '',
    ...failedChecks.map((check) => `- ${check}`),
    '',
  ].join('\n'), 'utf8')

  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
  await writeJson(`${OUTPUT_DIR}/fatal-error.json`, {
    generatedAt: new Date().toISOString(),
    error: error?.stack ?? error?.message ?? String(error),
  }).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
