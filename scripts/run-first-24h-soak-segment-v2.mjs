import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import process from 'node:process'

import { captureSample } from './run-first-24h-soak-segment.mjs'
import { evaluateSoakObservation } from './soak-observation-policy.mjs'

const BASE_URL = process.env.BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev'
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'first-24h-soak-v2'
const SLOT_COUNT = Number(process.env.SLOT_COUNT ?? '48')
const SLOT_INTERVAL_MS = Number(process.env.SLOT_INTERVAL_MS ?? String(5 * 60 * 1000))
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? '4')
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? '20000')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function iso(ms = Date.now()) {
  return new Date(ms).toISOString()
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function fetchJson(url, retries = 3) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      const text = await response.text()
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
      return JSON.parse(text)
    } catch (error) {
      lastError = error
      if (attempt < retries) await sleep(attempt * 2_000)
    } finally {
      clearTimeout(timeout)
    }
  }
  throw lastError
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function appendNdjson(path, value) {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function startMode() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const attemptsPath = `${OUTPUT_DIR}/start-attempts.ndjson`
  const baseline = await fetchJson(`${BASE_URL}/api/overview`)
  const baselineUpdatedAt = baseline?.current_state_watermark?.updated_at ?? null
  let stableDeploymentKey = null
  let stablePolls = 0
  let selected = null

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    let sample
    try {
      sample = await captureSample()
    } catch (error) {
      await appendNdjson(attemptsPath, { attempt, capturedAt: iso(), error: error?.message ?? String(error) })
      await sleep(30_000)
      continue
    }

    const deploymentKey = `${sample.runtime?.deployment?.id ?? ''}:${sample.runtime?.deployment?.versionId ?? ''}`
    if (deploymentKey && deploymentKey === stableDeploymentKey) stablePolls += 1
    else {
      stableDeploymentKey = deploymentKey
      stablePolls = 1
    }

    const baselineMs = baselineUpdatedAt ? Date.parse(baselineUpdatedAt) : null
    const sampleMs = sample.currentState?.updatedAt ? Date.parse(sample.currentState.updatedAt) : null
    const freshTickObserved = baselineMs === null || (Number.isFinite(sampleMs) && sampleMs > baselineMs)
    const startEligible = sample.passed === true && freshTickObserved && stablePolls >= 5

    await appendNdjson(attemptsPath, {
      attempt,
      capturedAt: sample.capturedAt,
      deploymentKey,
      stablePolls,
      freshTickObserved,
      startEligible,
      failedChecks: sample.failedChecks,
      currentState: sample.currentState,
    })

    if (startEligible) {
      selected = sample
      break
    }
    await sleep(30_000)
  }

  if (!selected) throw new Error('Could not establish a stable fresh production start state within 20 minutes')

  const t0Ms = Date.now()
  const start = {
    schemaVersion: 2,
    state: 'active',
    t0Iso: iso(t0Ms),
    t0EpochMs: t0Ms,
    expectedEndIso: iso(t0Ms + 24 * 60 * 60 * 1000),
    deployment: selected.runtime.deployment,
    firstSample: selected,
  }

  await writeJson(`${OUTPUT_DIR}/start.json`, start)
  await writeJson(`${OUTPUT_DIR}/sample-000.json`, selected)
  await writeFile(`${OUTPUT_DIR}/samples.ndjson`, `${JSON.stringify(selected)}\n`, 'utf8')
  await writeJson(`${OUTPUT_DIR}/summary.json`, {
    passed: true,
    t0Iso: start.t0Iso,
    t0EpochMs: t0Ms,
    expectedEndIso: start.expectedEndIso,
    deploymentId: selected.runtime.deployment.id,
    versionId: selected.runtime.deployment.versionId,
    lastUpdatedAt: selected.currentState.updatedAt,
    lastLedger: selected.currentState.ledgerIndex,
  })

  console.log(JSON.stringify(start, null, 2))
}

