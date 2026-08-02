const PURPOSE = 'r4c2c-remote-fault-qualification'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const ACTIVE_PROFILE_ID = 'supabase-devnet'
const PROFILE_ID = 'supabase-devnet-fault-qualification'
const FIXTURE_ID = 'r4c2c-remote-fault-qualification-v1'

type Json = Record<string, unknown>
type ActiveWatermark = {
  profileId: string
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
}
type ClaimResult = {
  claimed: boolean
  reason?: string
  messageId?: string
  scenario?: string
  attemptCount?: number
  leaseOwner?: string
  leaseExpiresAt?: string
  reclaimed?: boolean
  previousLeaseOwner?: string | null
  previousLeaseExpiresAt?: string | null
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function serviceKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function adminHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, name: string): Json {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requireInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function requireHash(value: unknown, name: string): string {
  const hash = requireString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) throw new Error(`${name} must be a canonical hash`)
  return hash
}

async function postRpcRaw(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
  timeout = 60_000,
): Promise<{ ok: boolean; status: number; body: unknown; text: string }> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await result.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // Preserve bounded text below.
  }
  return { ok: result.ok, status: result.status, body: parsed, text: text.slice(0, 1_000) }
}

async function postRpc<T>(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
  timeout = 60_000,
): Promise<T> {
  const result = await postRpcRaw(supabaseUrl, key, functionName, body, timeout)
  if (!result.ok) {
    throw new Error(`${functionName} failed (${result.status}): ${result.text}`)
  }
  return result.body as T
}

async function getRows<T>(supabaseUrl: string, key: string, path: string): Promise<T[]> {
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: adminHeaders(key),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await result.text()
  if (!result.ok) throw new Error(`storage read failed (${result.status}): ${text.slice(0, 500)}`)
  return JSON.parse(text) as T[]
}

async function activeWatermark(supabaseUrl: string, key: string): Promise<ActiveWatermark> {
  const rows = await getRows<Json>(
    supabaseUrl,
    key,
    'xrpl_phase_watermarks?profile_id=eq.supabase-devnet&select=profile_id,network,epoch_id,base_identity,ledger_index,ledger_hash,work_id&limit=2',
  )
  if (rows.length !== 1) throw new Error(`active watermark returned ${rows.length} rows`)
  const row = rows[0]!
  const result = {
    profileId: requireString(row.profile_id, 'active profile_id'),
    network: requireString(row.network, 'active network'),
    epochId: requireString(row.epoch_id, 'active epoch_id'),
    baseIdentity: requireString(row.base_identity, 'active base_identity'),
    ledgerIndex: requireInteger(row.ledger_index, 'active ledger_index'),
    ledgerHash: requireHash(row.ledger_hash, 'active ledger_hash'),
    workId: requireString(row.work_id, 'active work_id'),
  }
  if (
    result.profileId !== ACTIVE_PROFILE_ID
    || result.network !== 'devnet'
    || result.epochId !== 'supabase-r4c2c-v1'
  ) {
    throw new Error('active watermark source identity changed')
  }
  return result
}

function verifyActiveIsolation(before: ActiveWatermark, after: ActiveWatermark): Json {
  if (
    before.profileId !== after.profileId
    || before.network !== after.network
    || before.epochId !== after.epochId
    || before.baseIdentity !== after.baseIdentity
    || after.ledgerIndex < before.ledgerIndex
  ) {
    throw new Error('fault qualification changed or regressed active source identity')
  }
  if (
    after.ledgerIndex === before.ledgerIndex
    && (after.ledgerHash !== before.ledgerHash || after.workId !== before.workId)
  ) {
    throw new Error('active watermark changed identity without advancing')
  }
  return {
    ledgerAdvance: after.ledgerIndex - before.ledgerIndex,
    nonRegressing: true,
    sourceIdentityPreserved: true,
  }
}

function iso(base: number, offsetSeconds: number): string {
  return new Date(base + offsetSeconds * 1_000).toISOString()
}

