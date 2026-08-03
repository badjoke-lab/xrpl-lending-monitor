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
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) {
  throw new Error('GITHUB_RUN_ID must be a positive safe integer')
}
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()
if (!/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')
}

const steadyEndpoint =
  `https://${projectRef}.supabase.co/functions/v1/xrpl-steady-throughput-qualification`
const guardEndpoint =
  `https://${projectRef}.supabase.co/functions/v1/xrpl-resource-headroom-guard`
const steadyPurpose = 'r4c2d-network-steady-throughput'
const guardPurpose = 'r4c2d-resource-headroom-guard'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const sessionId = `r4c3-accounting-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`
const qualificationId = `r4c3-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const expectedGuardKinds = [
  'missing_accounting',
  'unsafe_accounting',
  'memory_halt',
  'tick_egress_halt',
  'monthly_egress_halt',
  'invocation_halt',
  'future_record',
]

function headers(purpose, includeToken = true) {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    ...(includeToken ? { 'x-xrpl-reader-token': verifierToken } : {}),
  }
}

async function requestRaw(endpoint, purpose, body, customHeaders = headers(purpose)) {
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

function nonNegativeInteger(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function finiteNumber(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`)
  }
  return parsed
}

function verifyCompletedSession(raw) {
  const session = object(raw, 'guarded steady session')
  const checks = object(session.checks, 'guarded steady session checks')
  if (
    session.status !== 'completed'
    || session.targetTicks !== 6
    || session.batchSize !== 24
    || session.completedTicks !== 6
    || session.committedLedgers !== 144
    || !Array.isArray(session.ticks)
  ) {
    throw new Error('guarded steady session did not complete the fixed 6x24 contract')
  }
  for (const name of [
    'activeProfileNonRegressing',
    'activeSourceIdentityPreserved',
    'targetAdvanceExact',
    'completedTickParity',
    'completedWorkParity',
    'allCompletedAttemptsOne',
  ]) {
    if (checks[name] !== true) {
      throw new Error(`guarded steady session check ${name} failed`)
    }
  }

  const completed = session.ticks
    .filter((tick) => tick.status === 'completed')
    .sort((left, right) => left.tickSequence - right.tickSequence)
  if (completed.length !== 6) throw new Error('guarded session lacks six completed ticks')

  const tickIds = []
  const minuteRates = []
  for (const [index, tick] of completed.entries()) {
    if (
      tick.tickSequence !== index + 1
      || tick.workCount !== 24
      || tick.endLedgerIndex !== tick.startLedgerIndex + 23
      || finiteNumber(tick.edgeWallMilliseconds, 'edgeWallMilliseconds') <= 0
      || finiteNumber(tick.edgeWallMilliseconds, 'edgeWallMilliseconds') >= 50_000
      || typeof tick.tickId !== 'string'
      || tick.tickId.length === 0
    ) {
      throw new Error(`guarded steady tick ${index + 1} failed identity or timing parity`)
    }
    if (index > 0) {
      const current = Date.parse(tick.scheduledMinute)
      const previous = Date.parse(completed[index - 1].scheduledMinute)
      if (!Number.isFinite(current) || current - previous !== 60_000) {
        throw new Error('guarded steady ticks are not consecutive minute buckets')
      }
    }
    tickIds.push(tick.tickId)
    minuteRates.push(tick.workCount)
  }
  return { session, completed, tickIds, minuteRates }
}

