import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-throughput-resource-baseline`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const purpose = 'r4c2d-throughput-resource-baseline'

function headers() {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    'x-xrpl-reader-token': verifierToken,
  }
}

async function requestRaw(customHeaders = headers()) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: customHeaders,
    body: '{}',
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 1_000) }
  }
  return { ok: response.ok, status: response.status, body }
}

function requireObject(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function requireNumber(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function verifyResult(result) {
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.profileId !== 'supabase-devnet'
    || !Array.isArray(result.measurements)
    || result.measurements.length !== 3
  ) {
    throw new Error('throughput resource baseline identity is invalid')
  }

  const windows = [60, 360, 1440]
  for (const [index, expectedWindow] of windows.entries()) {
    const measurement = requireObject(result.measurements[index], `measurement ${expectedWindow}`)
    if (measurement.windowMinutes !== expectedWindow) {
      throw new Error(`throughput resource baseline window ${expectedWindow} changed`)
    }
    requireNumber(measurement.rpcWallMilliseconds, `measurement ${expectedWindow} rpc wall time`)
    requireNumber(measurement.rpcResponseBytes, `measurement ${expectedWindow} response bytes`)

    const throughput = requireObject(measurement.throughput, `throughput ${expectedWindow}`)
    if (
      throughput.windowMinutes !== expectedWindow
      || throughput.observedMinutes !== expectedWindow
      || throughput.steadyThreshold !== 21
      || throughput.catchUpThreshold !== 30
    ) {
      throw new Error(`throughput ${expectedWindow} contract changed`)
    }
    for (const key of [
      'committedLedgers',
      'committedWorks',
      'committedRecords',
      'averageLedgersPerMinute',
      'p50LedgersPerMinute',
      'p95LedgersPerMinute',
      'maxLedgersPerMinute',
      'productiveMinutes',
      'zeroMinutes',
    ]) {
      requireNumber(throughput[key], `throughput ${expectedWindow}.${key}`)
    }
    if (throughput.productiveMinutes + throughput.zeroMinutes !== expectedWindow) {
      throw new Error(`throughput ${expectedWindow} minute buckets are incomplete`)
    }

    const coverage = requireObject(
      measurement.measurementCoverage,
      `measurement coverage ${expectedWindow}`,
    )
    for (const key of [
      'committedThroughput',
      'workLatency',
      'phaseAttempts',
      'databaseStorage',
      'tableStorage',
      'rowCounts',
      'payloadBytes',
      'schedulerPayloadBytes',
      'databaseConnections',
    ]) {
      if (coverage[key] !== true) throw new Error(`coverage ${expectedWindow}.${key} is missing`)
    }
    for (const key of [
      'edgeCpu',
      'edgeMemory',
      'edgeInvocationCount',
      'bandwidth',
      'billingAndOverage',
    ]) {
      if (coverage[key] !== false) throw new Error(`coverage ${expectedWindow}.${key} was overstated`)
    }
  }

  const decision = requireObject(result.baselineDecision, 'baseline decision')
  if (
    decision.steadyP95Threshold !== 21
    || decision.catchUpThreshold !== 30
    || decision.catchUpModeMeasured !== false
    || decision.catchUpPass !== false
    || decision.g7Qualified !== false
    || decision.g8Qualified !== false
  ) {
    throw new Error('throughput resource baseline overstated G7 or G8 qualification')
  }

  for (const key of [
    'activeProfileReadOnly',
    'activeProfileNonRegressing',
    'threeWindowsMeasured',
    'zeroMinuteBucketsIncluded',
    'committedEndToEndWorkMeasured',
    'configuredPayloadCeilingRespected',
    'configuredSchedulerCeilingRespected',
    'coverageNotOverstated',
    'baselineCompleted',
  ]) {
    if (result.checks?.[key] !== true) {
      throw new Error(`throughput resource baseline check ${key} failed`)
    }
  }

  if (
    result.activeWatermarkBefore?.profileId !== 'supabase-devnet'
    || result.activeWatermarkAfter?.profileId !== 'supabase-devnet'
    || result.activeWatermarkBefore?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.ledgerIndex < result.activeWatermarkBefore?.ledgerIndex
    || result.activeIsolation?.nonRegressing !== true
    || result.activeIsolation?.sourceIdentityPreserved !== true
  ) {
    throw new Error('throughput resource baseline changed the active profile boundary')
  }
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })

  const baseline = await requestRaw()
  if (!baseline.ok) {
    throw new Error(
      `throughput resource baseline failed (${baseline.status}): ${JSON.stringify(baseline.body).slice(0, 1_000)}`,
    )
  }
  verifyResult(baseline.body)

  const missingToken = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
  })
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('throughput resource baseline accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': 'wrong-purpose',
    'x-xrpl-reader-token': verifierToken,
  })
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('throughput resource baseline accepted the wrong purpose')
  }

  const body = baseline.body
  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-throughput-resource-baseline-verification',
    verifiedAt: new Date().toISOString(),
    profileId: body.profileId,
    observedAt: body.observedAt,
    measurements: body.measurements,
    activeWatermarkBefore: body.activeWatermarkBefore,
    activeWatermarkAfter: body.activeWatermarkAfter,
    activeIsolation: body.activeIsolation,
    baselineDecision: body.baselineDecision,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    checks: body.checks,
  }

  await writeFile(
    `${evidenceDirectory}/verified-throughput-resource-baseline.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await verify()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2d-throughput-resource-baseline-verification',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-throughput-resource-baseline-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