async function readEvidence(supabaseUrl: string, key: string): Promise<Json> {
  return await postRpc<Json>(supabaseUrl, key, 'xrpl_read_remote_fault_evidence', {})
}

function messageByScenario(evidence: Json, scenario: string): Json {
  if (!Array.isArray(evidence.messages)) throw new Error('fault evidence messages are missing')
  const message = evidence.messages
    .map((value) => requireRecord(value, 'fault message'))
    .find((value) => requireRecord(value.payload, 'fault payload').scenario === scenario)
  if (!message) throw new Error(`fault scenario ${scenario} is missing`)
  return message
}

async function claim(
  supabaseUrl: string,
  key: string,
  messageId: string,
  owner: string,
  at: string,
  leaseSeconds = 10,
): Promise<ClaimResult> {
  return await postRpc<ClaimResult>(supabaseUrl, key, 'xrpl_claim_remote_fault_message', {
    p_message_id: messageId,
    p_owner: owner,
    p_now: at,
    p_lease_seconds: leaseSeconds,
  })
}

async function complete(
  supabaseUrl: string,
  key: string,
  messageId: string,
  owner: string,
  at: string,
): Promise<Json> {
  const result = await postRpc<Json>(supabaseUrl, key, 'xrpl_complete_remote_fault_message', {
    p_message_id: messageId,
    p_owner: owner,
    p_completed_at: at,
  })
  if (result.completed !== true) throw new Error(`fault completion failed: ${String(result.reason)}`)
  return result
}

async function ensureRollback(
  supabaseUrl: string,
  key: string,
  base: number,
  executions: Json[],
): Promise<void> {
  const messageId = 'fault:v1:rollback'
  let evidence = await readEvidence(supabaseUrl, key)
  let message = messageByScenario(evidence, 'rollback')
  if (message.status === 'completed') return

  const owner = `fault-rollback-${crypto.randomUUID()}`
  const claimResult = await claim(supabaseUrl, key, messageId, owner, iso(base, 1), 55)
  if (!claimResult.claimed) {
    if (claimResult.reason !== 'lease_active') {
      throw new Error(`rollback claim failed: ${claimResult.reason ?? 'unknown'}`)
    }
    const reclaim = await claim(supabaseUrl, key, messageId, owner, iso(base, 120), 55)
    if (!reclaim.claimed || reclaim.reclaimed !== true) {
      throw new Error('rollback stale prerequisite lease did not reclaim')
    }
  }

  const injected = await postRpcRaw(supabaseUrl, key, 'xrpl_inject_remote_fault_rollback', {
    p_message_id: messageId,
    p_owner: owner,
    p_now: iso(base, 122),
  })
  if (injected.ok || !injected.text.includes('injected_interruption_rollback')) {
    throw new Error('rollback injection did not abort its transaction')
  }

  const observation = await postRpc<Json>(
    supabaseUrl,
    key,
    'xrpl_record_remote_fault_rollback_observation',
    {
      p_message_id: messageId,
      p_owner: owner,
      p_observed_at: iso(base, 123),
    },
  )
  if (
    observation.observed !== true
    || observation.messageRemainedLeased !== true
    || observation.sentinelAbsent !== true
    || observation.successorAbsent !== true
  ) {
    throw new Error('rollback observation did not prove atomic rollback')
  }

  const completion = await complete(supabaseUrl, key, messageId, owner, iso(base, 124))
  evidence = await readEvidence(supabaseUrl, key)
  message = messageByScenario(evidence, 'rollback')
  if (message.status !== 'completed') throw new Error('rollback message did not complete after proof')
  executions.push({ scenario: 'rollback', injectionStatus: injected.status, observation, completion })
}

