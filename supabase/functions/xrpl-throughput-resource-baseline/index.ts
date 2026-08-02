const PURPOSE = 'r4c2d-throughput-resource-baseline'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const PROFILE_ID = 'supabase-devnet'
const WINDOWS = [60, 360, 1440] as const

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

function requireNumber(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function requireHash(value: unknown, name: string): string {
  const hash = requireString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) throw new Error(`${name} must be a canonical hash`)
  return hash
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
    result.profileId !== PROFILE_ID
    || result.network !== 'devnet'
    || result.epochId !== 'supabase-r4c2c-v1'
  ) {
    throw new Error('throughput baseline active identity changed')
  }
  return result
}

async function postRpc<T>(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
): Promise<{ body: T; wallMilliseconds: number; responseBytes: number }> {
  const started = performance.now()
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await result.text()
  const wallMilliseconds = performance.now() - started
  if (!result.ok) {
    throw new Error(`${functionName} failed (${result.status}): ${text.slice(0, 1_000)}`)
  }
  return {
    body: JSON.parse(text) as T,
    wallMilliseconds,
    responseBytes: new TextEncoder().encode(text).byteLength,
  }
}

function verifyMeasurement(value: Json, windowMinutes: number): Json {
  if (
    value.schemaVersion !== 1
    || value.purpose !== PURPOSE
    || value.observedAt === null
  ) {
    throw new Error(`throughput baseline ${windowMinutes} identity is invalid`)
  }

  const profile = requireRecord(value.profile, 'profile')
  if (
    profile.profileId !== PROFILE_ID
    || profile.network !== 'devnet'
    || profile.epochId !== 'supabase-r4c2c-v1'
    || profile.streamStatus !== 'active'
  ) {
    throw new Error(`throughput baseline ${windowMinutes} profile changed`)
  }

  const throughput = requireRecord(value.throughput, 'throughput')
  if (
    throughput.windowMinutes !== windowMinutes
    || throughput.observedMinutes !== windowMinutes
    || throughput.steadyThreshold !== 21
    || throughput.catchUpThreshold !== 30
  ) {
    throw new Error(`throughput baseline ${windowMinutes} window or threshold changed`)
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
    requireNumber(throughput[key], `throughput.${key}`)
  }

  const storage = requireRecord(value.storage, 'storage')
  if (requireNumber(storage.databaseBytes, 'storage.databaseBytes') <= 0) {
    throw new Error('database size is unavailable')
  }
  for (const key of [
    'phaseStreamsBytes',
    'phaseMessagesBytes',
    'phaseSuccessorsBytes',
    'phaseWorkBytes',
    'payloadChunksBytes',
    'referenceRowsBytes',
    'commitChunksBytes',
    'watermarksBytes',
  ]) {
    requireNumber(storage[key], `storage.${key}`)
  }

  const payload = requireRecord(value.payload, 'payload')
  const scheduler = requireRecord(value.scheduler, 'scheduler')
  if (
    payload.configuredCeilingBytes !== 512000
    || payload.maxInsideConfiguredCeiling !== true
    || scheduler.configuredCeilingBytes !== 16000
    || scheduler.maxInsideConfiguredCeiling !== true
  ) {
    throw new Error('configured payload or scheduler ceiling failed')
  }

  const coverage = requireRecord(value.measurementCoverage, 'measurementCoverage')
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
    if (coverage[key] !== true) throw new Error(`baseline coverage ${key} is missing`)
  }
  for (const key of [
    'edgeCpu',
    'edgeMemory',
    'edgeInvocationCount',
    'bandwidth',
    'billingAndOverage',
  ]) {
    if (coverage[key] !== false) throw new Error(`baseline coverage ${key} was overstated`)
  }

  return {
    profile,
    throughput,
    workLatency: value.workLatency,
    phaseAttempts: value.phaseAttempts,
    storage,
    rows: value.rows,
    payload,
    scheduler,
    connections: value.connections,
    runtime: value.runtime,
    measurementCoverage: coverage,
  }
}

function verifyActiveIsolation(before: ActiveWatermark, after: ActiveWatermark): Json {
  if (
    before.profileId !== after.profileId
    || before.network !== after.network
    || before.epochId !== after.epochId
    || before.baseIdentity !== after.baseIdentity
    || after.ledgerIndex < before.ledgerIndex
  ) {
    throw new Error('throughput baseline changed or regressed active source identity')
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

async function execute(): Promise<Json> {
  const supabaseUrl = env('SUPABASE_URL')
  const key = serviceKey()
  const observedAt = new Date().toISOString()
  const activeBefore = await activeWatermark(supabaseUrl, key)
  const measurements: Json[] = []

  for (const windowMinutes of WINDOWS) {
    const result = await postRpc<Json>(
      supabaseUrl,
      key,
      'xrpl_read_throughput_resource_baseline',
      {
        p_observed_at: observedAt,
        p_window_minutes: windowMinutes,
      },
    )
    const verified = verifyMeasurement(result.body, windowMinutes)
    measurements.push({
      windowMinutes,
      rpcWallMilliseconds: Math.round(result.wallMilliseconds * 1000) / 1000,
      rpcResponseBytes: result.responseBytes,
      ...verified,
    })
  }

  const activeAfter = await activeWatermark(supabaseUrl, key)
  const activeIsolation = verifyActiveIsolation(activeBefore, activeAfter)
  const hour = requireRecord(measurements[0]?.throughput, 'hour throughput')
  const sixHours = requireRecord(measurements[1]?.throughput, 'six-hour throughput')
  const day = requireRecord(measurements[2]?.throughput, 'day throughput')

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    profileId: PROFILE_ID,
    observedAt,
    measurements,
    activeWatermarkBefore: activeBefore,
    activeWatermarkAfter: activeAfter,
    activeIsolation,
    baselineDecision: {
      steadyP95Threshold: 21,
      catchUpThreshold: 30,
      oneHourP95: hour.p95LedgersPerMinute,
      sixHourP95: sixHours.p95LedgersPerMinute,
      twentyFourHourP95: day.p95LedgersPerMinute,
      oneHourAverage: hour.averageLedgersPerMinute,
      steadyObservedPass: sixHours.steadyP95Passed === true,
      catchUpModeMeasured: false,
      catchUpPass: false,
      g7Qualified: false,
      g7Reason: 'catch-up mode has not been measured in this baseline',
      g8Qualified: false,
      g8Reason: 'Edge CPU, memory, invocation, bandwidth, and billing coverage remain incomplete',
    },
    checks: {
      activeProfileReadOnly: true,
      activeProfileNonRegressing: true,
      threeWindowsMeasured: measurements.length === 3,
      zeroMinuteBucketsIncluded: true,
      committedEndToEndWorkMeasured: true,
      configuredPayloadCeilingRespected: true,
      configuredSchedulerCeilingRespected: true,
      coverageNotOverstated: true,
      baselineCompleted: true,
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
