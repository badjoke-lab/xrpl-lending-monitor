const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const PROFILE_ID = 'supabase-devnet'
const PHASE_LEASE_SECONDS = 45
const PHASE_RETRY_DELAY_MILLISECONDS = 15_000

type JsonObject = Record<string, unknown>
type Phase = 'scan' | 'commit' | 'finalize'
type FailureClassification =
  | 'retryable_transport'
  | 'retryable_storage'
  | 'invalid_message'
  | 'base_mismatch'
  | 'epoch_mismatch'
  | 'stale_boundary'
  | 'parent_hash_mismatch'
  | 'reset_detected'
  | 'digest_mismatch'
  | 'resource_halt'
  | 'terminal_internal'

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

type PhaseClaim = {
  claimed: boolean
  reason?: string
  reclaimed?: boolean
  previous_lease_owner?: string | null
  previous_lease_expires_at?: string | null
  message_id?: string
  phase?: Phase
  payload?: JsonObject
  attempt_count?: number
  lease_expires_at?: string
}

type ScanMessage = {
  schemaVersion: 1
  phase: 'scan'
  messageId: string
  network: string
  epochId: string
  baseIdentity: string
  expectedPreviousLedgerIndex: number
  expectedPreviousLedgerHash: string
  scanSequence: number
}

type CommitMessage = {
  schemaVersion: 1
  phase: 'commit'
  messageId: string
  workId: string
  chunkIndex: number
}

type FinalizeMessage = {
  schemaVersion: 1
  phase: 'finalize'
  messageId: string
  workId: string
}

type PhaseMessage = ScanMessage | CommitMessage | FinalizeMessage

class PhaseExecutionError extends Error {
  constructor(
    readonly classification: FailureClassification,
    message: string,
  ) {
    super(message)
    this.name = 'PhaseExecutionError'
  }
}

class RemoteTransportError extends PhaseExecutionError {
  constructor(message: string) {
    super('retryable_transport', message)
    this.name = 'RemoteTransportError'
  }
}

class RemoteStorageError extends PhaseExecutionError {
  constructor(message: string) {
    super('retryable_storage', message)
    this.name = 'RemoteStorageError'
  }
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new PhaseExecutionError('invalid_message', `${name} must be a non-empty string`)
  }
  return value.trim()
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new PhaseExecutionError(
      'invalid_message',
      `${name} must be a non-negative safe integer`,
    )
  }
  return parsed
}

function requiredHash(value: unknown, name: string): string {
  const hash = requiredString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) {
    throw new PhaseExecutionError(
      'invalid_message',
      `${name} must be a canonical 64-character hash`,
    )
  }
  return hash
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function scanMessageId(message: Omit<ScanMessage, 'schemaVersion' | 'phase' | 'messageId'>): string {
  return [
    'scan',
    'v1',
    encodeURIComponent(message.network),
    encodeURIComponent(message.epochId),
    encodeURIComponent(message.baseIdentity),
    String(message.expectedPreviousLedgerIndex),
    encodeURIComponent(message.expectedPreviousLedgerHash),
    String(message.scanSequence),
  ].join(':')
}

