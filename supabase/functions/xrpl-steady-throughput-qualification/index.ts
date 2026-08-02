const PURPOSE = 'r4c2d-network-steady-throughput'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'

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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

async function rpc<T>(functionName: string, body: JsonObject): Promise<T> {
  const key = secretKey()
  const response = await fetch(`${env('SUPABASE_URL')}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${functionName} failed (${response.status}): ${text.slice(0, 1_000)}`)
  }
  return JSON.parse(text) as T
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')) {
    return json({ error: 'unauthorized' }, 401)
  }
  if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
    return json({ error: 'invalid_purpose' }, 403)
  }

  try {
    const body = object(await request.json(), 'request body')
    const action = requiredString(body.action, 'action')
    const sessionId = requiredString(body.sessionId, 'sessionId').toLowerCase()
    if (!/^[a-z0-9][a-z0-9-]{7,79}$/.test(sessionId)) {
      return json({ error: 'invalid_session_id' }, 400)
    }

    if (action === 'prepare') {
      const prepared = await rpc<JsonObject>('xrpl_prepare_network_steady_session', {
        p_session_id: sessionId,
        p_prepared_at: new Date().toISOString(),
      })
      return json({
        schemaVersion: 1,
        purpose: PURPOSE,
        action,
        sessionId,
        prepared,
        checkedAt: new Date().toISOString(),
      })
    }

    if (action === 'read') {
      const session = await rpc<JsonObject>('xrpl_read_network_steady_session', {
        p_session_id: sessionId,
      })
      return json({
        schemaVersion: 1,
        purpose: PURPOSE,
        action,
        sessionId,
        session,
        checkedAt: new Date().toISOString(),
      })
    }

    return json({ error: 'invalid_action' }, 400)
  } catch (error) {
    return json(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      },
      500,
    )
  }
})
