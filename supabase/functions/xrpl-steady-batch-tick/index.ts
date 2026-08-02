import { isLendingTransactionType } from '../../../src/collector/incremental/lending-transaction-types.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../../../src/collector/incremental/read-validated-ledger.ts'
import type { IncrementalScanResult } from '../../../src/collector/incremental/scan-validated-ledgers.ts'
import { buildPortableCollectorWorkId } from '../../../src/shared/portable-collector-planner.ts'
import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store.ts'
import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from '../../../src/collector/history-segments/portable-xrpl-normalization.ts'

const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const BATCH_SIZE = 24
const FETCH_CONCURRENCY = 6
const LEASE_SECONDS = 55

type JsonObject = Record<string, unknown>

type TickClaim = {
  claimed: boolean
  reason?: string
  sessionId?: string
  tickId?: string
  tickSequence?: number
  scheduledMinute?: string
  startLedgerIndex?: number
  endLedgerIndex?: number
  expectedParentHash?: string
  baseIdentity?: string
  network?: string
  epochId?: string
  batchSize?: number
}

class TickError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TickError'
  }
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new TickError(`Missing ${name}`)
  return value
}

function getSecretKey(): string {
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
    throw new TickError(`${name} must be an object`)
  }
  return value as JsonObject
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TickError(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new TickError(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function requiredHash(value: unknown, name: string): string {
  const hash = requiredString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) {
    throw new TickError(`${name} must be a canonical 64-character hash`)
  }
  return hash
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function stripSha256Prefix(value: string, name: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new TickError(`${name} has an invalid SHA-256 digest`)
  }
  return value.slice('sha256:'.length)
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
    signal: AbortSignal.timeout(55_000),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new TickError(`${functionName} failed (${response.status}): ${text.slice(0, 1_000)}`)
  }
  return JSON.parse(text) as T
}

async function xrplRpc(
  endpoint: string,
  method: string,
  params: JsonObject,
): Promise<JsonObject> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [{ ...params, api_version: 2 }] }),
    signal: AbortSignal.timeout(12_000),
  })
  if (!response.ok) throw new TickError(`XRPL ${method} failed (${response.status})`)
  const payload = (await response.json()) as { result?: JsonObject }
  if (!payload.result) throw new TickError(`XRPL ${method} returned no result`)
  if (typeof payload.result.error === 'string') {
    throw new TickError(
      `XRPL ${method} error: ${String(payload.result.error_message ?? payload.result.error)}`,
    )
  }
  return payload.result
}

async function readValidatedHead(endpoint: string): Promise<{ index: number; hash: string }> {
  const result = await xrplRpc(endpoint, 'server_info', {})
  const info = object(result.info, 'server info')
  const validated = object(info.validated_ledger, 'validated ledger')
  return {
    index: requiredInteger(validated.seq, 'validated ledger sequence'),
    hash: requiredHash(validated.hash, 'validated ledger hash'),
  }
}

