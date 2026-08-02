import { isLendingTransactionType } from '../../../src/collector/incremental/lending-transaction-types.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../../../src/collector/incremental/read-validated-ledger.ts'
import type { IncrementalScanResult } from '../../../src/collector/incremental/scan-validated-ledgers.ts'
import {
  decodeAndVerifyNormalizedPayloadChunk,
  PortablePayloadResourceHaltError,
  PortablePayloadValidationError,
} from '../../../src/shared/portable-collector-payload.ts'
import { buildPortableCollectorWorkId } from '../../../src/shared/portable-collector-planner.ts'
import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store.ts'
import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from '../../../src/shared/portable-collector-xrpl-normalization.ts'

const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const PROFILE_ID = 'supabase-devnet'
const PHASE_EPOCH_ID = 'supabase-r4c2c-v1'
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

type PayloadChunkRow = {
  work_id: string
  chunk_index: number
  payload_json: string
  payload_digest: string
  encoded_digest: string | null
  byte_count: number
  record_count: number
}

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
    throw new PhaseExecutionError('digest_mismatch', `${name} has an invalid SHA-256 digest`)
  }
  return value.slice('sha256:'.length)
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
    if (message.network !== 'devnet') {
      throw new PhaseExecutionError('base_mismatch', 'scan message network is not Devnet')
    }
    if (message.epochId !== PHASE_EPOCH_ID) {
      throw new PhaseExecutionError('epoch_mismatch', 'scan message epoch is not R4C2c')
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
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: adminHeaders(secretKey),
      signal: AbortSignal.timeout(10_000),
    })
  } catch (error) {
    throw new RemoteStorageError(
      `storage read failed for ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new RemoteStorageError(`storage read failed for ${path} (${response.status})`)
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
    `xrpl_phase_messages?profile_id=eq.${PROFILE_ID}&select=message_id,phase,status,available_at,attempt_count,lease_expires_at,result,successor_message_id,error_classification,error_message,created_at,updated_at,completed_at&order=updated_at.desc,message_id.desc&limit=24`,
  )
  const recentWorks = await getRows<JsonObject>(
    supabaseUrl,
    secretKey,
    `xrpl_phase_work?profile_id=eq.${PROFILE_ID}&select=work_id,epoch_id,previous_ledger_index,start_ledger_index,expected_parent_hash,scanned_end_ledger_index,final_ledger_hash,status,semantic_counts_json,payload_digest,expected_payload_chunks,expected_commit_chunks,created_at,updated_at,committed_at&order=updated_at.desc,work_id.desc&limit=8`,
  )
  const latestCommittedWork = recentWorks.find(
    (work) => work.status === 'committed' && work.epoch_id === PHASE_EPOCH_ID,
  )
  const latestWorkId = typeof latestCommittedWork?.work_id === 'string'
    ? latestCommittedWork.work_id
    : null
  const committedRows = latestWorkId
    ? await getRows<JsonObject>(
        supabaseUrl,
        secretKey,
        `xrpl_phase_committed_reference_rows?work_id=eq.${encodeURIComponent(latestWorkId)}&select=work_id,semantic_class,canonical_key,source_ledger_index,source_ledger_hash,source_transaction_hash,object_id,relationship_ids,value_json,is_tombstone,created_at&order=semantic_class.asc,canonical_key.asc&limit=400`,
      )
    : []

  const semanticClassCounts = Object.fromEntries(
    [
      'validated-ledger',
      'protocol-event',
      'object-change',
      'loan-lifecycle',
      'archived-object',
      'balance-history',
      'current-projection',
    ].map((semanticClass) => [
      semanticClass,
      committedRows.filter((row) => row.semantic_class === semanticClass).length,
    ]),
  )

  return {
    service: 'xrpl-lending-monitor-supabase-probe',
    profileId: PROFILE_ID,
    phaseEpochId: PHASE_EPOCH_ID,
    runtime: runtimeRows[0] ?? null,
    recentRuns,
    phaseChain: {
      stream: streams[0] ?? null,
      watermark: watermarks[0] ?? null,
      recentMessages,
      recentWorks,
      latestCommittedWork: latestCommittedWork ?? null,
      committedRows,
      semanticClassCounts,
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
): Promise<ValidatedLedgerRead> {
  const result = await rpcRequest(endpoint, 'ledger', {
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
    throw new PhaseExecutionError(
      'digest_mismatch',
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

async function readPayloadChunk(options: {
  supabaseUrl: string
  secretKey: string
  workId: string
  chunkIndex: number
}): Promise<PayloadChunkRow> {
  const rows = await getRows<PayloadChunkRow>(
    options.supabaseUrl,
    options.secretKey,
    `xrpl_phase_payload_chunks?work_id=eq.${encodeURIComponent(options.workId)}&chunk_index=eq.${options.chunkIndex}&select=work_id,chunk_index,payload_json,payload_digest,encoded_digest,byte_count,record_count&limit=2`,
  )
  if (rows.length !== 1) {
    throw new RemoteStorageError(
      `payload chunk lookup returned ${rows.length} rows for ${options.workId}/${options.chunkIndex}`,
    )
  }
  return rows[0]!
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
        `ledger ${ledger.ledgerIndex} parent does not match the committed boundary`,
      )
    }

    const workId = buildPortableCollectorWorkId({
      network: message.network,
      epochId: message.epochId,
      baseIdentity: message.baseIdentity,
      previousLedgerIndex: message.expectedPreviousLedgerIndex,
      expectedParentHash: message.expectedPreviousLedgerHash,
    })
    const normalized = await buildPortableXrplNormalizedWork({
      scan: oneLedgerScan(options.endpoint, ledger),
      workId,
      network: message.network,
      epochId: message.epochId,
      baseIdentity: message.baseIdentity,
      previousLedgerIndex: message.expectedPreviousLedgerIndex,
      expectedParentHash: message.expectedPreviousLedgerHash,
    })
    const chunks = await Promise.all(
      normalized.chunks.map(async (built) => ({
        chunkIndex: built.chunk.chunkIndex,
        totalChunks: built.chunk.totalChunks,
        payloadJson: built.encodedJson,
        chunkDigest: stripSha256Prefix(built.chunk.chunkDigest, 'chunkDigest'),
        encodedDigest: await sha256Hex(built.encodedJson),
        recordCount: built.chunk.records.length,
      })),
    )
    const completion = await postRpc<JsonObject>(
      options.supabaseUrl,
      options.secretKey,
      'xrpl_complete_portable_scan_phase',
      {
        p_owner: options.owner,
        p_message_id: message.messageId,
        p_completed_at: completedAt,
        p_ledger_index: ledger.ledgerIndex,
        p_ledger_hash: ledger.ledgerHash,
        p_parent_hash: ledger.parentHash,
        p_payload_digest: stripSha256Prefix(normalized.payload.digest, 'payloadDigest'),
        p_semantic_counts_json: normalized.semanticCountsJson,
        p_chunks_json: canonicalPortableJson(chunks),
      },
    )
    return {
      phase: 'scan',
      status: 'staged',
      ledgerIndex: ledger.ledgerIndex,
      ledgerHash: ledger.ledgerHash,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: ledger.transactions.filter((transaction) =>
        isLendingTransactionType(transaction.transactionType),
      ).length,
      payloadChunks: normalized.chunks.length,
      semanticCounts: normalized.payload.semanticCounts,
      completion,
    }
  }

  if (message.phase === 'commit') {
    const row = await readPayloadChunk({
      supabaseUrl: options.supabaseUrl,
      secretKey: options.secretKey,
      workId: message.workId,
      chunkIndex: message.chunkIndex,
    })
    if (row.encoded_digest === null || await sha256Hex(row.payload_json) !== row.encoded_digest) {
      throw new PhaseExecutionError('digest_mismatch', 'stored payload encoded digest mismatch')
    }
    if (new TextEncoder().encode(row.payload_json).byteLength !== row.byte_count) {
      throw new PhaseExecutionError('digest_mismatch', 'stored payload byte count mismatch')
    }
    const chunk = await decodeAndVerifyNormalizedPayloadChunk(
      new TextEncoder().encode(row.payload_json),
    )
    if (
      chunk.workId !== message.workId ||
      chunk.chunkIndex !== message.chunkIndex ||
      chunk.records.length !== row.record_count ||
      stripSha256Prefix(chunk.chunkDigest, 'chunkDigest') !== row.payload_digest
    ) {
      throw new PhaseExecutionError('digest_mismatch', 'stored payload chunk identity mismatch')
    }
    const referenceRowsJson = canonicalPortableJson(
      portableReferenceRowsFromChunk(chunk),
    )
    const completion = await postRpc<JsonObject>(
      options.supabaseUrl,
      options.secretKey,
      'xrpl_complete_portable_commit_phase',
      {
        p_owner: options.owner,
        p_message_id: message.messageId,
        p_completed_at: completedAt,
        p_reference_rows_json: referenceRowsJson,
        p_reference_rows_digest: await sha256Hex(referenceRowsJson),
      },
    )
    return {
      phase: 'commit',
      status: 'committing',
      chunkIndex: message.chunkIndex,
      rowCount: chunk.records.length,
      completion,
    }
  }

  const completion = await postRpc<JsonObject>(
    options.supabaseUrl,
    options.secretKey,
    'xrpl_complete_portable_finalize_phase',
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
  if (error instanceof PortablePayloadResourceHaltError) {
    return new PhaseExecutionError('resource_halt', error.message)
  }
  if (error instanceof PortablePayloadValidationError) {
    return new PhaseExecutionError('digest_mismatch', error.message)
  }
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