async function ensureRetry(
  supabaseUrl: string,
  key: string,
  base: number,
  executions: Json[],
): Promise<void> {
  const messageId = 'fault:v1:retry'
  let evidence = await readEvidence(supabaseUrl, key)
  let message = messageByScenario(evidence, 'retry')
  if (message.status === 'completed') return

  const firstOwner = `fault-retry-a-${crypto.randomUUID()}`
  const secondOwner = `fault-retry-b-${crypto.randomUUID()}`
  let scheduled: Json
  let availableAt: string

  if (message.status === 'pending' || message.status === 'leased') {
    let firstClaim = await claim(supabaseUrl, key, messageId, firstOwner, iso(base, 200), 55)
    if (!firstClaim.claimed) {
      firstClaim = await claim(supabaseUrl, key, messageId, firstOwner, iso(base, 320), 55)
    }
    if (!firstClaim.claimed) throw new Error('retry first attempt could not be claimed')
    scheduled = await postRpc<Json>(supabaseUrl, key, 'xrpl_schedule_remote_fault_retry', {
      p_message_id: messageId,
      p_owner: firstOwner,
      p_failed_at: iso(base, 322),
      p_backoff_seconds: 30,
    })
    if (scheduled.scheduled !== true || scheduled.backoffSeconds !== 30) {
      throw new Error('retry backoff was not scheduled exactly')
    }
    availableAt = requireString(scheduled.availableAt, 'retry availableAt')
  } else if (message.status === 'retry') {
    availableAt = requireString(message.available_at, 'existing retry available_at')
    scheduled = { scheduled: true, duplicate: true, availableAt }
  } else {
    throw new Error(`unexpected retry message status: ${String(message.status)}`)
  }

  const due = Date.parse(availableAt)
  if (!Number.isFinite(due)) throw new Error('retry availableAt is invalid')
  const preDue = await claim(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(due - 1_000).toISOString(),
    55,
  )
  if (preDue.claimed || preDue.reason !== 'not_ready') {
    throw new Error('retry message was claimable before exact backoff expiry')
  }

  const dueClaim = await claim(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(due).toISOString(),
    55,
  )
  if (!dueClaim.claimed || dueClaim.attemptCount !== 2) {
    throw new Error('retry message did not claim on the second attempt at exact due time')
  }
  const completion = await complete(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(due + 1_000).toISOString(),
  )
  evidence = await readEvidence(supabaseUrl, key)
  message = messageByScenario(evidence, 'retry')
  if (message.status !== 'completed' || message.attempt_count !== 2) {
    throw new Error('retry message final state is invalid')
  }
  executions.push({ scenario: 'retry', scheduled, preDue, dueClaim, completion })
}

async function ensureStaleLease(
  supabaseUrl: string,
  key: string,
  base: number,
  executions: Json[],
): Promise<void> {
  const messageId = 'fault:v1:stale'
  let evidence = await readEvidence(supabaseUrl, key)
  let message = messageByScenario(evidence, 'stale')
  if (message.status === 'completed') return

  const firstOwner = `fault-stale-a-${crypto.randomUUID()}`
  const secondOwner = `fault-stale-b-${crypto.randomUUID()}`
  let firstClaim: ClaimResult

  if (message.status === 'pending') {
    firstClaim = await claim(supabaseUrl, key, messageId, firstOwner, iso(base, 400), 10)
    if (!firstClaim.claimed || firstClaim.attemptCount !== 1) {
      throw new Error('stale lease first claim failed')
    }
  } else if (message.status === 'leased') {
    firstClaim = {
      claimed: true,
      messageId,
      attemptCount: requireInteger(message.attempt_count, 'stale attempt_count'),
      leaseOwner: requireString(message.lease_owner, 'stale lease_owner'),
      leaseExpiresAt: requireString(message.lease_expires_at, 'stale lease_expires_at'),
    }
  } else {
    throw new Error(`unexpected stale message status: ${String(message.status)}`)
  }

  const expiry = Date.parse(requireString(firstClaim.leaseExpiresAt, 'stale lease expiry'))
  if (!Number.isFinite(expiry)) throw new Error('stale lease expiry is invalid')
  const beforeExpiry = await claim(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(expiry - 1_000).toISOString(),
    10,
  )
  if (beforeExpiry.claimed || beforeExpiry.reason !== 'lease_active') {
    throw new Error('stale lease was reclaimed before exact expiry')
  }

  const reclaimed = await claim(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(expiry).toISOString(),
    10,
  )
  if (
    !reclaimed.claimed
    || reclaimed.reclaimed !== true
    || reclaimed.attemptCount !== 2
    || !reclaimed.previousLeaseOwner
  ) {
    throw new Error('stale lease did not reclaim exactly at expiry')
  }
  const completion = await complete(
    supabaseUrl,
    key,
    messageId,
    secondOwner,
    new Date(expiry + 1_000).toISOString(),
  )
  evidence = await readEvidence(supabaseUrl, key)
  message = messageByScenario(evidence, 'stale')
  if (message.status !== 'completed' || message.attempt_count !== 2) {
    throw new Error('stale lease message final state is invalid')
  }
  executions.push({ scenario: 'stale', firstClaim, beforeExpiry, reclaimed, completion })
}

