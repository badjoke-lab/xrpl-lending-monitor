import { scanValidatedLedgerRange } from '../../../src/collector/incremental/scan-validated-ledgers.ts'
import {
  buildPortableCurrentStateNormalizedWork,
} from '../../../src/collector/history-segments/portable-current-state-normalization.ts'
import {
  portableReferenceRowsFromChunk,
} from '../../../src/collector/history-segments/portable-xrpl-normalization.ts'

const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const MAX_LEDGERS_PER_BATCH = 12
const LEASE_SECONDS = 120
const XRPL_TIMEOUT_MS = 15_000
const DATABASE_TIMEOUT_MS = 30_000

type CurrentState = {
  available?: boolean
  reason?: string
  status?: string
  ledgerIndex?: number
  ledgerHash?: string
  epochId?: string
  baseIdentity?: string
  historyCompleteThroughLedger?: number
  [key: string]: unknown
}

type ClaimResult = {
  claimed?: boolean
  reason?: string
  ledgerIndex?: number
  ledgerHash?: string
  epochId?: string
  baseIdentity?: string
  leaseOwner?: string
  [key: string]: unknown
}

type CompletionResult = {
  completed?: boolean
  ledgerIndex?: number
  ledgerHash?: string
  currentRowsApplied?: number
  historyDeferredLedgers?: number
  historyDeferredRecords?: number
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value
}