function parsePhaseMessage(claim: PhaseClaim): PhaseMessage {
  if (!claim.claimed || !claim.message_id || !claim.phase || !claim.payload) {
    throw new PhaseExecutionError('invalid_message', 'claimed phase message is incomplete')
  }
  const payload = claim.payload
  if (payload.schemaVersion !== 1 || payload.phase !== claim.phase) {
    throw new PhaseExecutionError('invalid_message', 'phase payload identity is invalid')
  }

  if (claim.phase === 'scan') {
    const message: ScanMessage = {
      schemaVersion: 1,
      phase: 'scan',
      messageId: requiredString(payload.messageId, 'messageId'),
      network: requiredString(payload.network, 'network'),
      epochId: requiredString(payload.epochId, 'epochId'),
      baseIdentity: requiredString(payload.baseIdentity, 'baseIdentity'),
      expectedPreviousLedgerIndex: requiredInteger(
        payload.expectedPreviousLedgerIndex,
        'expectedPreviousLedgerIndex',
      ),
      expectedPreviousLedgerHash: requiredHash(
        payload.expectedPreviousLedgerHash,
        'expectedPreviousLedgerHash',
      ),
      scanSequence: requiredInteger(payload.scanSequence, 'scanSequence'),
    }
    const expectedId = scanMessageId({
      network: message.network,
      epochId: message.epochId,
      baseIdentity: message.baseIdentity,
      expectedPreviousLedgerIndex: message.expectedPreviousLedgerIndex,
      expectedPreviousLedgerHash: message.expectedPreviousLedgerHash,
      scanSequence: message.scanSequence,
    })
    if (message.messageId !== expectedId || claim.message_id !== expectedId) {
      throw new PhaseExecutionError(
        'invalid_message',
        'scan message ID does not match semantic identity',
      )
    }
    if (message.network !== 'devnet' || message.epochId !== 'supabase-r4c2b-v1') {
      throw new PhaseExecutionError('base_mismatch', 'scan message scope is not R4C2b Devnet')
    }
    return message
  }

  if (claim.phase === 'commit') {
    const workId = requiredString(payload.workId, 'workId')
    const chunkIndex = requiredInteger(payload.chunkIndex, 'chunkIndex')
    const messageId = requiredString(payload.messageId, 'messageId')
    const expectedId = `commit:v1:${encodeURIComponent(workId)}:${chunkIndex}`
    if (messageId !== expectedId || claim.message_id !== expectedId) {
      throw new PhaseExecutionError(
        'invalid_message',
        'commit message ID does not match semantic identity',
      )
    }
    return {
      schemaVersion: 1,
      phase: 'commit',
      messageId,
      workId,
      chunkIndex,
    }
  }

  const workId = requiredString(payload.workId, 'workId')
  const messageId = requiredString(payload.messageId, 'messageId')
  const expectedId = `finalize:v1:${encodeURIComponent(workId)}`
  if (messageId !== expectedId || claim.message_id !== expectedId) {
    throw new PhaseExecutionError(
      'invalid_message',
      'finalize message ID does not match semantic identity',
    )
  }
  return { schemaVersion: 1, phase: 'finalize', messageId, workId }
}