async function ensureTerminalHalt(
  supabaseUrl: string,
  key: string,
  base: number,
  executions: Json[],
): Promise<void> {
  const messageId = 'fault:v1:terminal'
  const owner = `fault-terminal-${crypto.randomUUID()}`
  let evidence = await readEvidence(supabaseUrl, key)
  let message = messageByScenario(evidence, 'terminal')
  let halt: Json

  if (message.status !== 'error') {
    let terminalClaim = await claim(supabaseUrl, key, messageId, owner, iso(base, 500), 55)
    if (!terminalClaim.claimed) {
      terminalClaim = await claim(supabaseUrl, key, messageId, owner, iso(base, 620), 55)
    }
    if (!terminalClaim.claimed) throw new Error('terminal message could not be claimed')
    halt = await postRpc<Json>(supabaseUrl, key, 'xrpl_terminal_halt_remote_fault', {
      p_message_id: messageId,
      p_owner: owner,
      p_halted_at: iso(base, 622),
      p_classification: 'integrity',
      p_error_message: 'injected terminal qualification failure',
    })
    if (halt.halted !== true || halt.duplicate === true || halt.successorReserved !== false) {
      throw new Error('terminal halt did not fail closed')
    }
  } else {
    halt = { halted: true, duplicate: true, successorReserved: false }
  }

  const duplicate = await postRpc<Json>(supabaseUrl, key, 'xrpl_terminal_halt_remote_fault', {
    p_message_id: messageId,
    p_owner: owner,
    p_halted_at: iso(base, 623),
    p_classification: 'integrity',
    p_error_message: 'injected terminal qualification failure',
  })
  if (duplicate.halted !== true || duplicate.duplicate !== true) {
    throw new Error('terminal halt replay did not converge')
  }

  const haltedProbe = await claim(
    supabaseUrl,
    key,
    'fault:v1:halt-probe',
    `fault-probe-${crypto.randomUUID()}`,
    iso(base, 624),
    10,
  )
  if (haltedProbe.claimed || haltedProbe.reason !== 'stream_halted') {
    throw new Error('halted stream allowed a ready probe message to claim')
  }

  evidence = await readEvidence(supabaseUrl, key)
  message = messageByScenario(evidence, 'terminal')
  if (message.status !== 'error' || evidence.stream === null) {
    throw new Error('terminal evidence is unavailable')
  }
  executions.push({ scenario: 'terminal', halt, duplicate, haltedProbe })
}