async function readExactLedger(
  endpoint: string,
  ledgerIndex: number,
): Promise<ValidatedLedgerRead> {
  const result = await xrplRpc(endpoint, 'ledger', {
    ledger_index: ledgerIndex,
    transactions: true,
    expand: true,
    owner_funds: false,
  })
  try {
    const parsed = parseValidatedLedgerResult({
      endpoint,
      requestedLedgerIndex: ledgerIndex,
      result,
    })
    return {
      ...parsed,
      ledgerHash: parsed.ledgerHash.toUpperCase(),
      parentHash: parsed.parentHash.toUpperCase(),
      transactions: parsed.transactions.map((transaction) => ({
        ...transaction,
        hash: transaction.hash.toUpperCase(),
      })),
    }
  } catch (error) {
    throw new TickError(
      `expanded ledger ${ledgerIndex} is invalid: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function oneLedgerScan(endpoint: string, ledger: ValidatedLedgerRead): IncrementalScanResult {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint,
    startLedgerIndex: ledger.ledgerIndex,
    endLedgerIndex: ledger.ledgerIndex,
    latestValidatedLedger: ledger.ledgerIndex,
    completeToLatest: true,
    ledgers: [{ ...ledger, lendingTransactions }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: lendingTransactions.length,
      elapsedMs: 0,
    },
  }
}

async function mapLimit<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      if (index >= values.length) return
      results[index] = await operation(values[index]!, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()))
  return results
}

function validateClaim(raw: TickClaim): Required<Omit<TickClaim, 'reason'>> {
  if (!raw.claimed) throw new TickError('steady tick claim is not claimed')
  const claim = {
    claimed: true as const,
    sessionId: requiredString(raw.sessionId, 'sessionId'),
    tickId: requiredString(raw.tickId, 'tickId'),
    tickSequence: requiredInteger(raw.tickSequence, 'tickSequence'),
    scheduledMinute: requiredString(raw.scheduledMinute, 'scheduledMinute'),
    startLedgerIndex: requiredInteger(raw.startLedgerIndex, 'startLedgerIndex'),
    endLedgerIndex: requiredInteger(raw.endLedgerIndex, 'endLedgerIndex'),
    expectedParentHash: requiredHash(raw.expectedParentHash, 'expectedParentHash'),
    baseIdentity: requiredString(raw.baseIdentity, 'baseIdentity'),
    network: requiredString(raw.network, 'network'),
    epochId: requiredString(raw.epochId, 'epochId'),
    batchSize: requiredInteger(raw.batchSize, 'batchSize'),
  }
  if (
    claim.network !== 'devnet'
    || claim.epochId !== 'supabase-r4c2c-v1'
    || claim.batchSize !== BATCH_SIZE
    || claim.endLedgerIndex !== claim.startLedgerIndex + BATCH_SIZE - 1
  ) {
    throw new TickError('steady tick claim identity changed')
  }
  return claim
}

async function buildWork(options: {
  endpoint: string
  claim: ReturnType<typeof validateClaim>
  ledger: ValidatedLedgerRead
  previousLedgerIndex: number
  expectedParentHash: string
}): Promise<JsonObject> {
  const workId = buildPortableCollectorWorkId({
    network: options.claim.network,
    epochId: options.claim.epochId,
    baseIdentity: options.claim.baseIdentity,
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
  })
  const normalized = await buildPortableXrplNormalizedWork({
    scan: oneLedgerScan(options.endpoint, options.ledger),
    workId,
    network: options.claim.network,
    epochId: options.claim.epochId,
    baseIdentity: options.claim.baseIdentity,
    previousLedgerIndex: options.previousLedgerIndex,
    expectedParentHash: options.expectedParentHash,
  })
  const chunks = await Promise.all(
    normalized.chunks.map(async (built) => {
      const referenceRowsJson = canonicalPortableJson(
        portableReferenceRowsFromChunk(built.chunk),
      )
      return {
        chunkIndex: built.chunk.chunkIndex,
        totalChunks: built.chunk.totalChunks,
        payloadJson: built.encodedJson,
        chunkDigest: stripSha256Prefix(built.chunk.chunkDigest, 'chunkDigest'),
        encodedDigest: await sha256Hex(built.encodedJson),
        byteCount: new TextEncoder().encode(built.encodedJson).byteLength,
        recordCount: built.chunk.records.length,
        referenceRowsJson,
        referenceRowsDigest: await sha256Hex(referenceRowsJson),
      }
    }),
  )
  return {
    workId,
    previousLedgerIndex: options.previousLedgerIndex,
    startLedgerIndex: options.ledger.ledgerIndex,
    scannedEndLedgerIndex: options.ledger.ledgerIndex,
    expectedParentHash: options.expectedParentHash,
    finalLedgerHash: options.ledger.ledgerHash,
    planJson: canonicalPortableJson({
      schemaVersion: 1,
      network: options.claim.network,
      epochId: options.claim.epochId,
      baseIdentity: options.claim.baseIdentity,
      previousLedgerIndex: options.previousLedgerIndex,
      expectedParentHash: options.expectedParentHash,
      plannedEndLedgerIndex: options.ledger.ledgerIndex,
    }),
    semanticCountsJson: normalized.semanticCountsJson,
    payloadDigest: stripSha256Prefix(normalized.payload.digest, 'payloadDigest'),
    chunks,
  }
}

Deno.serve(async (request) => {
  const wallStarted = performance.now()
  let supabaseUrl: string
  let secretKey: string
  try {
    supabaseUrl = env('SUPABASE_URL')
    secretKey = getSecretKey()
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
  }

  if (request.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)
  if (request.headers.get('apikey') !== secretKey) {
    return json({ ok: false, error: 'unauthorized' }, 401)
  }

  let claim: ReturnType<typeof validateClaim> | null = null
  const owner = `steady-${crypto.randomUUID()}`
  try {
    const body = object(await request.json(), 'request body')
    if (body.source !== 'pg_cron') return json({ ok: false, error: 'invalid_source' }, 403)
    const scheduledAt = new Date(requiredString(body.scheduled_at, 'scheduled_at'))
    if (!Number.isFinite(scheduledAt.getTime())) {
      return json({ ok: false, error: 'invalid_scheduled_at' }, 400)
    }

    const rawClaim = await postRpc<TickClaim>(
      supabaseUrl,
      secretKey,
      'xrpl_claim_network_steady_tick',
      {
        p_owner: owner,
        p_scheduled_at: scheduledAt.toISOString(),
        p_now: new Date().toISOString(),
        p_lease_seconds: LEASE_SECONDS,
      },
    )
    if (!rawClaim.claimed) {
      return json({ ok: true, claimed: false, reason: rawClaim.reason ?? 'not_claimed' })
    }
    claim = validateClaim(rawClaim)

    const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL
    const head = await readValidatedHead(endpoint)
    if (head.index < claim.endLedgerIndex) {
      await postRpc<JsonObject>(
        supabaseUrl,
        secretKey,
        'xrpl_defer_network_steady_tick',
        {
          p_owner: owner,
          p_tick_id: claim.tickId,
          p_deferred_at: new Date().toISOString(),
          p_reason: `validated head ${head.index} is below reserved end ${claim.endLedgerIndex}`,
        },
      )
      return json({
        ok: true,
        claimed: true,
        deferred: true,
        headLedgerIndex: head.index,
        requiredEndLedgerIndex: claim.endLedgerIndex,
      })
    }

    const fetchStarted = performance.now()
    const indexes = Array.from(
      { length: BATCH_SIZE },
      (_, index) => claim!.startLedgerIndex + index,
    )
    const ledgers = await mapLimit(
      indexes,
      FETCH_CONCURRENCY,
      (ledgerIndex) => readExactLedger(endpoint, ledgerIndex),
    )
    const fetchMilliseconds = performance.now() - fetchStarted

    let expectedParentHash = claim.expectedParentHash
    for (const [index, ledger] of ledgers.entries()) {
      const expectedIndex = claim.startLedgerIndex + index
      if (ledger.ledgerIndex !== expectedIndex || ledger.parentHash !== expectedParentHash) {
        throw new TickError(`steady ledger continuity failed at ${expectedIndex}`)
      }
      expectedParentHash = ledger.ledgerHash
    }

    const normalizeStarted = performance.now()
    const works: JsonObject[] = []
    let previousLedgerIndex = claim.startLedgerIndex - 1
    expectedParentHash = claim.expectedParentHash
    for (const ledger of ledgers) {
      works.push(await buildWork({
        endpoint,
        claim,
        ledger,
        previousLedgerIndex,
        expectedParentHash,
      }))
      previousLedgerIndex = ledger.ledgerIndex
      expectedParentHash = ledger.ledgerHash
    }
    const normalizeMilliseconds = performance.now() - normalizeStarted
    const worksJson = canonicalPortableJson(works)
    const worksDigest = await sha256Hex(worksJson)
    const edgeWallMilliseconds = performance.now() - wallStarted

    const completion = await postRpc<JsonObject>(
      supabaseUrl,
      secretKey,
      'xrpl_complete_network_steady_tick',
      {
        p_owner: owner,
        p_tick_id: claim.tickId,
        p_completed_at: new Date().toISOString(),
        p_works_json: worksJson,
        p_works_digest: worksDigest,
        p_fetch_milliseconds: fetchMilliseconds,
        p_normalize_milliseconds: normalizeMilliseconds,
        p_edge_wall_milliseconds: edgeWallMilliseconds,
      },
    )

    return json({
      ok: true,
      claimed: true,
      sessionId: claim.sessionId,
      tickId: claim.tickId,
      tickSequence: claim.tickSequence,
      startLedgerIndex: claim.startLedgerIndex,
      endLedgerIndex: claim.endLedgerIndex,
      validatedHead: head,
      fetchMilliseconds,
      normalizeMilliseconds,
      edgeWallMilliseconds,
      worksDigest,
      completion,
    })
  } catch (error) {
    if (claim !== null) {
      try {
        await postRpc<JsonObject>(
          supabaseUrl,
          secretKey,
          'xrpl_fail_network_steady_tick',
          {
            p_owner: owner,
            p_tick_id: claim.tickId,
            p_failed_at: new Date().toISOString(),
            p_error: error instanceof Error ? error.message : String(error),
          },
        )
      } catch {
        // The original fail-closed error remains authoritative.
      }
    }
    return json(
      {
        ok: false,
        sessionId: claim?.sessionId ?? null,
        tickId: claim?.tickId ?? null,
        error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      },
      500,
    )
  }
})
