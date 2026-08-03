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

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-resource-headroom-guard`
const purpose = 'r4c2d-resource-headroom-guard'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const qualificationId = `r4c2d-guard-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
const guardKinds = [
  'database',
  'connections',
  'edge_wall',
  'external_snapshot',
  'invocations',
  'bundle',
]

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
    signal: AbortSignal.timeout(180_000),
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
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function verifySnapshot(raw) {
  const snapshot = object(raw, 'resource snapshot')
  const thresholds = object(snapshot.thresholds, 'resource thresholds')
  const coverage = object(snapshot.coverage, 'resource coverage')
  const measurements = object(snapshot.measurements, 'resource measurements')

  const exactThresholds = {
    databaseHaltBytes: 400000000,
    databaseHardBytes: 500000000,
    connectionHalt: 45,
    connectionHard: 60,
    edgeWallHaltMilliseconds: 45000,
    edgeWallHardMilliseconds: 150000,
    invocationHalt31d: 400000,
    invocationHard31d: 500000,
    bundleHaltBytes: 4000000,
    bundleHardBytes: 5000000,
  }
  for (const [key, expected] of Object.entries(exactThresholds)) {
    if (numberValue(thresholds[key], `thresholds.${key}`) !== expected) {
      throw new Error(`resource threshold ${key} changed`)
    }
  }

  for (const key of ['databaseStorage', 'databaseConnections', 'edgeWall']) {
    if (coverage[key] !== true) throw new Error(`resource coverage ${key} is missing`)
  }
  for (const key of ['edgeCpu', 'edgeMemory', 'bandwidth', 'billingAndOverage']) {
    if (coverage[key] !== false) throw new Error(`resource coverage ${key} was overstated`)
  }

  numberValue(measurements.databaseBytes, 'measurements.databaseBytes')
  numberValue(measurements.connectionCount, 'measurements.connectionCount')
  numberValue(measurements.maxEdgeWallMilliseconds24h, 'measurements.maxEdgeWallMilliseconds24h')
  if (typeof snapshot.allowed !== 'boolean' || !Array.isArray(snapshot.failures)) {
    throw new Error('resource snapshot decision shape is invalid')
  }
  return { snapshot, thresholds, coverage, measurements }
}

function verifyQualification(raw) {
  const result = object(raw, 'resource qualification')
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.action !== 'qualify'
    || result.qualificationId !== qualificationId
    || !Array.isArray(result.guardKinds)
    || !Array.isArray(result.results)
  ) {
    throw new Error('resource qualification identity is invalid')
  }
  if (JSON.stringify(result.guardKinds) !== JSON.stringify(guardKinds)) {
    throw new Error('resource qualification guard order changed')
  }
  if (result.results.length !== guardKinds.length) {
    throw new Error('resource qualification did not execute all six guards')
  }

  for (const [index, guardKind] of guardKinds.entries()) {
    const guard = object(result.results[index], `guard ${guardKind}`)
    const counts = object(guard.guardedCounts, `guard ${guardKind} counts`)
    const checks = object(guard.checks, `guard ${guardKind} checks`)
    if (guard.guardKind !== guardKind || guard.halted !== true) {
      throw new Error(`resource guard ${guardKind} did not halt exactly`)
    }
    for (const key of ['ticks', 'works', 'messages', 'successors']) {
      if (numberValue(counts[key], `${guardKind}.${key}`) !== 0) {
        throw new Error(`resource guard ${guardKind} reserved ${key}`)
      }
    }
    for (const key of [
      'exactGuardIsolated',
      'noTickReserved',
      'noWorkCommitted',
      'noMessageReserved',
      'noSuccessorReserved',
      'activeProfileNonRegressing',
      'activeSourceIdentityPreserved',
    ]) {
      if (checks[key] !== true) throw new Error(`resource guard ${guardKind}.${key} failed`)
    }
    const before = object(guard.activeBefore, `guard ${guardKind} activeBefore`)
    const after = object(guard.activeAfter, `guard ${guardKind} activeAfter`)
    if (
      after.ledgerIndex < before.ledgerIndex
      || after.epochId !== before.epochId
      || after.baseIdentity !== before.baseIdentity
    ) {
      throw new Error(`resource guard ${guardKind} changed active source identity`)
    }
  }

  const checks = object(result.checks, 'resource qualification checks')
  for (const key of [
    'allSixGuardsHalted',
    'noGuardedStateReserved',
    'activeProfileReadOnly',
    'exactThresholdInjection',
  ]) {
    if (checks[key] !== true) throw new Error(`resource qualification ${key} failed`)
  }
  if (checks.g8Qualified !== false || checks.profileSelected !== false) {
    throw new Error('resource qualification overstated G8 or profile selection')
  }
  return result
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })

  const read = await requestRaw({ action: 'read' })
  if (!read.ok || read.body?.action !== 'read') {
    throw new Error(`resource snapshot read failed (${read.status}): ${JSON.stringify(read.body).slice(0, 2_000)}`)
  }
  const live = verifySnapshot(read.body.snapshot)

  const qualification = await requestRaw({ action: 'qualify', qualificationId })
  if (!qualification.ok) {
    throw new Error(`resource qualification failed (${qualification.status}): ${JSON.stringify(qualification.body).slice(0, 2_000)}`)
  }
  const verified = verifyQualification(qualification.body)

  const missingToken = await requestRaw(
    { action: 'read' },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': purpose,
    },
  )
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('resource guard accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw(
    { action: 'read' },
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'wrong-purpose',
      'x-xrpl-reader-token': verifierToken,
    },
  )
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('resource guard accepted the wrong purpose')
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-resource-headroom-guard-verification',
    verifiedAt: new Date().toISOString(),
    qualificationId,
    liveSnapshot: live.snapshot,
    thresholds: live.thresholds,
    coverage: live.coverage,
    qualification: verified,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    checks: {
      sixFailClosedThresholdsProved: true,
      preReservationHaltProved: true,
      activeProfileReadOnly: true,
      liveProviderCoverageNotOverstated: true,
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-resource-headroom-guard.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2d-resource-headroom-guard-verification',
    failedAt: new Date().toISOString(),
    qualificationId,
    reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-resource-headroom-guard-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}