function verifyAccounting(raw, completedTickIds) {
  const accounting = object(raw, 'revision-3 accounting evidence')
  const checks = object(accounting.checks, 'revision-3 accounting checks')
  if (
    accounting.found !== true
    || accounting.schemaVersion !== 1
    || accounting.sessionId !== sessionId
    || accounting.sessionStatus !== 'completed'
    || accounting.resourceGuardEnabled !== true
    || accounting.profileId !== profileId
    || accounting.profileRevision !== profileRevision
    || accounting.profileIdentityDigest !== profileIdentityDigest
    || accounting.targetTicks !== 6
    || accounting.completedTicks !== 6
    || accounting.committedLedgers !== 144
    || accounting.completedTickCount !== 6
    || accounting.latestAccountingCount !== 6
    || accounting.accountedCompletedTickCount !== 6
    || !Array.isArray(accounting.latestAccountings)
  ) {
    throw new Error('revision-3 accounting identity or six-tick coverage changed')
  }
  for (const name of [
    'guardedSession',
    'exactRevision3Identity',
    'oneLatestAccountingPerCompletedTick',
    'allLatestAllowed',
    'allBelowThresholds',
    'allRecordedBeforeCompletion',
    'activeProfileReadOnly',
  ]) {
    if (checks[name] !== true) throw new Error(`revision-3 accounting check ${name} failed`)
  }
  if (checks.providerPeakMemoryClaimed !== false || checks.providerEgressClaimed !== false) {
    throw new Error('revision-3 accounting overstated unavailable provider counters')
  }
  if (
    nonNegativeInteger(accounting.attemptCount, 'accounting attemptCount') < 6
    || nonNegativeInteger(accounting.allowedAttemptCount, 'allowedAttemptCount') < 6
    || nonNegativeInteger(accounting.unsafeAttemptCount, 'unsafeAttemptCount') !== 0
  ) {
    throw new Error('revision-3 accounting attempts are incomplete or unsafe')
  }

  const completedSet = new Set(completedTickIds)
  const summaries = []
  for (const [index, candidate] of accounting.latestAccountings.entries()) {
    const item = object(candidate, `latest accounting ${index + 1}`)
    const itemChecks = object(item.checks, `latest accounting ${index + 1} checks`)
    if (
      !completedSet.has(item.tickId)
      || item.profileRevision !== profileRevision
      || item.profileIdentityDigest !== profileIdentityDigest
      || item.allowed !== true
      || item.ledgerCount !== 24
      || typeof item.accountingDigest !== 'string'
      || !/^[a-f0-9]{64}$/.test(item.accountingDigest)
      || nonNegativeInteger(item.networkRequestCount, 'networkRequestCount') < 25
      || nonNegativeInteger(item.databaseRequestCount, 'databaseRequestCount') < 6
      || nonNegativeInteger(item.conservativeMemoryUpperBoundBytes, 'memory bound') >= 234881024
      || nonNegativeInteger(item.conservativeTickEgressUpperBoundBytes, 'tick egress') >= 33554432
      || nonNegativeInteger(item.conservativeEgress31dUpperBoundBytes, 'monthly egress') >= 4294967296
      || nonNegativeInteger(item.projectedInvocations31d, 'projected invocations') >= 400000
    ) {
      throw new Error(`revision-3 latest accounting ${index + 1} failed bounds or identity`)
    }
    for (const name of [
      'unavailableProviderMemoryNotClaimed',
      'unavailableProviderEgressNotClaimed',
      'fixedRuntimeReserveApplied',
      'serializedBytesAmplified',
      'objectOverheadApplied',
      'allNetworkDirectionsCounted',
      'preMutationDecision',
    ]) {
      if (itemChecks[name] !== true) {
        throw new Error(`revision-3 latest accounting ${index + 1}.${name} failed`)
      }
    }
    summaries.push({
      tickId: item.tickId,
      accountingDigest: item.accountingDigest,
      exactWireBytes: item.exactWireBytes,
      conservativeMemoryUpperBoundBytes: item.conservativeMemoryUpperBoundBytes,
      conservativeTickEgressUpperBoundBytes: item.conservativeTickEgressUpperBoundBytes,
      conservativeEgress31dUpperBoundBytes: item.conservativeEgress31dUpperBoundBytes,
      projectedInvocations31d: item.projectedInvocations31d,
      transactionCount: item.transactionCount,
      metadataNodeCount: item.metadataNodeCount,
      normalizedRecordCount: item.normalizedRecordCount,
      payloadChunkCount: item.payloadChunkCount,
      relationshipCount: item.relationshipCount,
      recordedAt: item.recordedAt,
    })
  }
  return { accounting, summaries }
}

