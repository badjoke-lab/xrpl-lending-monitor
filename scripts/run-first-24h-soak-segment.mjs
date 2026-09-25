import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import process from 'node:process'

const BASE_URL = process.env.BASE_URL ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev'
const PRIMARY_RPC = process.env.PRIMARY_RPC ?? 'https://devnet.honeycluster.io/'
const FALLBACK_RPC = process.env.FALLBACK_RPC ?? 'https://s.devnet.rippletest.net:51234/'
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID ?? ''
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? ''
const OUTPUT_DIR = process.env.OUTPUT_DIR ?? 'first-24h-soak'
const EXPECTED = {
  architecture: 'rolling_checkpoint_fast_lane_v1',
  network: 'devnet',
  epochId: process.env.EXPECTED_EPOCH_ID ?? 'devnet-3371675',
  snapshotId: process.env.EXPECTED_SNAPSHOT_ID ?? 'devnet-3592674-0373cda0b0cd',
  ledgerIndex: Number(process.env.EXPECTED_LEDGER_INDEX ?? '3592674'),
  ledgerHash: process.env.EXPECTED_LEDGER_HASH ?? '0373CDA0B0CD8486C0C55C5B5DD460501419367BD76D146E4A718EBD9DD8A893',
  cron: '*/5 * * * *',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function iso(ms = Date.now()) {
  return new Date(ms).toISOString()
}

function parseIso(value) {
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null)
}

async function fetchJson(url, options = {}, retries = 3) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30_000)
    try {
      const response = await fetch(url, { ...options, signal: controller.signal })
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

async function rpcValidated(url) {
  const payload = await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'xrpl-lending-monitor-soak/1.0' },
    body: JSON.stringify({ method: 'ledger', params: [{ ledger_index: 'validated', transactions: false, expand: false }] }),
  })
  const result = payload?.result ?? {}
  const ledger = typeof result.ledger === 'object' && result.ledger !== null ? result.ledger : {}
  const ledgerIndex = Number(firstDefined(result.ledger_index, ledger.ledger_index, ledger.seqNum, 0))
  const ledgerHash = firstDefined(result.ledger_hash, ledger.ledger_hash, ledger.hash, null)
  return { ledgerIndex, ledgerHash }
}

function cfHeaders() {
  if (!CF_ACCOUNT || !CF_TOKEN) throw new Error('Cloudflare credentials are unavailable')
  return { authorization: `Bearer ${CF_TOKEN}`, 'user-agent': 'xrpl-lending-monitor-soak/1.0' }
}

function cfBase() {
  return `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/workers/scripts/xrpl-lending-monitor`
}

function bindingValue(settings, name) {
  const bindings = settings?.result?.bindings ?? []
  const binding = bindings.find((item) => item?.name === name)
  return firstDefined(binding?.text, binding?.value, null) ?? null
}

function activeDeployment(deployments) {
  const item = deployments?.result?.deployments?.[0] ?? null
  return {
    id: item?.id ?? null,
    versionId: item?.versions?.[0]?.version_id ?? null,
    createdOn: item?.created_on ?? null,
  }
}

function allPassed(checks) {
  return Object.values(checks).every(Boolean)
}