function verifyFinalEvidence(evidence: Json): Json {
  if (
    evidence.schemaVersion !== 1
    || evidence.fixtureId !== FIXTURE_ID
    || evidence.profileId !== PROFILE_ID
    || evidence.activeProfileId !== ACTIVE_PROFILE_ID
  ) {
    throw new Error('fault evidence identity is invalid')
  }
  const stream = requireRecord(evidence.stream, 'fault stream')
  if (
    stream.status !== 'halted'
    || stream.last_error_classification !== 'integrity'
    || stream.last_error_message !== 'injected terminal qualification failure'
  ) {
    throw new Error('fault stream terminal state is invalid')
  }
  const checks = requireRecord(evidence.checks, 'fault checks')
  for (const check of [
    'interruptionRolledBack',
    'rollbackMessageCompleted',
    'retryBackoffApplied',
    'staleLeaseReclaimed',
    'terminalHaltApplied',
    'terminalSuccessorAbsent',
    'haltProbeRemainsPending',
    'noSuccessorsReserved',
  ]) {
    if (checks[check] !== true) throw new Error(`fault check ${check} failed`)
  }
  const counts = requireRecord(evidence.messageStatusCounts, 'fault message status counts')
  if (counts.completed !== 3 || counts.error !== 1 || counts.pending !== 1) {
    throw new Error('fault message status counts changed')
  }
  if (!Array.isArray(evidence.successors) || evidence.successors.length !== 0) {
    throw new Error('fault qualification reserved an unexpected successor')
  }
  if (!Array.isArray(evidence.events)) throw new Error('fault events are missing')
  const eventTypes = new Set(
    evidence.events.map((value) => requireString(requireRecord(value, 'fault event').event_type, 'event_type')),
  )
  for (const eventType of ['rollback-observed', 'retry-scheduled', 'terminal-halt']) {
    if (!eventTypes.has(eventType)) throw new Error(`fault event ${eventType} is missing`)
  }
  if (eventTypes.has('rollback-sentinel')) {
    throw new Error('rollback sentinel escaped the aborted transaction')
  }
  return { stream, checks, counts, eventTypes: [...eventTypes].sort() }
}

async function execute(): Promise<Json> {
  const supabaseUrl = env('SUPABASE_URL')
  const key = serviceKey()
  const activeBefore = await activeWatermark(supabaseUrl, key)
  const prepared = await postRpc<Json>(supabaseUrl, key, 'xrpl_prepare_remote_fault_qualification', {
    p_now: new Date().toISOString(),
  })
  if (
    prepared.prepared !== true
    || prepared.fixtureId !== FIXTURE_ID
    || prepared.profileId !== PROFILE_ID
    || prepared.activeProfileId !== ACTIVE_PROFILE_ID
  ) {
    throw new Error('fault qualification preparation identity is invalid')
  }

  const base = Date.now()
  const executions: Json[] = []
  await ensureRollback(supabaseUrl, key, base, executions)
  await ensureRetry(supabaseUrl, key, base, executions)
  await ensureStaleLease(supabaseUrl, key, base, executions)
  await ensureTerminalHalt(supabaseUrl, key, base, executions)

  const evidence = await readEvidence(supabaseUrl, key)
  const verified = verifyFinalEvidence(evidence)
  const activeAfter = await activeWatermark(supabaseUrl, key)
  const activeIsolation = verifyActiveIsolation(activeBefore, activeAfter)

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    fixtureId: FIXTURE_ID,
    profileId: PROFILE_ID,
    activeProfileId: ACTIVE_PROFILE_ID,
    prepared,
    executions,
    evidence: {
      activeAnchor: evidence.activeAnchor,
      stream: verified.stream,
      messageStatusCounts: verified.counts,
      messages: evidence.messages,
      events: evidence.events,
      eventTypes: verified.eventTypes,
      successors: evidence.successors,
      checks: verified.checks,
    },
    activeWatermarkBefore: activeBefore,
    activeWatermarkAfter: activeAfter,
    activeIsolation,
    checks: {
      interruptionRollbackProved: true,
      retryBackoffProved: true,
      staleLeaseReclaimProved: true,
      terminalFailClosedHaltProved: true,
      terminalReplayConverged: true,
      activeProfileIsolated: true,
      remoteFaultQualificationProved: true,
    },
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
      return response({ error: 'invalid_purpose' }, 403)
    }
    if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')) {
      return response({ error: 'unauthorized' }, 401)
    }
    return response(await execute())
  } catch (error) {
    return response(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      },
      500,
    )
  }
})