async function postJson<T>(
  url: string,
  headers: HeadersInit,
  body: unknown,
  timeoutMs = DATABASE_TIMEOUT_MS,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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

async function readValidatedHead(endpoint: string): Promise<{ index: number; hash: string }> {
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

async function callRpc<T>(options: {
  supabaseUrl: string
  secretKey: string
  functionName: string
  body: unknown
}): Promise<T> {
  return postJson<T>(
    `${options.supabaseUrl}/rest/v1/rpc/${options.functionName}`,
    adminHeaders(options.secretKey),
    options.body,
  )
}

async function releaseLease(options: {
  supabaseUrl: string
  secretKey: string
  owner: string
  at: string
}): Promise<void> {
  await callRpc({
    supabaseUrl: options.supabaseUrl,
    secretKey: options.secretKey,
    functionName: 'xrpl_release_current_first_lane',
    body: { p_owner: options.owner, p_released_at: options.at },
  })
}

async function failLease(options: {
  supabaseUrl: string
  secretKey: string
  owner: string
  error: string
  at: string
}): Promise<void> {
  await callRpc({
    supabaseUrl: options.supabaseUrl,
    secretKey: options.secretKey,
    functionName: 'xrpl_fail_current_first_lane',
    body: {
      p_owner: options.owner,
      p_error: options.error,
      p_failed_at: options.at,
    },
  })
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

  let body: { source?: unknown }
  try {
    body = await request.json() as { source?: unknown }
  } catch {
    body = {}
  }
  if (body.source !== 'pg_cron' && body.source !== 'manual_smoke' && body.source !== 'github_actions') {
    return jsonResponse({ ok: false, error: 'invalid_source' }, 400)
  }

  const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL
  const owner = `current-first-${Deno.env.get('SB_EXECUTION_ID') ?? crypto.randomUUID()}`
  const startedAt = new Date()
  let leaseClaimed = false

  try {
    const [head, current] = await Promise.all([
      readValidatedHead(endpoint),
      callRpc<CurrentState>({
        supabaseUrl,
        secretKey,
        functionName: 'xrpl_read_current_first_state',
        body: {},
      }),
    ])

    if (current.available !== true) {
      return jsonResponse({
        ok: true,
        source: body.source,
        claimed: false,
        reason: current.reason ?? 'current_lane_not_prepared',
        head,
      }, 202)
    }
    if (current.status !== 'active') {
      return jsonResponse({
        ok: true,
        source: body.source,
        claimed: false,
        reason: 'current_lane_halted',
        head,
        current,
      }, 202)
    }

    const observedCurrentLedger = integer(current.ledgerIndex, 'current.ledgerIndex')
    const observedCurrentHash = hash(current.ledgerHash, 'current.ledgerHash')
    if (observedCurrentLedger >= head.index) {
      if (observedCurrentLedger === head.index && observedCurrentHash !== head.hash) {
        throw new Error('current-first validated head hash conflicts with current watermark')
      }
      return jsonResponse({
        ok: true,
        source: body.source,
        claimed: false,
        reason: 'already_at_fresh_head',
        head,
        current,
      })
    }

    const claim = await callRpc<ClaimResult>({
      supabaseUrl,
      secretKey,
      functionName: 'xrpl_claim_current_first_lane',
      body: {
        p_owner: owner,
        p_now: startedAt.toISOString(),
        p_lease_seconds: LEASE_SECONDS,
      },
    })
    if (claim.claimed !== true) {
      return jsonResponse({
        ok: true,
        source: body.source,
        claimed: false,
        reason: claim.reason ?? 'current_lane_not_claimed',
        head,
      }, 202)
    }
    leaseClaimed = true

    const previousLedgerIndex = integer(claim.ledgerIndex, 'claim.ledgerIndex')
    const previousLedgerHash = hash(claim.ledgerHash, 'claim.ledgerHash')
    const epochId = requiredString(claim.epochId, 'claim.epochId')
    const baseIdentity = requiredString(claim.baseIdentity, 'claim.baseIdentity')

    if (previousLedgerIndex >= head.index) {
      if (previousLedgerIndex === head.index && previousLedgerHash !== head.hash) {
        throw new Error('claimed current watermark conflicts with validated head')
      }
      await releaseLease({
        supabaseUrl,
        secretKey,
        owner,
        at: new Date().toISOString(),
      })
      leaseClaimed = false
      return jsonResponse({
        ok: true,
        source: body.source,
        claimed: false,
        reason: 'caught_up_before_scan',
        head,
        ledgerIndex: previousLedgerIndex,
      })
    }

    const scanStartedAt = Date.now()
    const scan = await scanValidatedLedgerRange({
      endpoint,
      timeoutMs: XRPL_TIMEOUT_MS,
      startLedgerIndex: previousLedgerIndex + 1,
      latestValidatedLedger: head.index,
      maxLedgers: MAX_LEDGERS_PER_BATCH,
      expectedPreviousHash: previousLedgerHash,
    })
    if (scan.ledgers.length < 1 || scan.endLedgerIndex === null) {
      throw new Error('current-first scan returned no ledger while lag was positive')
    }
    if (scan.completeToLatest && scan.ledgers.at(-1)?.ledgerHash.toUpperCase() !== head.hash) {
      throw new Error('current-first scan reached head with a different validated hash')
    }

    const workId = [
      'current-work-v1',
      'devnet',
      epochId,
      baseIdentity,
      String(previousLedgerIndex + 1),
      previousLedgerHash,
    ].join(':')
    const normalized = await buildPortableCurrentStateNormalizedWork({
      scan,
      workId,
      network: 'devnet',
      epochId,
      baseIdentity,
      previousLedgerIndex,
      expectedParentHash: previousLedgerHash,
    })

    const currentRows = normalized.chunks
      .flatMap((chunk) => portableReferenceRowsFromChunk(chunk.chunk))
      .filter((row) => row.semanticClass === 'current-projection')
    const ledgers = scan.ledgers.map((ledger) => ({
      ledgerIndex: ledger.ledgerIndex,
      ledgerHash: ledger.ledgerHash.toUpperCase(),
      parentHash: ledger.parentHash.toUpperCase(),
    }))
    const deferredHistoryRecords =
      normalized.deferredHistoryCounts.totalRecords
      + normalized.payload.semanticCounts.validatedLedgers
      + normalized.payload.semanticCounts.currentProjectionMutations

    const completion = await callRpc<CompletionResult>({
      supabaseUrl,
      secretKey,
      functionName: 'xrpl_complete_current_first_lane',
      body: {
        p_owner: owner,
        p_expected_previous_ledger: previousLedgerIndex,
        p_expected_previous_hash: previousLedgerHash,
        p_ledgers_json: JSON.stringify(ledgers),
        p_current_rows_json: JSON.stringify(currentRows),
        p_deferred_history_records: deferredHistoryRecords,
        p_completed_at: new Date().toISOString(),
      },
    })
    leaseClaimed = false

    if (completion.completed !== true) {
      throw new Error('current-first completion was not acknowledged')
    }
    const completedLedgerIndex = integer(completion.ledgerIndex, 'completion.ledgerIndex')
    const expectedFinalLedgerIndex = scan.endLedgerIndex
    if (completedLedgerIndex !== expectedFinalLedgerIndex) {
      throw new Error('current-first completion watermark mismatch')
    }

    return jsonResponse({
      ok: true,
      source: body.source,
      claimed: true,
      head,
      startLedgerIndex: previousLedgerIndex + 1,
      endLedgerIndex: expectedFinalLedgerIndex,
      ledgerCount: scan.ledgers.length,
      lendingTransactions: scan.metrics.lendingTransactions,
      currentRows: currentRows.length,
      deferredHistoryRecords,
      scanMilliseconds: Date.now() - scanStartedAt,
      completion,
      historyWatermarkAdvanced: false,
      historyPersistencePerformed: false,
      currentWatermarkAdvanced: true,
      mainnetDisabled: true,
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (leaseClaimed) {
      try {
        await failLease({
          supabaseUrl,
          secretKey,
          owner,
          error: message,
          at: new Date().toISOString(),
        })
      } catch {
        // The original failure remains authoritative. A lease is bounded and
        // will expire even if failure finalization is unavailable.
      }
    }
    return jsonResponse({
      ok: false,
      source: body.source,
      error: message,
      historyWatermarkAdvanced: false,
      startedAt: startedAt.toISOString(),
      failedAt: new Date().toISOString(),
    }, 503)
  }
})