async function postRpc<T>(
  supabaseUrl: string,
  secretKey: string,
  functionName: string,
  body: JsonObject,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: adminHeaders(secretKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new RemoteStorageError(
      `${functionName} request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const text = await response.text()
  if (!response.ok) {
    throw new RemoteStorageError(
      `${functionName} failed (${response.status}): ${text.slice(0, 500)}`,
    )
  }
  return JSON.parse(text) as T
}

async function getRows<T>(
  supabaseUrl: string,
  secretKey: string,
  path: string,
): Promise<T[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: adminHeaders(secretKey),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    throw new Error(`health read failed for ${path} (${response.status})`)
  }
  return (await response.json()) as T[]
}

async function readHealth(supabaseUrl: string, secretKey: string): Promise<unknown> {
  const runtimeRows = await getRows<RuntimeRow>(
    supabaseUrl,
    secretKey,
    `xrpl_collector_runtime?profile_id=eq.${PROFILE_ID}&select=profile_id,network,status,lease_expires_at,last_started_at,last_completed_at,last_failed_at,last_validated_ledger_index,last_validated_ledger_hash,last_error,tick_count,consecutive_failures,updated_at`,
  )
  const recentRuns = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_collector_runs?profile_id=eq.${PROFILE_ID}&select=status,source,started_at,completed_at,validated_ledger_index,validated_ledger_hash,error_message&order=completed_at.desc,id.desc&limit=5`,
  )
  const streams = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_streams?profile_id=eq.${PROFILE_ID}&select=profile_id,network,epoch_id,base_identity,immutable_base_ledger_index,immutable_base_ledger_hash,status,last_error_classification,last_error_message,created_at,updated_at`,
  )
  const watermarks = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_watermarks?profile_id=eq.${PROFILE_ID}&select=profile_id,network,epoch_id,base_identity,ledger_index,ledger_hash,work_id,updated_at`,
  )
  const recentMessages = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_messages?profile_id=eq.${PROFILE_ID}&select=message_id,phase,status,available_at,attempt_count,lease_expires_at,result,successor_message_id,error_classification,error_message,created_at,updated_at,completed_at&order=updated_at.desc,message_id.desc&limit=12`,
  )
  const recentWorks = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_work?profile_id=eq.${PROFILE_ID}&select=work_id,previous_ledger_index,start_ledger_index,expected_parent_hash,scanned_end_ledger_index,final_ledger_hash,status,payload_digest,expected_payload_chunks,expected_commit_chunks,created_at,updated_at,committed_at&order=updated_at.desc,work_id.desc&limit=5`,
  )
  const committedRows = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_committed_reference_rows?select=work_id,semantic_class,canonical_key,source_ledger_index,source_ledger_hash,value_json,is_tombstone,created_at&order=source_ledger_index.desc,canonical_key.desc&limit=5`,
  )

  return {
    service: 'xrpl-lending-monitor-supabase-probe',
    profileId: PROFILE_ID,
    runtime: runtimeRows[0] ?? null,
    recentRuns,
    phaseChain: {
      stream: streams[0] ?? null,
      watermark: watermarks[0] ?? null,
      recentMessages,
      recentWorks,
      committedRows,
    },
    checkedAt: new Date().toISOString(),
  }
}

async function rpcRequest(
  endpoint: string,
  method: string,
  params: JsonObject,
): Promise<JsonObject> {
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params: [{ ...params, api_version: 2 }] }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (error) {
    throw new RemoteTransportError(
      `XRPL ${method} request failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new RemoteTransportError(`XRPL ${method} failed (${response.status})`)
  }
  const payload = (await response.json()) as { result?: JsonObject }
  if (!payload.result) {
    throw new RemoteTransportError(`XRPL ${method} returned no result`)
  }
  if (typeof payload.result.error === 'string') {
    throw new RemoteTransportError(
      `XRPL ${method} error: ${String(payload.result.error_message ?? payload.result.error)}`,
    )
  }
  return payload.result
}

async function readValidatedLedgerHead(endpoint: string): Promise<{
  index: number
  hash: string
}> {
  const result = await rpcRequest(endpoint, 'server_info', {})
  const info = result.info as JsonObject | undefined
  const validated = info?.validated_ledger as JsonObject | undefined
  const index = requiredInteger(validated?.seq, 'validated ledger sequence')
  const hash = requiredHash(validated?.hash, 'validated ledger hash')
  return { index, hash }
}

async function readExactValidatedLedger(
  endpoint: string,
  ledgerIndex: number,
): Promise<{
  index: number
  hash: string
  parentHash: string
  closeTime: number
}> {
  const result = await rpcRequest(endpoint, 'ledger', {
    ledger_index: ledgerIndex,
    transactions: false,
    expand: false,
    owner_funds: false,
  })
  const ledger = result.ledger as JsonObject | undefined
  const index = requiredInteger(result.ledger_index ?? ledger?.ledger_index, 'ledger index')
  const hash = requiredHash(result.ledger_hash ?? ledger?.hash, 'ledger hash')
  const parentHash = requiredHash(ledger?.parent_hash, 'parent hash')
  const closeTime = requiredInteger(ledger?.close_time, 'close time')
  if (index !== ledgerIndex) {
    throw new PhaseExecutionError(
      'reset_detected',
      `requested ledger ${ledgerIndex}, received ${index}`,
    )
  }
  return { index, hash, parentHash, closeTime }
}

