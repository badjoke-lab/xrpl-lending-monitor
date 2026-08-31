import { mkdir, readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'

import { captureSample } from './run-first-24h-soak-segment.mjs'
import { evaluateSoakObservation } from './soak-observation-policy.mjs'

const START_PATH = process.env.START_PATH ?? 'first-24h-soak-anchor/start.json'
const METRICS_PATH = process.env.METRICS_PATH ?? 'first-24h-soak-audit/metrics.json'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'first-24h-soak-audit'
const WINDOW_MS = 24 * 60 * 60 * 1000
const MIN_RUN_GAP_SECONDS = 240
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

function minOrNull(values) {
  return values.length > 0 ? Math.min(...values) : null
}

function percentile(values, p) {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

function summarizeWindow(entries, startMs, endMs) {
  const rows = entries.filter((entry) => entry.runMs >= startMs && entry.runMs <= endMs)
  const gaps = []
  for (let index = 1; index < rows.length; index += 1) {
    gaps.push((rows[index].runMs - rows[index - 1].runMs) / 1000)
  }
  const lastCoverageSeconds = rows.length > 0 ? (endMs - rows.at(-1).runMs) / 1000 : null
  const countPassed = rows.length >= MIN_EXPECTED_RUNS && rows.length <= MAX_EXPECTED_RUNS
  const gapsPassed = gaps.length > 0
    && gaps.every((gap) => gap >= MIN_RUN_GAP_SECONDS && gap <= MAX_RUN_GAP_SECONDS)
  const endCovered = lastCoverageSeconds !== null
    && lastCoverageSeconds >= 0
    && lastCoverageSeconds <= MAX_RUN_GAP_SECONDS

  return {
    passed: countPassed && gapsPassed && endCovered,
    startIso: iso(startMs),
    endIso: iso(endMs),
    observedRuns: rows.length,
    lastCoverageSeconds,
    minimumGapSeconds: minOrNull(gaps),
    maximumGapSeconds: maxOrNull(gaps),
    p95GapSeconds: percentile(gaps, 0.95),
    maximumLagLedgers: maxOrNull(rows.map((entry) => entry.lag)),
    persistenceRowsRead: rows.reduce((sum, entry) => sum + Number(entry.row.persistence_rows_read ?? 0), 0),
    persistenceRowsWritten: rows.reduce((sum, entry) => sum + Number(entry.row.persistence_rows_written ?? 0), 0),
  }
}

function buildContinuousSequences(rows, anchorMs, nowMs) {
  const allowedStatuses = new Set(['committed', 'caught_up'])
  const ordered = [...rows]
    .map((row) => ({
      row,
      runMs: parseIso(row?.run_at),
      lag: Number(row?.lag_ledgers),
    }))
    .filter((entry) => entry.runMs !== null && entry.runMs >= anchorMs && entry.runMs <= nowMs)
    .sort((a, b) => a.runMs - b.runMs)

  const sequences = []
  const discontinuities = []
  let current = []

  const flush = () => {
    if (current.length > 0) sequences.push(current)
    current = []
  }

  for (const entry of ordered) {
    if (!allowedStatuses.has(entry.row.status)) {
      flush()
      discontinuities.push({
        at: iso(entry.runMs),
        reason: 'non_success_status',
        status: entry.row.status ?? null,
      })
      continue
    }

    if (!Number.isFinite(entry.lag) || entry.lag > MAX_RUN_LAG_LEDGERS) {
      flush()
      discontinuities.push({
        at: iso(entry.runMs),
        reason: 'run_lag_exceeded',
        lagLedgers: Number.isFinite(entry.lag) ? entry.lag : null,
      })
      continue
    }

    if (current.length > 0) {
      const gapSeconds = (entry.runMs - current.at(-1).runMs) / 1000
      if (gapSeconds < MIN_RUN_GAP_SECONDS || gapSeconds > MAX_RUN_GAP_SECONDS) {
        flush()
        discontinuities.push({
          at: iso(entry.runMs),
          reason: gapSeconds < MIN_RUN_GAP_SECONDS ? 'cadence_too_fast' : 'execution_gap_exceeded',
          gapSeconds,
        })
      }
    }

    current.push(entry)
  }
  flush()

  return { ordered, sequences, discontinuities }
}

export function evaluateFixedSoakWindow({ start, metrics, finalSample, nowMs = Date.now() }) {
  const anchorMs = parseIso(start?.t0Iso)
  const initialExpectedEndMs = parseIso(start?.expectedEndIso)
  if (
    anchorMs === null
    || initialExpectedEndMs === null
    || initialExpectedEndMs - anchorMs !== WINDOW_MS
  ) {
    throw new Error('The soak anchor does not define one valid immutable 24-hour start point')
  }

  const { ordered, sequences, discontinuities } = buildContinuousSequences(metrics, anchorMs, nowMs)
  let selectedWindow = null

  for (const sequence of sequences) {
    const candidateStartMs = sequence[0].runMs
    const candidateEndMs = candidateStartMs + WINDOW_MS
    if (candidateEndMs > nowMs) continue
    const candidate = summarizeWindow(sequence, candidateStartMs, candidateEndMs)
    if (candidate.passed) {
      selectedWindow = candidate
      break
    }
  }

  const pendingSequence = sequences.at(-1) ?? []
  const pendingStartMs = pendingSequence[0]?.runMs ?? null
  const pendingEndMs = pendingStartMs === null ? null : pendingStartMs + WINDOW_MS
  const pendingProgressSeconds = pendingStartMs === null
    ? 0
    : Math.max(0, Math.min(WINDOW_MS, nowMs - pendingStartMs)) / 1000

  const deferredChecks = Array.isArray(finalSample?.observationPolicy?.deferredToFinalRunMetrics)
    ? finalSample.observationPolicy.deferredToFinalRunMetrics
    : []
  const delayedObservationBacked = deferredChecks.length === 0 || selectedWindow !== null

  const hardChecks = {
    anchor_start_state_passed: start?.firstSample?.passed === true,
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
  }
  const checks = {
    ...hardChecks,
    continuous_24h_window_found: selectedWindow !== null,
    delayed_final_observation_backed_by_exact_metrics: delayedObservationBacked,
  }

  const hardFailedChecks = Object.entries(hardChecks).filter(([, passed]) => !passed).map(([name]) => name)
  const failedChecks = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name)
  const state = hardFailedChecks.length > 0 || !delayedObservationBacked
    ? 'failed'
    : selectedWindow !== null
      ? 'passed'
      : 'not_ready'

  const statuses = ordered.map((entry) => entry.row.status)
  const allGaps = []
  for (let index = 1; index < ordered.length; index += 1) {
    allGaps.push((ordered[index].runMs - ordered[index - 1].runMs) / 1000)
  }

  return {
    schemaVersion: 2,
    gate: 'first-24-hour-devnet-production-soak-restart-safe',
    generatedAt: iso(nowMs),
    anchor: {
      t0Iso: start.t0Iso,
      initialExpectedEndIso: start.expectedEndIso,
      deployment: start.deployment,
      immutable: true,
    },
    selectedWindow,
    pendingWindow: {
      startIso: pendingStartMs === null ? null : iso(pendingStartMs),
      nextEligibleEndIso: pendingEndMs === null ? null : iso(pendingEndMs),
      progressSeconds: pendingProgressSeconds,
      observedRuns: pendingSequence.length,
    },
    metrics: {
      observedSinceAnchor: ordered.length,
      continuousSequences: sequences.length,
      discontinuities,
      statuses: Object.fromEntries(
        [...new Set(statuses)].map((status) => [status, statuses.filter((item) => item === status).length]),
      ),
      minimumObservedGapSeconds: minOrNull(allGaps),
      maximumObservedGapSeconds: maxOrNull(allGaps),
    },
    finalSample,
    checks,
    result: {
      passed: state === 'passed',
      state,
      failedChecks,
      hardFailedChecks,
      clockResetRequired: false,
      retryWithSameAnchor: state !== 'passed',
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
    '# First 24-hour XRPL Devnet production soak — restart-safe audit',
    '',
    `- Result: **${result.result.state}**`,
    `- Immutable anchor: **${result.anchor.t0Iso}**`,
    `- Selected window start: **${result.selectedWindow?.startIso ?? 'not yet available'}**`,
    `- Selected window end: **${result.selectedWindow?.endIso ?? 'not yet available'}**`,
    `- Next eligible end: **${result.pendingWindow.nextEligibleEndIso ?? 'not available'}**`,
    `- Exact D1 runs since anchor: **${result.metrics.observedSinceAnchor}**`,
    `- Discontinuities: **${result.metrics.discontinuities.length}**`,
    `- Clock reset required: **${result.result.clockResetRequired}**`,
    `- Retry with same anchor: **${result.result.retryWithSameAnchor}**`,
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