function verifyInjected(raw) {
  const result = object(raw, 'revision-3 injected qualification')
  const checks = object(result.checks, 'revision-3 injected checks')
  if (
    result.schemaVersion !== 1
    || result.action !== 'qualify_revision3'
    || result.profileId !== profileId
    || result.profileRevision !== profileRevision
    || result.profileIdentityDigest !== profileIdentityDigest
    || !Array.isArray(result.guardKinds)
    || !Array.isArray(result.results)
    || JSON.stringify(result.guardKinds) !== JSON.stringify(expectedGuardKinds)
    || result.results.length !== expectedGuardKinds.length
  ) {
    throw new Error('revision-3 injected qualification identity changed')
  }
  for (const name of [
    'allSevenRevision3GuardsRejected',
    'noGuardedStateMutation',
    'activeProfileReadOnly',
    'exactRevision3Identity',
    'unavailableProviderMemoryNotClaimed',
    'unavailableProviderEgressNotClaimed',
  ]) {
    if (checks[name] !== true) throw new Error(`revision-3 injected check ${name} failed`)
  }
  if (checks.profileSelected !== false || checks.g8Qualified !== false) {
    throw new Error('revision-3 injected qualification overstated selection or G8')
  }
  for (const [index, candidate] of result.results.entries()) {
    const item = object(candidate, `injected result ${index + 1}`)
    const itemChecks = object(item.checks, `injected result ${index + 1} checks`)
    const counts = object(item.guardedCounts, `injected result ${index + 1} counts`)
    if (item.guardKind !== expectedGuardKinds[index] || item.rejected !== true) {
      throw new Error(`revision-3 injected result ${index + 1} did not reject`)
    }
    for (const key of ['ticks', 'works', 'messages', 'successors']) {
      if (nonNegativeInteger(counts[key], `${item.guardKind}.${key}`) !== 0) {
        throw new Error(`revision-3 injected ${item.guardKind} mutated ${key}`)
      }
    }
    for (const name of [
      'precommitRejected',
      'noCompletedTick',
      'noWorkCommitted',
      'noMessageReserved',
      'noSuccessorReserved',
      'activeProfileReadOnly',
      'exactRevision3Identity',
    ]) {
      if (itemChecks[name] !== true) {
        throw new Error(`revision-3 injected ${item.guardKind}.${name} failed`)
      }
    }
  }
  return result
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const prepared = await requestRaw(
    guardEndpoint,
    guardPurpose,
    { action: 'prepare_guarded', sessionId },
  )
  if (!prepared.ok || prepared.body?.action !== 'prepare_guarded') {
    throw new Error(
      `revision-3 guarded preparation failed (${prepared.status}): ${JSON.stringify(prepared.body).slice(0, 2_000)}`,
    )
  }

  const startedAt = Date.now()
  const deadline = startedAt + 10 * 60_000
  let latest = null
  let latestAccounting = null
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10_000))
    const read = await requestRaw(
      steadyEndpoint,
      steadyPurpose,
      { action: 'read', sessionId },
    )
    if (!read.ok) {
      throw new Error(
        `revision-3 guarded read failed (${read.status}): ${JSON.stringify(read.body).slice(0, 2_000)}`,
      )
    }
    latest = object(read.body?.session, 'guarded session response')
    latestAccounting = object(read.body?.revision3Accounting, 'revision-3 accounting response')
    if (latest.status === 'halted') {
      throw new Error(`revision-3 guarded session halted: ${String(latest.lastError ?? 'unknown')}`)
    }
    if (latest.status === 'completed') break
  }
  if (latest === null || latestAccounting === null || latest.status !== 'completed') {
    throw new Error('revision-3 guarded session did not complete within ten minutes')
  }

  const verifiedSession = verifyCompletedSession(latest)
  const verifiedAccounting = verifyAccounting(latestAccounting, verifiedSession.tickIds)

  const injectedResponse = await requestRaw(
    guardEndpoint,
    guardPurpose,
    { action: 'qualify_revision3', qualificationId },
  )
  if (!injectedResponse.ok) {
    throw new Error(
      `revision-3 injected qualification failed (${injectedResponse.status}): ${JSON.stringify(injectedResponse.body).slice(0, 2_000)}`,
    )
  }
  const injected = verifyInjected(injectedResponse.body)

  const missingToken = await requestRaw(
    steadyEndpoint,
    steadyPurpose,
    { action: 'read', sessionId },
    headers(steadyPurpose, false),
  )
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('revision-3 qualification accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw(
    guardEndpoint,
    guardPurpose,
    { action: 'qualify_revision3', qualificationId },
    headers('wrong-purpose'),
  )
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('revision-3 qualification accepted the wrong purpose')
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c3-supabase-revision3-accounting-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId,
    sourceCommit,
    sessionId,
    qualificationId,
    elapsedMilliseconds: Date.now() - startedAt,
    profileId,
    profileRevision,
    profileIdentityDigest,
    network: 'devnet',
    completedTicks: 6,
    committedLedgers: 144,
    minuteRates: verifiedSession.minuteRates,
    accountingAttempts: verifiedAccounting.accounting.attemptCount,
    allowedAccountingAttempts: verifiedAccounting.accounting.allowedAttemptCount,
    unsafeAccountingAttempts: verifiedAccounting.accounting.unsafeAttemptCount,
    accountingSummaries: verifiedAccounting.summaries,
    injectedGuardKinds: injected.guardKinds,
    checks: {
      guardedSixMinuteSessionCompleted: true,
      exact144LedgerAdvance: true,
      oneSafeLatestAccountingPerCompletedTick: true,
      accountingRecordedBeforeCompletion: true,
      allConservativeBoundsBelowProjectHalts: true,
      allSevenInjectedPrecommitFailuresRejected: true,
      noInjectedStateMutation: true,
      activeProfileReadOnly: true,
      missingTokenRejected: true,
      wrongPurposeRejected: true,
      unavailableProviderMemoryNotClaimed: true,
      unavailableProviderEgressNotClaimed: true,
      g8Qualified: false,
      profileSelected: false,
      r5Authorized: false,
    },
  }

  await writeFile(
    `${evidenceDirectory}/verified-revision3-accounting.json`,
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
    purpose: 'r4c3-supabase-revision3-accounting-verification',
    failedAt: new Date().toISOString(),
    sourceRunId,
    sourceCommit,
    sessionId,
    qualificationId,
    profileId,
    profileRevision,
    profileIdentityDigest,
    error: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
    checks: {
      g8Qualified: false,
      profileSelected: false,
      r5Authorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-revision3-accounting-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
