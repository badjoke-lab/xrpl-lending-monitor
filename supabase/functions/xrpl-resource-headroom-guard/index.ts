const PURPOSE = 'r4c2d-resource-headroom-guard'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const GUARD_KINDS = [
  'database',
  'connections',
  'edge_wall',
  'external_snapshot',
  'invocations',
  'bundle',
] as const
const REVISION3_GUARD_KINDS = [
  'missing_accounting',
  'unsafe_accounting',
  'memory_halt',
  'tick_egress_halt',
  'monthly_egress_halt',
  'invocation_halt',
  'future_record',
] as const

type JsonObject = Record<string, unknown>
type GuardKind = (typeof GUARD_KINDS)[number]
type Revision3GuardKind = (typeof REVISION3_GUARD_KINDS)[number]

function json(body: unknown, status = 200): Response {
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

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as JsonObject
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function requiredHex(value: unknown, length: number, name: string): string {
  const text = requiredString(value, name).toLowerCase()
  if (!new RegExp(`^[a-f0-9]{${length}}$`, 'u').test(text)) {
    throw new Error(`${name} must be ${length} lowercase hex characters`)
  }
  return text
}

function headers(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
}

async function rpc<T>(functionName: string, body: JsonObject): Promise<T> {
  const key = serviceKey()
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(55_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${functionName} failed (${response.status}): ${text.slice(0, 1_500)}`)
  }
  return JSON.parse(text) as T
}

async function finalizeAttempt(options: {
  sessionId: string
  attemptId: string
  status: 'succeeded' | 'failed' | 'deferred'
  tickId: string | null
  finalizedEgressUpperBoundBytes: number | null
  accountingDigest: string | null
  errorMessage: string | null
}): Promise<JsonObject> {
  return await rpc<JsonObject>('xrpl_finalize_revision3_attempt', {
    p_session_id: options.sessionId,
    p_attempt_id: options.attemptId,
    p_status: options.status,
    p_tick_id: options.tickId,
    p_finalized_egress_upper_bound_bytes: options.finalizedEgressUpperBoundBytes,
    p_accounting_digest: options.accountingDigest,
    p_error_message: options.errorMessage,
    p_finalized_at: new Date().toISOString(),
  })
}

function successfulAccounting(value: unknown): {
  tickId: string
  accountingDigest: string
  egressUpperBoundBytes: number
} | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const downstream = value as JsonObject
  if (downstream.ok !== true || downstream.claimed !== true || downstream.deferred === true) {
    return null
  }
  const revision3 = object(downstream.revision3Accounting, 'revision3Accounting')
  const accounting = object(revision3.accounting, 'revision3 accounting')
  const result = object(accounting.result, 'revision3 accounting result')
  const record = object(revision3.record, 'revision3 accounting record')
  if (record.allowed !== true || result.allowed !== true) {
    throw new Error('successful guarded tick lacks one safe revision-3 accounting result')
  }
  return {
    tickId: requiredString(downstream.tickId, 'downstream tickId'),
    accountingDigest: requiredHex(revision3.digest, 64, 'revision3 accounting digest'),
    egressUpperBoundBytes: requiredInteger(
      result.conservativeTickEgressUpperBoundBytes,
      'revision3 conservative tick egress upper bound',
    ),
  }
}

async function handleCron(body: JsonObject, request: Request): Promise<Response> {
  const key = serviceKey()
  if (request.headers.get('apikey') !== key) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (body.source !== 'pg_cron') {
    return json({ ok: false, error: 'invalid_source' }, 403)
  }

  const scheduledAt = new Date(requiredString(body.scheduled_at, 'scheduled_at'))
  if (!Number.isFinite(scheduledAt.getTime())) {
    return json({ ok: false, error: 'invalid_scheduled_at' }, 400)
  }

  const guard = await rpc<JsonObject>('xrpl_guard_network_steady_session', {
    p_observed_at: scheduledAt.toISOString(),
  })
  if (guard.allowed !== true) {
    return json({
      ok: false,
      halted: true,
      error: 'resource_guard_halt',
      guard,
    }, 409)
  }

  const guarded = guard.guardEnabled === true
  const sessionId = guarded ? requiredString(guard.sessionId, 'guard sessionId') : null
  const attemptId = guarded && sessionId !== null
    ? `r4c3:${sessionId}:${Math.floor(scheduledAt.getTime() / 60_000)}`
    : null
  let attempt: JsonObject | null = null

  if (guarded && sessionId !== null && attemptId !== null) {
    attempt = await rpc<JsonObject>('xrpl_begin_revision3_attempt', {
      p_session_id: sessionId,
      p_attempt_id: attemptId,
      p_scheduled_at: scheduledAt.toISOString(),
      p_started_at: new Date().toISOString(),
    })
    if (attempt.allowed !== true) {
      return json({
        ok: false,
        halted: true,
        error: 'revision3_attempt_reservation_halt',
        guard,
        attempt,
      }, 409)
    }
  }

  try {
    const downstream = await fetch(`${env('SUPABASE_URL')}/functions/v1/xrpl-steady-batch-tick`, {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(55_000),
    })
    const text = await downstream.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text.slice(0, 1_500) }
    }

    let attemptFinalization: JsonObject | null = null
    if (guarded && sessionId !== null && attemptId !== null) {
      const safe = downstream.ok ? successfulAccounting(parsed) : null
      if (safe !== null) {
        attemptFinalization = await finalizeAttempt({
          sessionId,
          attemptId,
          status: 'succeeded',
          tickId: safe.tickId,
          finalizedEgressUpperBoundBytes: safe.egressUpperBoundBytes,
          accountingDigest: safe.accountingDigest,
          errorMessage: null,
        })
      } else {
        const parsedObject = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? parsed as JsonObject
          : null
        const deferred = downstream.ok
          && (parsedObject?.deferred === true || parsedObject?.claimed === false)
        attemptFinalization = await finalizeAttempt({
          sessionId,
          attemptId,
          status: deferred ? 'deferred' : 'failed',
          tickId: null,
          finalizedEgressUpperBoundBytes: null,
          accountingDigest: null,
          errorMessage: String(parsedObject?.error ?? `downstream_status_${downstream.status}`),
        })
      }
    }

    return json({
      guarded: true,
      guard,
      attempt,
      attemptFinalization,
      downstream: parsed,
    }, downstream.status)
  } catch (error) {
    let attemptFinalization: JsonObject | null = null
    if (guarded && sessionId !== null && attemptId !== null) {
      attemptFinalization = await finalizeAttempt({
        sessionId,
        attemptId,
        status: 'failed',
        tickId: null,
        finalizedEgressUpperBoundBytes: null,
        accountingDigest: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      })
    }
    return json({
      ok: false,
      guarded: true,
      guard,
      attempt,
      attemptFinalization,
      error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    }, 500)
  }
}

function verifyQualificationResult(value: JsonObject, guardKind: GuardKind): void {
  if (
    value.guardKind !== guardKind
    || value.halted !== true
    || value.checks === null
  ) {
    throw new Error(`resource guard qualification ${guardKind} did not halt`)
  }
  const counts = object(value.guardedCounts, `${guardKind} guardedCounts`)
  for (const key of ['ticks', 'works', 'messages', 'successors']) {
    if (requiredInteger(counts[key], `${guardKind}.${key}`) !== 0) {
      throw new Error(`resource guard qualification ${guardKind} reserved guarded state`)
    }
  }
  const checks = object(value.checks, `${guardKind} checks`)
  for (const key of [
    'exactGuardIsolated',
    'noTickReserved',
    'noWorkCommitted',
    'noMessageReserved',
    'noSuccessorReserved',
    'activeProfileNonRegressing',
    'activeSourceIdentityPreserved',
  ]) {
    if (checks[key] !== true) {
      throw new Error(`resource guard qualification ${guardKind}.${key} failed`)
    }
  }
}

function verifyRevision3QualificationResult(
  value: JsonObject,
  guardKind: Revision3GuardKind,
): void {
  if (value.guardKind !== guardKind || value.rejected !== true) {
    throw new Error(`revision-3 qualification ${guardKind} did not reject completion`)
  }
  const counts = object(value.guardedCounts, `${guardKind} guardedCounts`)
  for (const key of ['ticks', 'works', 'messages', 'successors']) {
    if (requiredInteger(counts[key], `${guardKind}.${key}`) !== 0) {
      throw new Error(`revision-3 qualification ${guardKind} mutated guarded state`)
    }
  }
  const checks = object(value.checks, `${guardKind} checks`)
  for (const key of [
    'precommitRejected',
    'noCompletedTick',
    'noWorkCommitted',
    'noMessageReserved',
    'noSuccessorReserved',
    'activeProfileReadOnly',
    'exactRevision3Identity',
  ]) {
    if (checks[key] !== true) {
      throw new Error(`revision-3 qualification ${guardKind}.${key} failed`)
    }
  }
}

async function handleQualification(body: JsonObject): Promise<Response> {
  const action = requiredString(body.action, 'action')
  const observedAt = new Date().toISOString()

  if (action === 'read') {
    const snapshot = await rpc<JsonObject>('xrpl_read_resource_guard_snapshot', {
      p_observed_at: observedAt,
    })
    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      action,
      observedAt,
      snapshot,
    })
  }

  if (action === 'record') {
    const snapshot = object(body.snapshot, 'snapshot')
    const result = await rpc<JsonObject>('xrpl_record_external_resource_snapshot', {
      p_snapshot_id: requiredString(snapshot.snapshotId, 'snapshotId').toLowerCase(),
      p_source_run_id: requiredInteger(snapshot.sourceRunId, 'sourceRunId'),
      p_source_commit: requiredHex(snapshot.sourceCommit, 40, 'sourceCommit'),
      p_observed_at: requiredString(snapshot.observedAt, 'observedAt'),
      p_invocation_count_24h: requiredInteger(snapshot.invocationCount24h, 'invocationCount24h'),
      p_projected_invocations_31d: requiredInteger(
        snapshot.projectedInvocations31d,
        'projectedInvocations31d',
      ),
      p_function_count: requiredInteger(snapshot.functionCount, 'functionCount'),
      p_max_bundle_bytes: requiredInteger(snapshot.maxBundleBytes, 'maxBundleBytes'),
      p_max_bundle_name: requiredString(snapshot.maxBundleName, 'maxBundleName'),
      p_bundle_count: requiredInteger(snapshot.bundleCount, 'bundleCount'),
      p_evidence_digest: requiredHex(snapshot.evidenceDigest, 64, 'evidenceDigest'),
    })
    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      action,
      observedAt,
      result,
    })
  }

  if (action === 'prepare_guarded') {
    const sessionId = requiredString(body.sessionId, 'sessionId').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{7,79}$/u.test(sessionId)) {
      return json({ error: 'invalid_session_id' }, 400)
    }
    const prepared = await rpc<JsonObject>('xrpl_prepare_guarded_network_steady_session', {
      p_session_id: sessionId,
      p_prepared_at: observedAt,
    })
    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      action,
      observedAt,
      sessionId,
      prepared,
    })
  }

  if (action === 'qualify') {
    const qualificationId = requiredString(body.qualificationId, 'qualificationId').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{7,49}$/u.test(qualificationId)) {
      return json({ error: 'invalid_qualification_id' }, 400)
    }

    const results: JsonObject[] = []
    for (const guardKind of GUARD_KINDS) {
      const result = await rpc<JsonObject>('xrpl_qualify_resource_guard_fail_closed', {
        p_qualification_id: `${qualificationId}-${guardKind.replace('_', '-')}`,
        p_guard_kind: guardKind,
        p_observed_at: observedAt,
      })
      verifyQualificationResult(result, guardKind)
      results.push(result)
    }

    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      action,
      observedAt,
      qualificationId,
      guardKinds: GUARD_KINDS,
      results,
      checks: {
        allSixGuardsHalted: results.length === GUARD_KINDS.length,
        noGuardedStateReserved: true,
        activeProfileReadOnly: true,
        exactThresholdInjection: true,
        profileSelected: false,
        g8Qualified: false,
      },
    })
  }

  if (action === 'qualify_revision3') {
    const qualificationId = requiredString(body.qualificationId, 'qualificationId').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{7,39}$/u.test(qualificationId)) {
      return json({ error: 'invalid_qualification_id' }, 400)
    }

    const results: JsonObject[] = []
    for (const guardKind of REVISION3_GUARD_KINDS) {
      const result = await rpc<JsonObject>('xrpl_qualify_revision3_accounting_precommit', {
        p_qualification_id: `${qualificationId}-${guardKind.replaceAll('_', '-')}`,
        p_guard_kind: guardKind,
        p_observed_at: observedAt,
      })
      verifyRevision3QualificationResult(result, guardKind)
      results.push(result)
    }

    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      action,
      observedAt,
      qualificationId,
      profileId: 'supabase_free_postgres_pgcron_edge',
      profileRevision: 3,
      profileIdentityDigest:
        '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      guardKinds: REVISION3_GUARD_KINDS,
      results,
      checks: {
        allSevenRevision3GuardsRejected:
          results.length === REVISION3_GUARD_KINDS.length,
        noGuardedStateMutation: true,
        activeProfileReadOnly: true,
        exactRevision3Identity: true,
        unavailableProviderMemoryNotClaimed: true,
        unavailableProviderEgressNotClaimed: true,
        profileSelected: false,
        g8Qualified: false,
      },
    })
  }

  return json({ error: 'invalid_action' }, 400)
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  try {
    const body = object(await request.json(), 'request body')
    if (body.source === 'pg_cron') {
      return await handleCron(body, request)
    }

    if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')) {
      return json({ error: 'unauthorized' }, 401)
    }
    if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
      return json({ error: 'invalid_purpose' }, 403)
    }
    return await handleQualification(body)
  } catch (error) {
    return json({
      schemaVersion: 1,
      purpose: PURPOSE,
      error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    }, 500)
  }
})
