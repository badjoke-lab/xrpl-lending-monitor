const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const PROFILE_ID = 'supabase-devnet'

type JsonObject = Record<string, unknown>

type RuntimeRow = {
  profile_id: string
  network: string
  status: string
  lease_owner: string | null
  lease_expires_at: string | null
  last_started_at: string | null
  last_completed_at: string | null
  last_failed_at: string | null
  last_validated_ledger_index: number | null
  last_validated_ledger_hash: string | null
  last_error: string | null
  tick_count: number
  consecutive_failures: number
  updated_at: string
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

async function postRpc<T>(
  supabaseUrl: string,
  secretKey: string,
  functionName: string,
  body: JsonObject,
): Promise<T> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(secretKey),
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${functionName} failed (${response.status}): ${text.slice(0, 500)}`)
  }
  return JSON.parse(text) as T
}

async function readHealth(supabaseUrl: string, secretKey: string): Promise<unknown> {
  const runtimeResponse = await fetch(
    `${supabaseUrl}/rest/v1/xrpl_collector_runtime?profile_id=eq.${PROFILE_ID}&select=profile_id,network,status,lease_expires_at,last_started_at,last_completed_at,last_failed_at,last_validated_ledger_index,last_validated_ledger_hash,last_error,tick_count,consecutive_failures,updated_at`,
    { headers: adminHeaders(secretKey) },
  )
  if (!runtimeResponse.ok) {
    throw new Error(`runtime health read failed (${runtimeResponse.status})`)
  }
  const runtimeRows = (await runtimeResponse.json()) as RuntimeRow[]

  const runsResponse = await fetch(
    `${supabaseUrl}/rest/v1/xrpl_collector_runs?profile_id=eq.${PROFILE_ID}&select=status,source,started_at,completed_at,validated_ledger_index,validated_ledger_hash,error_message&order=completed_at.desc,id.desc&limit=5`,
    { headers: adminHeaders(secretKey) },
  )
  if (!runsResponse.ok) {
    throw new Error(`run health read failed (${runsResponse.status})`)
  }

  return {
    service: 'xrpl-lending-monitor-supabase-probe',
    profileId: PROFILE_ID,
    runtime: runtimeRows[0] ?? null,
    recentRuns: await runsResponse.json(),
    checkedAt: new Date().toISOString(),
  }
}

async function readValidatedLedger(endpoint: string): Promise<{
  index: number
  hash: string
}> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'server_info',
      params: [{ api_version: 2 }],
    }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) {
    throw new Error(`XRPL server_info failed (${response.status})`)
  }

  const payload = (await response.json()) as {
    result?: {
      error?: string
      error_message?: string
      info?: {
        validated_ledger?: {
          seq?: number
          hash?: string
        }
      }
    }
  }
  if (payload.result?.error) {
    throw new Error(
      `XRPL server_info error: ${payload.result.error_message ?? payload.result.error}`,
    )
  }

  const index = payload.result?.info?.validated_ledger?.seq
  const hash = payload.result?.info?.validated_ledger?.hash
  if (!Number.isSafeInteger(index) || !hash?.match(/^[A-F0-9]{64}$/u)) {
    throw new Error('XRPL server_info returned an invalid validated ledger identity')
  }

  return { index: index as number, hash }
}

Deno.serve(async (request) => {
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

  if (request.method === 'GET') {
    try {
      return jsonResponse({ ok: true, ...(await readHealth(supabaseUrl, secretKey) as JsonObject) })
    } catch (error) {
      return jsonResponse(
        { ok: false, error: error instanceof Error ? error.message : String(error) },
        503,
      )
    }
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405)
  }

  if (request.headers.get('apikey') !== secretKey) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401)
  }

  const startedAt = new Date()
  const owner = Deno.env.get('SB_EXECUTION_ID') ?? crypto.randomUUID()
  const invocationId = Deno.env.get('DENO_DEPLOYMENT_ID')
    ? `${Deno.env.get('DENO_DEPLOYMENT_ID')}:${owner}`
    : owner
  let source = 'remote'
  try {
    const body = (await request.json()) as { source?: unknown }
    if (typeof body.source === 'string' && /^[a-z0-9_-]{1,50}$/u.test(body.source)) {
      source = body.source
    }
  } catch {
    source = 'remote'
  }

  try {
    const claim = await postRpc<{
      claimed: boolean
      reason?: string
      lease_expires_at?: string
      tick_count?: number
    }>(supabaseUrl, secretKey, 'xrpl_claim_collector_tick', {
      p_owner: owner,
      p_now: startedAt.toISOString(),
      p_lease_seconds: 45,
    })

    if (!claim.claimed) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: claim.reason ?? 'not_claimed',
        leaseExpiresAt: claim.lease_expires_at ?? null,
      }, 202)
    }

    const ledger = await readValidatedLedger(
      Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL,
    )
    const completedAt = new Date()
    const completion = await postRpc<{
      completed: boolean
      reason?: string
      tick_count?: number
    }>(supabaseUrl, secretKey, 'xrpl_complete_collector_tick', {
      p_owner: owner,
      p_invocation_id: invocationId,
      p_source: source,
      p_started_at: startedAt.toISOString(),
      p_completed_at: completedAt.toISOString(),
      p_ledger_index: ledger.index,
      p_ledger_hash: ledger.hash,
    })

    if (!completion.completed) {
      throw new Error(`collector completion rejected: ${completion.reason ?? 'unknown'}`)
    }

    return jsonResponse({
      ok: true,
      skipped: false,
      source,
      ledgerIndex: ledger.index,
      ledgerHash: ledger.hash,
      tickCount: completion.tick_count ?? null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    })
  } catch (error) {
    const failedAt = new Date()
    const message = error instanceof Error ? error.message : String(error)
    try {
      await postRpc(supabaseUrl, secretKey, 'xrpl_fail_collector_tick', {
        p_owner: owner,
        p_invocation_id: invocationId,
        p_source: source,
        p_started_at: startedAt.toISOString(),
        p_failed_at: failedAt.toISOString(),
        p_error: message,
      })
    } catch {
      // The original failure remains authoritative. A lost lease is reported in health state.
    }
    return jsonResponse({ ok: false, error: message, failedAt: failedAt.toISOString() }, 502)
  }
})