async function executePhase(options: {
  supabaseUrl: string
  secretKey: string
  endpoint: string
  owner: string
  claim: PhaseClaim
  validatedHead: { index: number; hash: string }
}): Promise<JsonObject> {
  const message = parsePhaseMessage(options.claim)
  const completedAt = new Date().toISOString()

  if (message.phase === 'scan') {
    if (options.validatedHead.index < message.expectedPreviousLedgerIndex) {
      throw new PhaseExecutionError(
        'reset_detected',
        `validated head ${options.validatedHead.index} precedes ${message.expectedPreviousLedgerIndex}`,
      )
    }
    if (options.validatedHead.index === message.expectedPreviousLedgerIndex) {
      const completion = await postRpc<JsonObject>(
        options.supabaseUrl,
        options.secretKey,
        'xrpl_complete_caught_up_scan',
        {
          p_owner: options.owner,
          p_message_id: message.messageId,
          p_completed_at: completedAt,
        },
      )
      return { phase: 'scan', status: 'caught_up', completion }
    }

    const ledger = await readExactValidatedLedger(
      options.endpoint,
      message.expectedPreviousLedgerIndex + 1,
    )
    if (ledger.parentHash !== message.expectedPreviousLedgerHash) {
      throw new PhaseExecutionError(
        'parent_hash_mismatch',
        `ledger ${ledger.index} parent does not match the committed boundary`,
      )
    }
    const payload = {
      schemaVersion: 1,
      work: {
        network: message.network,
        epochId: message.epochId,
        baseIdentity: message.baseIdentity,
        previousLedgerIndex: message.expectedPreviousLedgerIndex,
        expectedParentHash: message.expectedPreviousLedgerHash,
        startLedgerIndex: ledger.index,
        endLedgerIndex: ledger.index,
      },
      records: [
        {
          semanticClass: 'validated-ledger',
          canonicalKey: `ledger:${ledger.index}`,
          sourceLedgerIndex: ledger.index,
          sourceLedgerHash: ledger.hash,
          sourceTransactionHash: null,
          objectId: null,
          relationshipIds: [],
          isTombstone: false,
          value: {
            closeTime: ledger.closeTime,
            ledgerHash: ledger.hash,
            ledgerIndex: ledger.index,
            parentHash: ledger.parentHash,
          },
        },
      ],
    }
    const payloadJson = canonicalJson(payload)
    const payloadDigest = await sha256Hex(payloadJson)
    const completion = await postRpc<JsonObject>(
      options.supabaseUrl,
      options.secretKey,
      'xrpl_complete_scan_phase',
      {
        p_owner: options.owner,
        p_message_id: message.messageId,
        p_completed_at: completedAt,
        p_ledger_index: ledger.index,
        p_ledger_hash: ledger.hash,
        p_parent_hash: ledger.parentHash,
        p_close_time: ledger.closeTime,
        p_payload_json: payloadJson,
        p_payload_digest: payloadDigest,
        p_byte_count: new TextEncoder().encode(payloadJson).byteLength,
      },
    )
    return {
      phase: 'scan',
      status: 'staged',
      ledgerIndex: ledger.index,
      ledgerHash: ledger.hash,
      completion,
    }
  }

  if (message.phase === 'commit') {
    const completion = await postRpc<JsonObject>(
      options.supabaseUrl,
      options.secretKey,
      'xrpl_complete_commit_phase',
      {
        p_owner: options.owner,
        p_message_id: message.messageId,
        p_completed_at: completedAt,
      },
    )
    return { phase: 'commit', status: 'committing', completion }
  }

  const completion = await postRpc<JsonObject>(
    options.supabaseUrl,
    options.secretKey,
    'xrpl_complete_finalize_phase',
    {
      p_owner: options.owner,
      p_message_id: message.messageId,
      p_completed_at: completedAt,
    },
  )
  return { phase: 'finalize', status: 'committed', completion }
}

