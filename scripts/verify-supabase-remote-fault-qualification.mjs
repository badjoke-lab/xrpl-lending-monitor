import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-remote-fault-qualification`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const purpose = 'r4c2c-remote-fault-qualification'

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

function verifyResult(result) {
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.fixtureId !== 'r4c2c-remote-fault-qualification-v1'
    || result.profileId !== 'supabase-devnet-fault-qualification'
    || result.activeProfileId !== 'supabase-devnet'
  ) {
    throw new Error('remote fault qualification identity is invalid')
  }

  const expectedChecks = {
    interruptionRollbackProved: true,
    retryBackoffProved: true,
    staleLeaseReclaimProved: true,
    terminalFailClosedHaltProved: true,
    terminalReplayConverged: true,
    activeProfileIsolated: true,
    remoteFaultQualificationProved: true,
  }
  for (const [key, expected] of Object.entries(expectedChecks)) {
    if (result.checks?.[key] !== expected) {
      throw new Error(`remote fault qualification check ${key} changed`)
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
    throw new Error('remote fault qualification changed the active profile boundary')
  }

  const evidence = requireObject(result.evidence, 'remote fault evidence')
  const stream = requireObject(evidence.stream, 'remote fault stream')
  if (
    stream.status !== 'halted'
    || stream.last_error_classification !== 'integrity'
    || stream.last_error_message !== 'injected terminal qualification failure'
  ) {
    throw new Error('remote fault stream terminal state changed')
  }

  const counts = requireObject(evidence.messageStatusCounts, 'remote fault status counts')
  if (counts.completed !== 3 || counts.error !== 1 || counts.pending !== 1) {
    throw new Error('remote fault message status counts changed')
  }

  const evidenceChecks = requireObject(evidence.checks, 'remote fault evidence checks')
  for (const key of [
    'interruptionRolledBack',
    'rollbackMessageCompleted',
    'retryBackoffApplied',
    'staleLeaseReclaimed',
    'terminalHaltApplied',
    'terminalSuccessorAbsent',
    'haltProbeRemainsPending',
    'noSuccessorsReserved',
  ]) {
    if (evidenceChecks[key] !== true) {
      throw new Error(`remote fault evidence check ${key} failed`)
    }
  }

  if (!Array.isArray(evidence.successors) || evidence.successors.length !== 0) {
    throw new Error('remote fault qualification reserved an unexpected successor')
  }
  if (!Array.isArray(evidence.eventTypes)) {
    throw new Error('remote fault event types are missing')
  }
  for (const eventType of ['rollback-observed', 'retry-scheduled', 'terminal-halt']) {
    if (!evidence.eventTypes.includes(eventType)) {
      throw new Error(`remote fault event ${eventType} is missing`)
    }
  }
  if (evidence.eventTypes.includes('rollback-sentinel')) {
    throw new Error('rollback sentinel escaped the aborted transaction')
  }

  if (!Array.isArray(result.executions)) {
    throw new Error('remote fault executions are missing')
  }
  const scenarios = new Set(result.executions.map((entry) => entry?.scenario))
  for (const scenario of ['rollback', 'retry', 'stale', 'terminal']) {
    if (!scenarios.has(scenario) && result.prepared?.duplicate !== true) {
      throw new Error(`remote fault execution ${scenario} is missing`)
    }
  }

  return { evidence, counts, scenarios: [...scenarios].sort() }
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })

  const qualification = await requestRaw()
  if (!qualification.ok) {
    throw new Error(
      `remote fault qualification failed (${qualification.status}): ${JSON.stringify(qualification.body).slice(0, 1_000)}`,
    )
  }
  const verified = verifyResult(qualification.body)

  const missingToken = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
  })
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('remote fault qualification accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': 'wrong-purpose',
    'x-xrpl-reader-token': verifierToken,
  })
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('remote fault qualification accepted the wrong purpose')
  }

  const body = qualification.body
  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-remote-fault-qualification-verification',
    verifiedAt: new Date().toISOString(),
    fixtureId: body.fixtureId,
    profileId: body.profileId,
    activeProfileId: body.activeProfileId,
    preparedDuplicate: body.prepared?.duplicate === true,
    messageStatusCounts: verified.counts,
    eventTypes: body.evidence.eventTypes,
    executions: body.executions,
    stream: body.evidence.stream,
    messages: body.evidence.messages,
    events: body.evidence.events,
    successors: body.evidence.successors,
    activeIsolation: body.activeIsolation,
    activeWatermarkBefore: body.activeWatermarkBefore,
    activeWatermarkAfter: body.activeWatermarkAfter,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    checks: body.checks,
  }

  await writeFile(
    `${evidenceDirectory}/verified-remote-fault-qualification.json`,
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
    purpose: 'r4c2c-remote-fault-qualification-verification',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-remote-fault-qualification-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
