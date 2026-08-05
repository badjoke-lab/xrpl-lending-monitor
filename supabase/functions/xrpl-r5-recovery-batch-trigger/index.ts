const PURPOSE = 'r5-first-active-recovery-batch'
const PURPOSE_HEADER = 'x-xrpl-r5-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-r5-token'
const RECOVERY_RUN_ID = 'r5-recovery-selected-revision3-entry'
const MAX_REQUEST_BYTES = 4 * 1024
const MAX_EXECUTOR_RESPONSE_BYTES = 64 * 1024
const FIXED_FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024
const TEXT_ENCODER = new TextEncoder()

type JsonObject = Record<string, unknown>

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function secretKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as JsonObject
}

function requiredPositiveInteger(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return value
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
): Promise<string> {
  if (!response.body) {
    const text = await response.text()
    if (byteLength(text) > maximumBytes) {
      throw new Error('R5 downstream response exceeds byte limit')
    }
    return text
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maximumBytes) {
        await reader.cancel('R5 downstream response exceeds byte limit')
        throw new Error(`R5 downstream response exceeds byte limit:${total}`)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_R5_RECOVERY_VERIFY_TOKEN')) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
    return json({ error: 'invalid_purpose' }, 403)
  }

  try {
    const body = object(await request.json(), 'request body')
    if (body.source !== 'github_actions') {
      return json({ error: 'invalid_source' }, 403)
    }
    if ((body.run_id ?? RECOVERY_RUN_ID) !== RECOVERY_RUN_ID) {
      return json({ error: 'invalid_run_id' }, 400)
    }
    const mode = body.mode ?? 'execute_batch'
    if (mode !== 'execute_batch' && mode !== 'finalize_boundary') {
      return json({ error: 'invalid_mode' }, 400)
    }

    const key = secretKey()
    let downstreamUrl: string
    let downstreamBody: string
    let resultField: 'executor' | 'finalization'
    if (mode === 'finalize_boundary') {
      const sourceRunId = requiredPositiveInteger(body.source_run_id, 'source_run_id')
      downstreamUrl =
        `${env('SUPABASE_URL')}/rest/v1/rpc/xrpl_finalize_r5_recovery_burst_boundary`
      downstreamBody = JSON.stringify({
        p_run_id: RECOVERY_RUN_ID,
        p_source_run_id: sourceRunId,
        p_owner: `r5-burst-finalize-${sourceRunId}`,
        p_finalized_at: new Date().toISOString(),
      })
      resultField = 'finalization'
    } else {
      downstreamUrl =
        `${env('SUPABASE_URL')}/functions/v1/xrpl-r5-recovery-batch`
      downstreamBody = JSON.stringify({
        source: 'github_actions',
        run_id: RECOVERY_RUN_ID,
      })
      resultField = 'executor'
    }

    const requestBytes = byteLength(downstreamBody)
    if (requestBytes > MAX_REQUEST_BYTES) {
      throw new Error(`R5 downstream request exceeds byte limit:${requestBytes}`)
    }

    const response = await fetch(downstreamUrl, {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: downstreamBody,
      signal: AbortSignal.timeout(70_000),
    })
    const text = await boundedResponseText(response, MAX_EXECUTOR_RESPONSE_BYTES)
    const responseBytes = byteLength(text)
    let result: unknown
    try {
      result = JSON.parse(text)
    } catch {
      result = { raw: text.slice(0, 2_000) }
    }

    return json(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        operationMode: mode,
        [resultField]: result,
        trigger: {
          requestBytes,
          responseBytes,
          maximumRequestBytes: MAX_REQUEST_BYTES,
          maximumExecutorResponseBytes: MAX_EXECUTOR_RESPONSE_BYTES,
          fixedFunctionResponseReserveBytes: FIXED_FUNCTION_RESPONSE_RESERVE_BYTES,
          combinedProxyBytes:
            requestBytes + responseBytes + responseBytes,
          combinedProxyBytesWithinFixedReserve:
            requestBytes + responseBytes + responseBytes
              < FIXED_FUNCTION_RESPONSE_RESERVE_BYTES,
          twoInvocationReservationUsed: true,
          serviceKeyNotReturned: true,
          noLedgerScanInFinalizationMode: mode === 'finalize_boundary',
        },
      },
      response.status,
    )
  } catch (error) {
    return json(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        error: error instanceof Error
          ? error.message.slice(0, 2_000)
          : String(error).slice(0, 2_000),
      },
      500,
    )
  }
})
