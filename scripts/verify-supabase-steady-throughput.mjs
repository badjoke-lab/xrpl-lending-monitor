import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-steady-throughput-qualification`
const purpose = 'r4c2d-network-steady-throughput'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const sessionId = `r4c2d-steady-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
const steadyThreshold = 21
const catchUpThreshold = 30
const memoryHaltBytes = 209715200
const memoryHardBytes = 268435456
const requiredMemoryPhases = [
  'request_start',
  'after_claim',
  'after_head',
  'after_fetch',
  'after_normalize',
  'before_commit',
]
const catchUpEvidence = {
  workflowRunId: 30755497115,
  artifactId: 8835798472,
  artifactDigest: 'sha256:05ab7a8199a13fb5577bd8d1d1f135363974c73501661409c9daa0eb516f2c07',
  p95CommittedLedgersPerMinute: 14178.400673920027,
  passed: true,
}

function headers() {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    'x-xrpl-reader-token': verifierToken,
  }
}

async function requestRaw(body, customHeaders = headers()) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: customHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 2_000) }
  }
  return { ok: response.ok, status: response.status, body: parsed }
}

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function numberValue(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`)
  }
  return parsed
}

function nonNegativeInteger(value, name) {
  const parsed = numberValue(value, name)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right)
  const position = (sorted.length - 1) * quantile
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sorted[lower]
  const weight = position - lower
  return sorted[lower] * (1 - weight) + sorted[upper] * weight
}

function verifySession(raw) {
  const session = object(raw, 'steady session')
  const checks = object(session.checks, 'steady session checks')
  if (
    session.status !== 'completed'
    || session.targetTicks !== 6
    || session.batchSize !== 24
    || session.completedTicks !== 6
    || session.committedLedgers !== 144
    || !Array.isArray(session.ticks)
  ) {
    throw new Error('steady session did not complete the fixed 6x24 contract')
  }
  for (const name of [
    'activeProfileNonRegressing',
    'activeSourceIdentityPreserved',
    'targetAdvanceExact',
    'completedTickParity',
    'completedWorkParity',
    'allCompletedAttemptsOne',
  ]) {
    if (checks[name] !== true) throw new Error(`steady session check ${name} failed`)
  }

  const errorTicks = session.ticks.filter((tick) => tick.status === 'error')
  if (errorTicks.length > 0) {
    throw new Error(`steady session retained ${errorTicks.length} error ticks`)
  }
  const completed = session.ticks
    .filter((tick) => tick.status === 'completed')
    .sort((left, right) => Date.parse(left.scheduledMinute) - Date.parse(right.scheduledMinute))
  if (completed.length !== 6) throw new Error('steady session does not contain six completed ticks')

  const minuteRates = []
  for (const [index, tick] of completed.entries()) {
    const scheduled = Date.parse(tick.scheduledMinute)
    if (!Number.isFinite(scheduled)) throw new Error(`steady tick ${index + 1} minute is invalid`)
    if (index > 0) {
      const previous = Date.parse(completed[index - 1].scheduledMinute)
      if (scheduled - previous !== 60_000) {
        throw new Error('steady completed ticks are not six consecutive minute buckets')
      }
    }
    if (
      tick.tickSequence !== index + 1
      || tick.workCount !== 24
      || tick.endLedgerIndex !== tick.startLedgerIndex + 23
      || typeof tick.finalLedgerHash !== 'string'
      || !/^[A-F0-9]{64}$/.test(tick.finalLedgerHash)
      || typeof tick.worksDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(tick.worksDigest)
      || typeof tick.rowsDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(tick.rowsDigest)
      || numberValue(tick.messageCount, 'messageCount') < 73
      || numberValue(tick.successorCount, 'successorCount') !== tick.messageCount - 1
      || numberValue(tick.fetchMilliseconds, 'fetchMilliseconds') <= 0
      || numberValue(tick.normalizeMilliseconds, 'normalizeMilliseconds') <= 0
      || numberValue(tick.edgeWallMilliseconds, 'edgeWallMilliseconds') <= 0
      || numberValue(tick.edgeWallMilliseconds, 'edgeWallMilliseconds') >= 50_000
      || numberValue(tick.databaseMilliseconds, 'databaseMilliseconds') <= 0
    ) {
      throw new Error(`steady tick ${index + 1} failed full-phase or timing parity`)
    }
    minuteRates.push(tick.workCount)
  }

  const target = object(session.targetWatermark, 'target watermark')
  const anchor = object(session.anchor, 'anchor')
  const activeAfter = object(session.activeAfter, 'active after')
  if (
    numberValue(target.ledgerIndex, 'target ledger') !== numberValue(anchor.ledgerIndex, 'anchor ledger') + 144
    || numberValue(activeAfter.ledgerIndex, 'active ledger') < numberValue(anchor.ledgerIndex, 'anchor ledger')
    || activeAfter.epochId !== anchor.epochId
    || activeAfter.baseIdentity !== anchor.baseIdentity
  ) {
    throw new Error('steady watermark or active-source identity parity failed')
  }

  const p50 = percentile(minuteRates, 0.5)
  const p95 = percentile(minuteRates, 0.95)
  const steadyObservedPass = p95 > steadyThreshold
  const catchUpObservedPass = catchUpEvidence.passed
    && catchUpEvidence.p95CommittedLedgersPerMinute > catchUpThreshold
  return {
    session,
    completedTicks: completed,
    minuteRates,
    summary: {
      minimumCommittedLedgersPerMinute: Math.min(...minuteRates),
      p50CommittedLedgersPerMinute: p50,
      p95CommittedLedgersPerMinute: p95,
      maximumCommittedLedgersPerMinute: Math.max(...minuteRates),
      steadyThreshold,
      steadyObservedPass,
      catchUpThreshold,
      catchUpObservedPass,
      g7Qualified: steadyObservedPass && catchUpObservedPass,
    },
  }
}

function verifyMemory(raw, completedTicks) {
  const memory = object(raw, 'steady memory evidence')
  const checks = object(memory.checks, 'steady memory checks')
  if (
    memory.schemaVersion !== 1
    || memory.purpose !== 'r4c2d-steady-memory-guard'
    || memory.sessionId !== sessionId
    || memory.sessionStatus !== 'completed'
    || memory.completedTicks !== 6
    || memory.measuredCompletedTicks !== 6
    || memory.memoryHaltBytes !== memoryHaltBytes
    || memory.memoryHardBytes !== memoryHardBytes
    || !Array.isArray(memory.ticks)
  ) {
    throw new Error('steady memory evidence identity or six-tick coverage changed')
  }
  for (const name of [
    'allCompletedTicksMeasured',
    'sixCompletedTicksMeasured',
    'highWaterBelowHalt',
    'haltBelowHard',
  ]) {
    if (checks[name] !== true) throw new Error(`steady memory check ${name} failed`)
  }
  if (checks.g8Qualified !== false || checks.profileSelected !== false) {
    throw new Error('steady memory evidence overstated G8 or profile selection')
  }

  const completedIds = new Set(completedTicks.map((tick) => tick.tickId))
  const measured = memory.ticks
    .filter((tick) => tick.status === 'completed')
    .sort((left, right) => left.tickSequence - right.tickSequence)
  if (measured.length !== 6) throw new Error('steady memory evidence does not contain six completed ticks')

  const tickHighWaterBytes = []
  let totalSamples = 0
  for (const [index, tick] of measured.entries()) {
    if (
      tick.tickSequence !== index + 1
      || !completedIds.has(tick.tickId)
      || !Array.isArray(tick.memorySamples)
    ) {
      throw new Error(`steady memory tick ${index + 1} identity changed`)
    }
    const sampleCount = nonNegativeInteger(tick.memorySampleCount, `memory tick ${index + 1} sample count`)
    const recordedHighWater = nonNegativeInteger(
      tick.memoryHighWaterBytes,
      `memory tick ${index + 1} high water`,
    )
    if (sampleCount < 6 || sampleCount > 64 || tick.memorySamples.length !== sampleCount) {
      throw new Error(`steady memory tick ${index + 1} sample count changed`)
    }

    const phases = new Set()
    let calculatedHighWater = 0
    for (const [sampleIndex, candidate] of tick.memorySamples.entries()) {
      const sample = object(candidate, `memory tick ${index + 1} sample ${sampleIndex + 1}`)
      if (typeof sample.phase !== 'string' || sample.phase.length === 0 || phases.has(sample.phase)) {
        throw new Error(`steady memory tick ${index + 1} phase is invalid or duplicated`)
      }
      phases.add(sample.phase)
      const rss = nonNegativeInteger(sample.rssBytes, `${sample.phase}.rssBytes`)
      const heapTotal = nonNegativeInteger(sample.heapTotalBytes, `${sample.phase}.heapTotalBytes`)
      const heapUsed = nonNegativeInteger(sample.heapUsedBytes, `${sample.phase}.heapUsedBytes`)
      nonNegativeInteger(sample.externalBytes, `${sample.phase}.externalBytes`)
      if (heapUsed > heapTotal) throw new Error(`steady memory ${sample.phase} heap parity failed`)
      calculatedHighWater = Math.max(calculatedHighWater, rss)
    }
    for (const phase of requiredMemoryPhases) {
      if (!phases.has(phase)) throw new Error(`steady memory tick ${index + 1} is missing ${phase}`)
    }
    if (calculatedHighWater !== recordedHighWater || recordedHighWater >= memoryHaltBytes) {
      throw new Error(`steady memory tick ${index + 1} high-water parity or halt boundary failed`)
    }
    totalSamples += sampleCount
    tickHighWaterBytes.push(recordedHighWater)
  }

  const sessionHighWater = Math.max(...tickHighWaterBytes)
  if (sessionHighWater !== memory.memoryHighWaterBytes || sessionHighWater >= memoryHaltBytes) {
    throw new Error('steady session memory high-water parity or halt boundary failed')
  }

  return {
    memory,
    tickHighWaterBytes,
    totalSamples,
    summary: {
      minimumMemoryHighWaterBytes: Math.min(...tickHighWaterBytes),
      p50MemoryHighWaterBytes: percentile(tickHighWaterBytes, 0.5),
      p95MemoryHighWaterBytes: percentile(tickHighWaterBytes, 0.95),
      maximumMemoryHighWaterBytes: sessionHighWater,
      memoryHaltBytes,
      memoryHardBytes,
      memoryHeadroomBytes: memoryHaltBytes - sessionHighWater,
      allSixTicksBelowHalt: tickHighWaterBytes.every((value) => value < memoryHaltBytes),
    },
  }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })

  const prepared = await requestRaw({ action: 'prepare', sessionId })
  if (!prepared.ok || prepared.body?.action !== 'prepare') {
    throw new Error(
      `steady session preparation failed (${prepared.status}): ${JSON.stringify(prepared.body).slice(0, 2_000)}`,
    )
  }

  const startedAt = Date.now()
  const deadline = startedAt + 9 * 60_000
  let latest = null
  let latestMemory = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    const read = await requestRaw({ action: 'read', sessionId })
    if (!read.ok) {
      throw new Error(
        `steady session read failed (${read.status}): ${JSON.stringify(read.body).slice(0, 2_000)}`,
      )
    }
    latest = object(read.body?.session, 'steady session response')
    latestMemory = object(read.body?.memory, 'steady memory response')
    if (latest.status === 'halted') {
      throw new Error(`steady session halted: ${String(latest.lastError ?? 'unknown')}`)
    }
    if (latest.status === 'completed') break
  }
  if (latest === null || latestMemory === null || latest.status !== 'completed') {
    throw new Error('steady session did not complete within nine minutes')
  }

  const verified = verifySession(latest)
  const verifiedMemory = verifyMemory(latestMemory, verified.completedTicks)
  if (verified.summary.steadyObservedPass !== true || verified.summary.g7Qualified !== true) {
    throw new Error(
      `steady G7 qualification failed: ${JSON.stringify(verified.summary)}`,
    )
  }
  if (verifiedMemory.summary.allSixTicksBelowHalt !== true) {
    throw new Error('steady memory qualification crossed the fail-closed boundary')
  }

  const missingToken = await requestRaw(
    { action: 'read', sessionId },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': purpose,
    },
  )
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('steady qualification accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw(
    { action: 'read', sessionId },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'wrong-purpose',
      'x-xrpl-reader-token': verifierToken,
    },
  )
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('steady qualification accepted the wrong purpose')
  }

  const evidence = {
    schemaVersion: 2,
    purpose: 'r4c2d-network-steady-throughput-verification',
    verifiedAt: new Date().toISOString(),
    sessionId,
    elapsedMilliseconds: Date.now() - startedAt,
    profileId: 'supabase-devnet-steady-qualification',
    sourceProfileId: 'supabase-devnet',
    network: 'devnet',
    session: verified.session,
    memory: verifiedMemory.memory,
    minuteRates: verified.minuteRates,
    memoryHighWaterBytes: verifiedMemory.tickHighWaterBytes,
    totalMemorySamples: verifiedMemory.totalSamples,
    summary: verified.summary,
    memorySummary: verifiedMemory.summary,
    retainedCatchUpEvidence: catchUpEvidence,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    checks: {
      sixConsecutiveMinuteBuckets: true,
      twentyFourNetworkLedgersPerMinute: true,
      networkFetchAndNormalizationMeasured: true,
      fullPhaseAtomicBatchMeasured: true,
      sixCompletedTicksMemoryMeasured: true,
      requiredMemoryPhasesMeasured: true,
      memoryHighWaterRecalculated: true,
      memoryRecordedBeforeCommit: true,
      memoryFailClosedBelowHardLimit: true,
      activeProfileReadOnly: true,
      steadyComponentPassed: true,
      catchUpComponentPassed: true,
      g7Qualified: true,
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-steady-throughput.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 2,
    purpose: 'r4c2d-network-steady-throughput-verification',
    failedAt: new Date().toISOString(),
    sessionId,
    reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-steady-throughput-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}