export async function captureSample({
  scheduledAt = null,
  previousUpdatedAt = null,
  previousLedger = null,
  startDeploymentId = null,
  startVersionId = null,
} = {}) {
  const capturedAtMs = Date.now()
  const [overview, readiness, collector, settings, schedules, deployments, primary, fallback] = await Promise.all([
    fetchJson(`${BASE_URL}/api/overview`),
    fetchJson(`${BASE_URL}/api/status/pre-soak-readiness`),
    fetchJson(`${BASE_URL}/api/status/collector`),
    fetchJson(`${cfBase()}/settings`, { headers: cfHeaders() }),
    fetchJson(`${cfBase()}/schedules`, { headers: cfHeaders() }),
    fetchJson(`${cfBase()}/deployments`, { headers: cfHeaders() }),
    rpcValidated(PRIMARY_RPC),
    rpcValidated(FALLBACK_RPC),
  ])

  const watermark = overview?.current_state_watermark ?? {}
  const currentLedger = Number(watermark.ledger_index ?? 0)
  const updatedAt = watermark.updated_at ?? null
  const updatedMs = updatedAt ? parseIso(updatedAt) : null
  const ageSeconds = updatedMs === null ? null : Math.max(0, (capturedAtMs - updatedMs) / 1000)
  const rpcHeads = [primary.ledgerIndex, fallback.ledgerIndex].filter((value) => Number.isSafeInteger(value) && value > 0)
  const liveLedger = rpcHeads.length === 2 ? Math.min(...rpcHeads) : 0
  const sourceSpread = rpcHeads.length === 2 ? Math.abs(primary.ledgerIndex - fallback.ledgerIndex) : null
  const lagLedgers = liveLedger > 0 && currentLedger > 0 ? Math.max(0, liveLedger - currentLedger) : null
  const deployment = activeDeployment(deployments)
  const scheduleValues = schedules?.result?.schedules?.map((item) => item?.cron) ?? []
  const readinessChecks = readiness?.checks && typeof readiness.checks === 'object'
    ? Object.values(readiness.checks).every((item) => item?.passed === true)
    : false
  const collectorFailures = Number(firstDefined(collector?.consecutiveFailures, collector?.consecutive_failures, 0))
  const collectorError = firstDefined(collector?.error, collector?.errorMessage, collector?.error_message, null) ?? null
  const expectedBase = readiness?.evidence?.expectedBase ?? {}
  const overviewBase = overview?.base ?? {}
  const overviewSnapshot = overview?.snapshot ?? {}

  const checks = {
    overview_network_devnet: overview?.network === EXPECTED.network,
    overview_epoch_fixed: overview?.epoch?.id === EXPECTED.epochId,
    overview_base_fixed:
      overviewBase?.id === EXPECTED.snapshotId
      && overviewBase?.epoch_id === EXPECTED.epochId
      && Number(overviewBase?.ledger_index) === EXPECTED.ledgerIndex
      && overviewBase?.ledger_hash === EXPECTED.ledgerHash,
    overview_snapshot_fixed:
      overviewSnapshot?.id === EXPECTED.snapshotId
      && overviewSnapshot?.epoch_id === EXPECTED.epochId
      && Number(overviewSnapshot?.ledger_index) === EXPECTED.ledgerIndex
      && overviewSnapshot?.ledger_hash === EXPECTED.ledgerHash,
    public_source_fast_lane: watermark?.source === 'fast_lane',
    current_state_at_or_after_checkpoint: currentLedger >= EXPECTED.ledgerIndex,
    current_state_age_within_600s: ageSeconds !== null && ageSeconds <= 600,
    current_state_lag_within_10: lagLedgers !== null && lagLedgers <= 10,
    current_state_advanced_since_previous:
      previousUpdatedAt === null
      || (updatedMs !== null && parseIso(previousUpdatedAt) !== null && updatedMs > parseIso(previousUpdatedAt)),
    current_ledger_monotonic: previousLedger === null || currentLedger >= Number(previousLedger),
    both_rpc_heads_available: rpcHeads.length === 2,
    rpc_source_spread_within_3: sourceSpread !== null && sourceSpread <= 3,
    readiness_passed: readiness?.passed === true,
    readiness_architecture_fixed: readiness?.architecture === EXPECTED.architecture,
    every_readiness_check_passed: readinessChecks,
    readiness_base_fixed:
      expectedBase?.epochId === EXPECTED.epochId
      && expectedBase?.snapshotId === EXPECTED.snapshotId
      && Number(expectedBase?.ledgerIndex) === EXPECTED.ledgerIndex
      && expectedBase?.ledgerHash === EXPECTED.ledgerHash,
    collector_has_no_failures: collectorFailures === 0 && collectorError === null,
    runtime_network_devnet: bindingValue(settings, 'APP_NETWORK') === 'devnet',
    mainnet_disabled: String(bindingValue(settings, 'MAINNET_ENABLED')).toLowerCase() === 'false',
    worker_snapshot_fixed: bindingValue(settings, 'CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID') === EXPECTED.snapshotId,
    replacement_epoch_fixed: bindingValue(settings, 'REPLACEMENT_BASE_EPOCH_ID') === EXPECTED.epochId,
    replacement_snapshot_fixed: bindingValue(settings, 'REPLACEMENT_BASE_SNAPSHOT_ID') === EXPECTED.snapshotId,
    replacement_ledger_fixed: Number(bindingValue(settings, 'REPLACEMENT_BASE_LEDGER_INDEX')) === EXPECTED.ledgerIndex,
    replacement_hash_fixed: bindingValue(settings, 'REPLACEMENT_BASE_LEDGER_HASH') === EXPECTED.ledgerHash,
    cutover_token_absent: bindingValue(settings, 'REPLACEMENT_BASE_CUTOVER_TOKEN') === null,
    exactly_one_five_minute_cron: scheduleValues.length === 1 && scheduleValues[0] === EXPECTED.cron,
    deployment_identity_fixed: startDeploymentId === null || deployment.id === startDeploymentId,
    deployment_version_fixed: startVersionId === null || deployment.versionId === startVersionId,
  }

  return {
    schemaVersion: 1,
    capturedAt: iso(capturedAtMs),
    scheduledAt,
    delaySeconds: scheduledAt ? Math.max(0, (capturedAtMs - parseIso(scheduledAt)) / 1000) : null,
    passed: allPassed(checks),
    failedChecks: Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name),
    checks,
    expected: EXPECTED,
    currentState: {
      source: watermark?.source ?? null,
      ledgerIndex: currentLedger,
      ledgerHash: watermark?.ledger_hash ?? null,
      updatedAt,
      ageSeconds,
      liveLedger,
      lagLedgers,
    },
    rpc: {
      primary,
      fallback,
      sourceSpread,
    },
    runtime: {
      deployment,
      schedules: scheduleValues,
      appNetwork: bindingValue(settings, 'APP_NETWORK'),
      mainnetEnabled: bindingValue(settings, 'MAINNET_ENABLED'),
      snapshotId: bindingValue(settings, 'CURRENT_STATE_REPLACEMENT_SNAPSHOT_ID'),
      replacementBase: {
        epochId: bindingValue(settings, 'REPLACEMENT_BASE_EPOCH_ID'),
        snapshotId: bindingValue(settings, 'REPLACEMENT_BASE_SNAPSHOT_ID'),
        ledgerIndex: bindingValue(settings, 'REPLACEMENT_BASE_LEDGER_INDEX'),
        ledgerHash: bindingValue(settings, 'REPLACEMENT_BASE_LEDGER_HASH'),
      },
    },
    collector: {
      status: collector?.status ?? null,
      consecutiveFailures: collectorFailures,
      error: collectorError,
      lastSuccessAt: firstDefined(collector?.lastSuccessAt, collector?.last_success_at, null) ?? null,
    },
    readiness,
  }
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function appendNdjson(path, value) {
  await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
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
    const deploymentKey = `${sample.runtime.deployment.id ?? ''}:${sample.runtime.deployment.versionId ?? ''}`
    if (deploymentKey && deploymentKey === stableDeploymentKey) stablePolls += 1
    else {
      stableDeploymentKey = deploymentKey
      stablePolls = 1
    }
    const baselineMs = baselineUpdatedAt ? parseIso(baselineUpdatedAt) : null
    const sampleMs = sample.currentState.updatedAt ? parseIso(sample.currentState.updatedAt) : null
    const freshTickObserved = baselineMs === null || (sampleMs !== null && sampleMs > baselineMs)
    const startEligible = sample.passed && freshTickObserved && stablePolls >= 5
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
    schemaVersion: 1,
    state: 'active',
    t0Iso: iso(t0Ms),
    t0EpochMs: t0Ms,
    expectedEndIso: iso(t0Ms + 24 * 60 * 60 * 1000),
    expected: EXPECTED,
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

  await mkdir(OUTPUT_DIR, { recursive: true })
  const samplesPath = `${OUTPUT_DIR}/samples.ndjson`
  const segmentStartMs = t0Ms + (segmentIndex - 1) * 4 * 60 * 60 * 1000
  const segmentEndMs = t0Ms + segmentIndex * 4 * 60 * 60 * 1000
  if (Date.now() < segmentStartMs) await sleep(segmentStartMs - Date.now())

  const samples = []
  for (let slot = 1; slot <= 48; slot += 1) {
    const scheduledMs = segmentStartMs + slot * 5 * 60 * 1000
    if (Date.now() < scheduledMs) await sleep(scheduledMs - Date.now())
    let sample = null
    let lastError = null
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        sample = await captureSample({
          scheduledAt: iso(scheduledMs),
          previousUpdatedAt,
          previousLedger,
          startDeploymentId,
          startVersionId,
        })
        sample.segmentIndex = segmentIndex
        sample.slot = slot
        sample.attempt = attempt
        if (sample.passed) break
        lastError = new Error(`invariants failed: ${sample.failedChecks.join(', ')}`)
      } catch (error) {
        lastError = error
        sample = {
          schemaVersion: 1,
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
      if (attempt < 4) await sleep(20_000)
    }

    await appendNdjson(samplesPath, sample)
    await writeJson(`${OUTPUT_DIR}/sample-${String(slot).padStart(3, '0')}.json`, sample)
    samples.push(sample)
    if (!sample.passed) throw lastError ?? new Error('Soak invariant failure')
    previousUpdatedAt = sample.currentState.updatedAt
    previousLedger = sample.currentState.ledgerIndex
  }

  const maxAgeSeconds = Math.max(...samples.map((sample) => Number(sample.currentState.ageSeconds ?? 0)))
  const maxLagLedgers = Math.max(...samples.map((sample) => Number(sample.currentState.lagLedgers ?? 0)))
  const maxDelaySeconds = Math.max(...samples.map((sample) => Number(sample.delaySeconds ?? 0)))
  const summary = {
    passed: samples.length === 48 && samples.every((sample) => sample.passed),
    segmentIndex,
    segmentStartIso: iso(segmentStartMs),
    segmentEndIso: iso(segmentEndMs),
    sampleCount: samples.length,
    maxAgeSeconds,
    maxLagLedgers,
    maxDelaySeconds,
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
  else throw new Error('Usage: node run-first-24h-soak-segment.mjs <start|segment>')
}

const directInvocation = process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]
if (directInvocation) {
  main().catch(async (error) => {
    await mkdir(OUTPUT_DIR, { recursive: true }).catch(() => {})
    await writeJson(`${OUTPUT_DIR}/fatal-error.json`, { capturedAt: iso(), error: error?.stack ?? error?.message ?? String(error) }).catch(() => {})
    console.error(error)
    process.exitCode = 1
  })
}
