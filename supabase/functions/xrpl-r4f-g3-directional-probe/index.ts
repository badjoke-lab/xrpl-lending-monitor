import {
  buildSupabaseRevision4G3ReadonlyProbeResponse,
  sha256HexBytes,
  SUPABASE_REVISION4_G3_PROBE_MAX_XRPL_RESPONSE_BYTES,
  SUPABASE_REVISION4_G3_PROBE_PURPOSE,
} from '../../../src/shared/supabase-revision4-g3-readonly-probe.ts'

const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const DEVNET_RPC = 'https://s.devnet.rippletest.net:51234/'
const CONTENT_TYPE = 'application/json; charset=utf-8'

type JsonObject = Record<string, unknown>

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': CONTENT_TYPE,
      'cache-control': 'no-store',
    },
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function record(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as JsonObject
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

function sourceCommit(): string {
  const value = env('R4F_G3_PROBE_SOURCE_COMMIT')
  if (!/^[a-f0-9]{40}$/u.test(value)) {
    throw new Error('R4F_G3_PROBE_SOURCE_COMMIT must be an exact lowercase SHA')
  }
  return value
}

function returnedLedgerIndex(result: JsonObject): number | null {
  const direct = result.ledger_index
  if (typeof direct === 'number' && Number.isSafeInteger(direct)) return direct
  if (typeof direct === 'string' && /^\d+$/u.test(direct)) return Number(direct)

  const ledger = result.ledger
  if (typeof ledger === 'object' && ledger !== null && !Array.isArray(ledger)) {
    const nested = (ledger as JsonObject).ledger_index
    if (typeof nested === 'number' && Number.isSafeInteger(nested)) return nested
    if (typeof nested === 'string' && /^\d+$/u.test(nested)) return Number(nested)
  }
  return null
}

async function execute(rawRequestBody: string): Promise<Response> {
  const body = record(JSON.parse(rawRequestBody), 'request body')
  const ledgerIndex = positiveInteger(body.ledgerIndex, 'ledgerIndex')
  const observationId = stringValue(body.observationId, 'observationId')
  const attemptId = stringValue(body.attemptId, 'attemptId')
  const sourceRunId = positiveInteger(body.sourceRunId, 'sourceRunId')
  const observedAt = new Date().toISOString()

  const xrplRequestBody = JSON.stringify({
    method: 'ledger',
    params: [
      {
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
        api_version: 1,
      },
    ],
  })
  const xrplResponse = await fetch(DEVNET_RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: xrplRequestBody,
    signal: AbortSignal.timeout(30_000),
  })
  const xrplResponseBody = await xrplResponse.text()
  const xrplResponseBytes = new TextEncoder().encode(xrplResponseBody).byteLength
  if (!xrplResponse.ok) {
    throw new Error(
      `XRPL Devnet read failed (${xrplResponse.status}): ${xrplResponseBody.slice(0, 500)}`,
    )
  }
  if (
    xrplResponseBytes <= 0
    || xrplResponseBytes > SUPABASE_REVISION4_G3_PROBE_MAX_XRPL_RESPONSE_BYTES
  ) {
    throw new Error('XRPL Devnet response is outside the bounded probe size')
  }

  const parsed = record(JSON.parse(xrplResponseBody), 'XRPL response')
  const result = record(parsed.result, 'XRPL result')
  if (result.validated !== true) {
    throw new Error('XRPL probe ledger is not validated')
  }
  if (returnedLedgerIndex(result) !== ledgerIndex) {
    throw new Error('XRPL probe ledger identity mismatch')
  }

  const xrplResponseDigest = await sha256HexBytes(xrplResponseBody)
  const built = await buildSupabaseRevision4G3ReadonlyProbeResponse({
    observationId,
    attemptId,
    observedAt,
    sourceCommit: sourceCommit(),
    sourceRunId,
    ledgerIndex,
    invokerRequestBody: rawRequestBody,
    xrplRequestBody,
    xrplResponseBody,
    xrplResponseDigest,
  })

  return new Response(built.responseBody, {
    status: 200,
    headers: {
      'content-type': CONTENT_TYPE,
      'cache-control': 'no-store',
    },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (request.headers.get(PURPOSE_HEADER) !== SUPABASE_REVISION4_G3_PROBE_PURPOSE) {
    return json({ error: 'invalid_purpose' }, 403)
  }
  if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('R4F_G3_PROBE_VERIFY_TOKEN')) {
    return json({ error: 'unauthorized' }, 401)
  }

  try {
    return await execute(await request.text())
  } catch (error) {
    return json(
      {
        schemaVersion: 1,
        purpose: SUPABASE_REVISION4_G3_PROBE_PURPOSE,
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
        checks: {
          databaseRequestIssued: false,
          recoveryMutationCommitted: false,
          publicReaderUnchanged: true,
          mainnetDisabled: true,
          stabilizationAuthorized: false,
          soakAuthorized: false,
        },
      },
      500,
    )
  }
})