async function segmentMode() {
  const segmentIndex = Number(requiredEnv('SEGMENT_INDEX'))
  const t0Ms = Number(requiredEnv('T0_EPOCH_MS'))
  const startDeploymentId = requiredEnv('START_DEPLOYMENT_ID')
  const startVersionId = requiredEnv('START_VERSION_ID')
  let previousUpdatedAt = requiredEnv('PREVIOUS_UPDATED_AT')
  let previousLedger = Number(requiredEnv('PREVIOUS_LEDGER'))

  if (!Number.isInteger(segmentIndex) || segmentIndex < 1 || segmentIndex > 6) throw new Error('SEGMENT_INDEX must be 1..6')
  if (!Number.isFinite(t0Ms) || t0Ms <= 0) throw new Error('T0_EPOCH_MS is invalid')
  if (!Number.isInteger(SLOT_COUNT) || SLOT_COUNT < 1 || SLOT_COUNT > 48) throw new Error('SLOT_COUNT must be 1..48')
  if (!Number.isFinite(SLOT_INTERVAL_MS) || SLOT_INTERVAL_MS < 1_000) throw new Error('SLOT_INTERVAL_MS is invalid')

  await mkdir(OUTPUT_DIR, { recursive: true })
  const samplesPath = `${OUTPUT_DIR}/samples.ndjson`
  const attemptsPath = `${OUTPUT_DIR}/attempts.ndjson`
  const segmentStartMs = t0Ms + (segmentIndex - 1) * SLOT_COUNT * SLOT_INTERVAL_MS
  const segmentEndMs = segmentStartMs + SLOT_COUNT * SLOT_INTERVAL_MS
  if (Date.now() < segmentStartMs) await sleep(segmentStartMs - Date.now())

  const samples = []
  let totalAttempts = 0
  let deferredMetricObservations = 0

  for (let slot = 1; slot <= SLOT_COUNT; slot += 1) {
    const scheduledMs = segmentStartMs + slot * SLOT_INTERVAL_MS
    if (Date.now() < scheduledMs) await sleep(scheduledMs - Date.now())

    let acceptedSample = null
    let lastError = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      totalAttempts += 1
      let rawSample
      try {
        rawSample = await captureSample({
          scheduledAt: iso(scheduledMs),
          previousUpdatedAt,
          previousLedger,
          startDeploymentId,
          startVersionId,
        })
        rawSample.segmentIndex = segmentIndex
        rawSample.slot = slot
        rawSample.attempt = attempt
      } catch (error) {
        rawSample = {
          schemaVersion: 2,
          capturedAt: iso(),
          scheduledAt: iso(scheduledMs),
          segmentIndex,
          slot,
          attempt,
          passed: false,
          failedChecks: ['capture_error'],
          error: error?.message ?? String(error),
        }
      }

      const evaluated = evaluateSoakObservation(rawSample, { attempt, maxAttempts: MAX_ATTEMPTS })
      await appendNdjson(attemptsPath, {
        segmentIndex,
        slot,
        attempt,
        decision: evaluated.decision,
        sample: evaluated.sample,
      })

      if (evaluated.decision === 'accept' || evaluated.decision === 'accept_with_deferred_metrics') {
        acceptedSample = evaluated.sample
        if (evaluated.decision === 'accept_with_deferred_metrics') deferredMetricObservations += 1
        break
      }

      lastError = new Error(`invariants failed: ${(rawSample.failedChecks ?? []).join(', ')}`)
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS)
    }

    const sample = acceptedSample ?? {
      schemaVersion: 2,
      capturedAt: iso(),
      scheduledAt: iso(scheduledMs),
      segmentIndex,
      slot,
      attempt: MAX_ATTEMPTS,
      passed: false,
      failedChecks: ['no_acceptable_observation'],
    }

    await appendNdjson(samplesPath, sample)
    await writeJson(`${OUTPUT_DIR}/sample-${String(slot).padStart(3, '0')}.json`, sample)
    samples.push(sample)

    if (!sample.passed) throw lastError ?? new Error('Soak invariant failure')
    previousUpdatedAt = sample.currentState.updatedAt
    previousLedger = sample.currentState.ledgerIndex
  }

  const summary = {
    schemaVersion: 2,
    passed: samples.length === SLOT_COUNT && samples.every((sample) => sample.passed),
    segmentIndex,
    segmentStartIso: iso(segmentStartMs),
    segmentEndIso: iso(segmentEndMs),
    sampleCount: samples.length,
    totalAttempts,
    deferredMetricObservations,
    maxAgeSeconds: Math.max(...samples.map((sample) => Number(sample.currentState?.ageSeconds ?? 0))),
    maxLagLedgers: Math.max(...samples.map((sample) => Number(sample.currentState?.lagLedgers ?? 0))),
    maxDelaySeconds: Math.max(...samples.map((sample) => Number(sample.delaySeconds ?? 0))),
    lastUpdatedAt: previousUpdatedAt,
    lastLedger: previousLedger,
  }

  await writeJson(`${OUTPUT_DIR}/summary.json`, summary)
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.passed) process.exitCode = 1
}

async function main() {
  const mode = process.argv[2]
  if (mode === 'start') await startMode()
  else if (mode === 'segment') await segmentMode()
  else throw new Error('Usage: node run-first-24h-soak-segment-v2.mjs <start|segment>')
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
  await writeJson(`${OUTPUT_DIR}/fatal-error.json`, {
    capturedAt: iso(),
    error: error?.stack ?? error?.message ?? String(error),
  }).catch(() => {})
  console.error(error)
  process.exitCode = 1
})