function classifyFailure(error: unknown): PhaseExecutionError {
  if (error instanceof PhaseExecutionError) return error
  return new PhaseExecutionError(
    'terminal_internal',
    error instanceof Error ? error.message : String(error),
  )
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
      return jsonResponse({
        ok: true,
        ...(await readHealth(supabaseUrl, secretKey) as JsonObject),
      })
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
  const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL
  let source = 'remote'
  try {
    const body = (await request.json()) as { source?: unknown }
    if (typeof body.source === 'string' && /^[a-z0-9_-]{1,50}$/u.test(body.source)) {
      source = body.source
    }
  } catch {
    source = 'remote'
  }

  let phaseClaim: PhaseClaim | null = null
  try {
    const tickClaim = await postRpc<{
      claimed: boolean
      reason?: string
      lease_expires_at?: string
    }>(supabaseUrl, secretKey, 'xrpl_claim_collector_tick', {
      p_owner: owner,
      p_now: startedAt.toISOString(),
      p_lease_seconds: PHASE_LEASE_SECONDS,
    })
    if (!tickClaim.claimed) {
      return jsonResponse(
        {
          ok: true,
          skipped: true,
          reason: tickClaim.reason ?? 'not_claimed',
          leaseExpiresAt: tickClaim.lease_expires_at ?? null,
        },
        202,
      )
    }

    const validatedHead = await readValidatedLedgerHead(endpoint)
    phaseClaim = await postRpc<PhaseClaim>(
      supabaseUrl,
      secretKey,
      'xrpl_claim_next_phase',
      {
        p_owner: owner,
        p_now: startedAt.toISOString(),
        p_lease_seconds: PHASE_LEASE_SECONDS,
      },
    )

    const phaseResult = phaseClaim.claimed
      ? await executePhase({
          supabaseUrl,
          secretKey,
          endpoint,
          owner,
          claim: phaseClaim,
          validatedHead,
        })
      : {
          phase: null,
          status: 'no_ready_message',
          reason: phaseClaim.reason ?? 'no_ready_message',
        }

    const completedAt = new Date()
    const tickCompletion = await postRpc<{
      completed: boolean
      reason?: string
      tick_count?: number
    }>(supabaseUrl, secretKey, 'xrpl_complete_collector_tick', {
      p_owner: owner,
      p_invocation_id: invocationId,
      p_source: source,
      p_started_at: startedAt.toISOString(),
      p_completed_at: completedAt.toISOString(),
      p_ledger_index: validatedHead.index,
      p_ledger_hash: validatedHead.hash,
    })
    if (!tickCompletion.completed) {
      throw new RemoteStorageError(
        `collector completion rejected: ${tickCompletion.reason ?? 'unknown'}`,
      )
    }

    return jsonResponse({
      ok: true,
      skipped: false,
      source,
      ledgerIndex: validatedHead.index,
      ledgerHash: validatedHead.hash,
      tickCount: tickCompletion.tick_count ?? null,
      phaseResult,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    })
  } catch (error) {
    const failedAt = new Date()
    const classified = classifyFailure(error)
    if (phaseClaim?.claimed && phaseClaim.message_id) {
      try {
        if (
          classified.classification === 'retryable_transport' ||
          classified.classification === 'retryable_storage'
        ) {
          await postRpc(supabaseUrl, secretKey, 'xrpl_retry_phase_message', {
            p_owner: owner,
            p_message_id: phaseClaim.message_id,
            p_now: failedAt.toISOString(),
            p_available_at: new Date(
              failedAt.getTime() + PHASE_RETRY_DELAY_MILLISECONDS,
            ).toISOString(),
            p_classification: classified.classification,
            p_error: classified.message,
          })
        } else {
          await postRpc(supabaseUrl, secretKey, 'xrpl_fail_phase_terminal', {
            p_owner: owner,
            p_message_id: phaseClaim.message_id,
            p_now: failedAt.toISOString(),
            p_classification: classified.classification,
            p_error: classified.message,
          })
        }
      } catch {
        // The original phase failure remains authoritative.
      }
    }
    try {
      await postRpc(supabaseUrl, secretKey, 'xrpl_fail_collector_tick', {
        p_owner: owner,
        p_invocation_id: invocationId,
        p_source: source,
        p_started_at: startedAt.toISOString(),
        p_failed_at: failedAt.toISOString(),
        p_error: `${classified.classification}: ${classified.message}`,
      })
    } catch {
      // The original failure remains authoritative. A lost lease is visible in health.
    }
    return jsonResponse(
      {
        ok: false,
        classification: classified.classification,
        error: classified.message,
        failedAt: failedAt.toISOString(),
      },
      502,
    )
  }
})
