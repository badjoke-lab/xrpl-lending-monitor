const CURRENT_FUNCTION = 'xrpl-current-first-batch'
const STEADY_BATCHES_PER_MINUTE = 2
const MAX_BATCHES_PER_MINUTE = 3
const DOWNSTREAM_TIMEOUT_MS = 60_000

type BatchResult = {
  ok?: boolean
  claimed?: boolean
  reason?: string
  head?: { index?: unknown; hash?: unknown }
  startLedgerIndex?: unknown
  endLedgerIndex?: unknown
  ledgerCount?: unknown
  currentWatermarkAdvanced?: boolean
  historyWatermarkAdvanced?: boolean
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

async function executeBatch(options: {
  supabaseUrl: string
  secretKey: string
}): Promise<BatchResult> {
  const response = await fetch(
    `${options.supabaseUrl}/functions/v1/${CURRENT_FUNCTION}`,
    {
      method: 'POST',
      headers: adminHeaders(options.secretKey),
      body: JSON.stringify({ source: 'pg_cron' }),
      signal: AbortSignal.timeout(DOWNSTREAM_TIMEOUT_MS),
    },
  )
  const text = await response.text()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`current-first batch returned non-JSON: ${text.slice(0, 300)}`)
  }
  if (!response.ok) {
    throw new Error(`current-first batch failed (${response.status}): ${text.slice(0, 500)}`)
  }
  return parsed as BatchResult
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

  let body: { source?: unknown; scheduled_at?: unknown }
  try {
    body = await request.json() as { source?: unknown; scheduled_at?: unknown }
  } catch {
    body = {}
  }
  if (body.source !== 'pg_cron' && body.source !== 'manual_smoke') {
    return jsonResponse({ ok: false, error: 'invalid_source' }, 400)
  }

  const startedAt = new Date()
  const results: BatchResult[] = []
  let ledgersCommitted = 0
  let finalLagLedgers: number | null = null
  let stopReason = 'minute_batch_budget_exhausted'

  try {
    for (let ordinal = 1; ordinal <= MAX_BATCHES_PER_MINUTE; ordinal += 1) {
      const result = await executeBatch({ supabaseUrl, secretKey })
      results.push(result)
      if (result.ok !== true) {
        throw new Error(`current-first batch ${ordinal} returned ok != true`)
      }
      if (result.historyWatermarkAdvanced === true) {
        throw new Error(`current-first batch ${ordinal} advanced the history watermark`)
      }
      if (result.claimed !== true) {
        stopReason = result.reason ?? 'batch_not_claimed'
        break
      }
      if (result.currentWatermarkAdvanced !== true) {
        throw new Error(`current-first batch ${ordinal} did not advance current watermark`)
      }

      const ledgerCount = integer(result.ledgerCount, `batch ${ordinal} ledgerCount`)
      const endLedgerIndex = integer(result.endLedgerIndex, `batch ${ordinal} endLedgerIndex`)
      const headLedgerIndex = integer(result.head?.index, `batch ${ordinal} head.index`)
      if (ledgerCount < 1 || ledgerCount > 12 || endLedgerIndex > headLedgerIndex) {
        throw new Error(`current-first batch ${ordinal} boundary invalid`)
      }
      ledgersCommitted += ledgerCount
      finalLagLedgers = Math.max(0, headLedgerIndex - endLedgerIndex)

      if (finalLagLedgers === 0) {
        stopReason = 'caught_up_to_batch_head'
        break
      }
      if (ordinal === STEADY_BATCHES_PER_MINUTE && finalLagLedgers <= 0) {
        stopReason = 'steady_target_caught_up'
        break
      }
    }

    return jsonResponse({
      ok: true,
      source: body.source,
      scheduledAt: typeof body.scheduled_at === 'string' ? body.scheduled_at : null,
      steadyBatchTarget: STEADY_BATCHES_PER_MINUTE,
      catchupBatchCap: MAX_BATCHES_PER_MINUTE,
      batchesAttempted: results.length,
      batchesCommitted: results.filter((result) => result.claimed === true).length,
      ledgersCommitted,
      finalLagLedgers,
      stopReason,
      results,
      currentOnly: true,
      historyWatermarkAdvanced: false,
      mainnetDisabled: true,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    })
  } catch (error) {
    return jsonResponse({
      ok: false,
      source: body.source,
      error: error instanceof Error ? error.message : String(error),
      results,
      historyWatermarkAdvanced: false,
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
    }, 503)
  }
})
