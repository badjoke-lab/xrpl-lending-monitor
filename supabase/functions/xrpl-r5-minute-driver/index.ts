const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const RECOVERY_RUN_ID = 'r5-recovery-selected-revision4-entry'
const RECOVERY_FUNCTION = 'xrpl-r5-recovery-batch'
const STEADY_BATCHES_PER_MINUTE = 2
const MAX_BATCHES_PER_MINUTE = 3
const BATCH_LEDGER_CAP = 12
const MAX_DRIVER_ELAPSED_BEFORE_EXTRA_BATCH_MS = 90_000
const DOWNSTREAM_TIMEOUT_MS = 60_000

type JsonObject = Record<string, unknown>

type Head = {
  index: number
  hash: string
}

type RefreshResult = {
  refreshed?: boolean
  reason?: string
  status?: string
  workAvailable?: boolean
  watermarkLedgerIndex?: number
  validatedHeadLedgerIndex?: number
  lagLedgers?: number
  [key: string]: unknown
}

type BatchResult = {
  ok?: boolean
  claimed?: boolean
  reason?: string
  runId?: string
  batchId?: string
  ledgerCount?: number
  startLedgerIndex?: number
  endLedgerIndex?: number
  completionAcknowledged?: boolean
  activeMutationCommitted?: boolean
  [key: string]: unknown
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function getRequiredEnvironment(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function getSecretKey(): string {
  const secretKeys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (secretKeys) {
    const parsed = JSON.parse(secretKeys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return getRequiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
}

function adminHeaders(secretKey: string): HeadersInit {
  return {
    apikey: secretKey,
    authorization: `Bearer ${secretKey}`,
    'content-type': 'application/json',
  }
}

function integer(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function hash(value: unknown, name: string): string {
  if (typeof value !== 'string' || !/^[A-Fa-f0-9]{64}$/u.test(value)) {
    throw new Error(`${name} must be a 64-character hex hash`)
  }
  return value.toUpperCase()
}

async function postJson<T>(url: string, headers: HeadersInit, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
  })
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response from ${url}: ${text.slice(0, 300)}`)
  }
  if (!response.ok) {
    throw new Error(`request failed ${response.status} for ${url}: ${text.slice(0, 500)}`)
  }
  return parsed as T
}

async function readValidatedHead(endpoint: string): Promise<Head> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'server_info',
      params: [{ api_version: 2 }],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`XRPL server_info failed (${response.status})`)
  const payload = await response.json() as {
    result?: { info?: { validated_ledger?: { seq?: unknown; hash?: unknown } } }
  }
  const validated = payload.result?.info?.validated_ledger
  return {
    index: integer(validated?.seq, 'validated ledger sequence'),
    hash: hash(validated?.hash, 'validated ledger hash'),
  }
}

async function refreshContinuousHead(options: {
  supabaseUrl: string
  secretKey: string
  head: Head
  refreshedAt: string
}): Promise<RefreshResult> {
  return postJson<RefreshResult>(
    `${options.supabaseUrl}/rest/v1/rpc/xrpl_refresh_r5_revision4_continuous_head`,
    adminHeaders(options.secretKey),
    {
      p_run_id: RECOVERY_RUN_ID,
      p_validated_head_ledger_index: options.head.index,
      p_validated_head_ledger_hash: options.head.hash,
      p_refreshed_at: options.refreshedAt,
    },
  )
}

async function executeRecoveryBatch(options: {
  supabaseUrl: string
  secretKey: string
  minuteExecutionId: string
  ordinal: number
}): Promise<BatchResult> {
  // The active R5 executor currently names its privileged caller mode
  // `github_actions`. The outer minute driver retains the actual pg_cron
  // provenance here and passes the legacy executor-mode token only for the
  // existing executor authorization contract. No qualification bypass is set.
  return postJson<BatchResult>(
    `${options.supabaseUrl}/functions/v1/${RECOVERY_FUNCTION}`,
    adminHeaders(options.secretKey),
    {
      source: 'github_actions',
      run_id: RECOVERY_RUN_ID,
      scheduler_source: 'pg_cron',
      minute_execution_id: options.minuteExecutionId,
      minute_batch_ordinal: options.ordinal,
      qualification_override: false,
    },
  )
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  let supabaseUrl: string
  let secretKey: string
  try {
    supabaseUrl = getRequiredEnvironment('SUPABASE_URL')
    secretKey = getSecretKey()
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    )
  }

  if (request.headers.get('apikey') !== secretKey) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  let body: { source?: unknown; scheduled_at?: unknown } = {}
  try {
    body = await request.json() as { source?: unknown; scheduled_at?: unknown }
  } catch {
    body = {}
  }
  if (body.source !== 'pg_cron' && body.source !== 'manual_smoke') {
    return jsonResponse({ ok: false, error: 'invalid_source' }, 400)
  }

  const startedAt = new Date()
  const minuteExecutionId = Deno.env.get('SB_EXECUTION_ID') ?? crypto.randomUUID()
  const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL

  try {
    const head = await readValidatedHead(endpoint)
    const refresh = await refreshContinuousHead({
      supabaseUrl,
      secretKey,
      head,
      refreshedAt: startedAt.toISOString(),
    })

    if (refresh.refreshed !== true) {
      return jsonResponse({
        ok: true,
        source: body.source,
        minuteExecutionId,
        head,
        refresh,
        batchesAttempted: 0,
        batchesCommitted: 0,
        ledgersCommitted: 0,
        stopped: true,
        stopReason: refresh.reason ?? 'continuous_head_not_refreshed',
      }, 202)
    }

    if (refresh.workAvailable === false) {
      return jsonResponse({
        ok: true,
        source: body.source,
        minuteExecutionId,
        head,
        refresh,
        batchesAttempted: 0,
        batchesCommitted: 0,
        ledgersCommitted: 0,
        finalLagLedgers: 0,
        stopped: false,
        stopReason: 'already_at_fresh_head',
      })
    }

    const batchResults: BatchResult[] = []
    let ledgersCommitted = 0
    let finalWatermark = integer(refresh.watermarkLedgerIndex, 'refresh.watermarkLedgerIndex')
    let stopReason = 'minute_batch_budget_exhausted'

    for (let ordinal = 1; ordinal <= MAX_BATCHES_PER_MINUTE; ordinal += 1) {
      if (
        ordinal > STEADY_BATCHES_PER_MINUTE
        && Date.now() - startedAt.getTime() >= MAX_DRIVER_ELAPSED_BEFORE_EXTRA_BATCH_MS
      ) {
        stopReason = 'driver_wall_time_guard_before_catchup_batch'
        break
      }

      const result = await executeRecoveryBatch({
        supabaseUrl,
        secretKey,
        minuteExecutionId,
        ordinal,
      })
      batchResults.push(result)

      if (result.ok !== true) {
        throw new Error(`R5 batch ${ordinal} returned ok != true`)
      }
      if (result.claimed !== true) {
        stopReason = result.reason ?? 'batch_not_claimed'
        break
      }
      if (result.runId !== RECOVERY_RUN_ID) {
        throw new Error(`R5 batch ${ordinal} run identity mismatch`)
      }

      const ledgerCount = integer(result.ledgerCount, `batch ${ordinal} ledgerCount`)
      const startLedgerIndex = integer(result.startLedgerIndex, `batch ${ordinal} startLedgerIndex`)
      const endLedgerIndex = integer(result.endLedgerIndex, `batch ${ordinal} endLedgerIndex`)
      if (
        ledgerCount < 1
        || ledgerCount > BATCH_LEDGER_CAP
        || endLedgerIndex !== startLedgerIndex + ledgerCount - 1
      ) {
        throw new Error(`R5 batch ${ordinal} ledger boundary invalid`)
      }
      if (result.completionAcknowledged !== true || result.activeMutationCommitted !== true) {
        throw new Error(`R5 batch ${ordinal} did not acknowledge atomic completion`)
      }

      ledgersCommitted += ledgerCount
      finalWatermark = endLedgerIndex

      if (finalWatermark >= head.index) {
        stopReason = 'caught_up_to_minute_head'
        break
      }

      // Two claims per minute are the steady 24-ledger/minute target. A third
      // claim is used only when lag remains after those two claims.
      if (ordinal === STEADY_BATCHES_PER_MINUTE && head.index - finalWatermark <= 0) {
        stopReason = 'steady_target_caught_up'
        break
      }
    }

    return jsonResponse({
      ok: true,
      source: body.source,
      scheduledAt: typeof body.scheduled_at === 'string' ? body.scheduled_at : null,
      minuteExecutionId,
      runId: RECOVERY_RUN_ID,
      head,
      refresh,
      steadyBatchTarget: STEADY_BATCHES_PER_MINUTE,
      catchupBatchCap: MAX_BATCHES_PER_MINUTE,
      batchLedgerCap: BATCH_LEDGER_CAP,
      batchesAttempted: batchResults.length,
      batchesCommitted: batchResults.filter((result) => result.claimed === true).length,
      ledgersCommitted,
      finalWatermarkLedgerIndex: finalWatermark,
      finalLagLedgers: Math.max(0, head.index - finalWatermark),
      stopReason,
      batchResults,
      publicReaderMutationOnlyThroughR5AtomicCompletion: true,
      mainnetDisabled: true,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    })
  } catch (error) {
    return jsonResponse({
      ok: false,
      source: body.source,
      minuteExecutionId,
      error: error instanceof Error ? error.message : String(error),
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
    }, 503)
  }
})
