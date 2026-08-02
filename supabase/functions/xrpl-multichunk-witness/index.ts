import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from '../../../src/collector/history-segments/portable-xrpl-normalization.ts'
import { isLendingTransactionType } from '../../../src/collector/incremental/lending-transaction-types.ts'
import type { IncrementalScanResult } from '../../../src/collector/incremental/scan-validated-ledgers.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../../../src/collector/incremental/validated-ledger-parser.ts'
import {
  decodeAndVerifyNormalizedPayloadChunk,
} from '../../../src/shared/portable-collector-payload.ts'
import { buildPortableCollectorWorkId } from '../../../src/shared/portable-collector-planner.ts'
import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store.ts'

const PROFILE_ID = 'supabase-devnet-multichunk-witness'
const ACTIVE_PROFILE_ID = 'supabase-devnet'
const EPOCH_ID = 'supabase-r4c2c-v1'
const BASE_IDENTITY = 'multichunk-witness-2776760'
const PURPOSE = 'r4c2c-multichunk-witness-qualification'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234/'
const LEDGER_INDEX = 2_776_760
const LEDGER_HASH = '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
const PARENT_HASH = 'E7E4E253C314D5EBD39E8C063415A99299E48FB23A0E613F1FE5CA534B0C0628'
const EXPECTED_CHUNK_RECORD_COUNTS = [40, 40, 36] as const
const EXPECTED_COUNTS = {
  validatedLedgers: 1,
  protocolEvents: 8,
  objectChanges: 94,
  loanLifecycleEvents: 1,
  archivedObjects: 0,
  balanceHistory: 2,
  currentProjectionMutations: 10,
  totalRecords: 116,
} as const

type Json = Record<string, unknown>
type Phase = 'scan' | 'commit' | 'finalize'
type Claim = {
  claimed: boolean
  reason?: string
  message_id?: string
  phase?: Phase
  payload?: Json
  attempt_count?: number
  activation?: Json
}
type PayloadChunkRow = {
  work_id: string
  chunk_index: number
  payload_json: string
  payload_digest: string
  encoded_digest: string | null
  byte_count: number
  record_count: number
}
type ActiveWatermark = {
  profileId: string
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
  updatedAt: string
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function serviceKey(): string {
  const packed = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (packed) {
    const parsed = JSON.parse(packed) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return env('SUPABASE_SERVICE_ROLE_KEY')
}

function adminHeaders(key: string): HeadersInit {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    'content-type': 'application/json',
  }
}

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, name: string): Json {
  if (!isRecord(value)) throw new Error(`${name} must be an object`)
  return value
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string`)
  return value.trim()
}

function requireInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function requireHash(value: unknown, name: string): string {
  const result = requireString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(result)) throw new Error(`${name} must be a canonical hash`)
  return result
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', input)))
}

async function postRpc<T>(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
): Promise<T> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const text = await result.text()
  if (!result.ok) {
    throw new Error(`${functionName} failed (${result.status}): ${text.slice(0, 500)}`)
  }
  return JSON.parse(text) as T
}

async function getRows<T>(supabaseUrl: string, key: string, path: string): Promise<T[]> {
  const result = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: adminHeaders(key),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await result.text()
  if (!result.ok) throw new Error(`storage read failed (${result.status}): ${text.slice(0, 500)}`)
  return JSON.parse(text) as T[]
}

async function readLedger(endpoint: string): Promise<ValidatedLedgerRead> {
  const result = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'ledger',
      params: [
        {
          ledger_index: LEDGER_INDEX,
          transactions: true,
          expand: true,
          owner_funds: false,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!result.ok) throw new Error(`Devnet ledger ${LEDGER_INDEX} returned HTTP ${result.status}`)
  const payload = await result.json()
  if (!isRecord(payload) || !isRecord(payload.result)) {
    throw new Error(`Devnet ledger ${LEDGER_INDEX} did not return a result object`)
  }
  if (typeof payload.result.error === 'string') {
    throw new Error(
      `Devnet ledger ${LEDGER_INDEX} failed: ${String(payload.result.error_message ?? payload.result.error)}`,
    )
  }
  const ledger = parseValidatedLedgerResult({
    endpoint,
    requestedLedgerIndex: LEDGER_INDEX,
    result: payload.result,
  })
  if (ledger.ledgerHash !== LEDGER_HASH || ledger.parentHash !== PARENT_HASH) {
    throw new Error(`Devnet ledger ${LEDGER_INDEX} identity changed`)
  }
  return ledger
}

function singleLedgerScan(ledger: ValidatedLedgerRead): IncrementalScanResult {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint: ledger.endpoint,
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

function verifyNormalized(normalized: Awaited<ReturnType<typeof buildPortableXrplNormalizedWork>>): void {
  if (normalized.chunks.length !== EXPECTED_CHUNK_RECORD_COUNTS.length) {
    throw new Error(`Expected 3 payload chunks, received ${normalized.chunks.length}`)
  }
  const counts = normalized.chunks.map((chunk) => chunk.chunk.records.length)
  if (canonicalPortableJson(counts) !== canonicalPortableJson(EXPECTED_CHUNK_RECORD_COUNTS)) {
    throw new Error(`Unexpected payload chunk counts: ${canonicalPortableJson(counts)}`)
  }
  if (
    canonicalPortableJson(normalized.payload.semanticCounts)
    !== canonicalPortableJson(EXPECTED_COUNTS)
  ) {
    throw new Error(
      `Unexpected semantic counts: ${canonicalPortableJson(normalized.payload.semanticCounts)}`,
    )
  }
}

function parseClaim(claim: Claim): { phase: Phase; messageId: string; payload: Json } {
  if (!claim.claimed || !claim.phase || !claim.message_id || !claim.payload) {
    throw new Error('Multi-chunk phase claim is incomplete')
  }
  const payload = requireRecord(claim.payload, 'phase payload')
  if (payload.phase !== claim.phase || payload.messageId !== claim.message_id) {
    throw new Error('Multi-chunk phase claim identity is inconsistent')
  }
  if (claim.phase === 'scan') {
    if (
      payload.epochId !== EPOCH_ID
      || payload.baseIdentity !== BASE_IDENTITY
      || requireInteger(payload.expectedPreviousLedgerIndex, 'expectedPreviousLedgerIndex') !== LEDGER_INDEX - 1
      || requireString(payload.expectedPreviousLedgerHash, 'expectedPreviousLedgerHash') !== PARENT_HASH
    ) {
      throw new Error('Multi-chunk scan boundary is invalid')
    }
  }
  return { phase: claim.phase, messageId: claim.message_id, payload }
}

async function readPayloadChunk(
  supabaseUrl: string,
  key: string,
  workId: string,
  chunkIndex: number,
): Promise<PayloadChunkRow> {
  const rows = await getRows<PayloadChunkRow>(
    supabaseUrl,
    key,
    `xrpl_phase_payload_chunks?work_id=eq.${encodeURIComponent(workId)}&chunk_index=eq.${chunkIndex}&select=work_id,chunk_index,payload_json,payload_digest,encoded_digest,byte_count,record_count&limit=2`,
  )
  if (rows.length !== 1) {
    throw new Error(`Payload chunk ${workId}/${chunkIndex} returned ${rows.length} rows`)
  }
  return rows[0]!
}

async function activeWatermark(supabaseUrl: string, key: string): Promise<ActiveWatermark> {
  const rows = await getRows<Json>(
    supabaseUrl,
    key,
    'xrpl_phase_watermarks?profile_id=eq.supabase-devnet&select=profile_id,network,epoch_id,base_identity,ledger_index,ledger_hash,work_id,updated_at&limit=2',
  )
  if (rows.length !== 1) throw new Error(`Active watermark lookup returned ${rows.length} rows`)
  const row = rows[0]!
  const result: ActiveWatermark = {
    profileId: requireString(row.profile_id, 'active profile_id'),
    network: requireString(row.network, 'active network'),
    epochId: requireString(row.epoch_id, 'active epoch_id'),
    baseIdentity: requireString(row.base_identity, 'active base_identity'),
    ledgerIndex: requireInteger(row.ledger_index, 'active ledger_index'),
    ledgerHash: requireHash(row.ledger_hash, 'active ledger_hash'),
    workId: requireString(row.work_id, 'active work_id'),
    updatedAt: requireString(row.updated_at, 'active updated_at'),
  }
  if (
    result.profileId !== ACTIVE_PROFILE_ID
    || result.network !== 'devnet'
    || result.epochId !== EPOCH_ID
  ) {
    throw new Error('Active watermark source identity is invalid')
  }
  return result
}

function verifyActiveWatermarkIsolation(
  before: ActiveWatermark,
  after: ActiveWatermark,
  isolatedWorkId: string,
): Json {
  if (
    before.profileId !== after.profileId
    || before.network !== after.network
    || before.epochId !== after.epochId
    || before.baseIdentity !== after.baseIdentity
  ) {
    throw new Error('Multi-chunk witness changed the active Supabase source identity')
  }
  if (before.workId === isolatedWorkId || after.workId === isolatedWorkId) {
    throw new Error('Multi-chunk witness work leaked into the active Supabase watermark')
  }
  if (after.ledgerIndex < before.ledgerIndex) {
    throw new Error('Active Supabase watermark regressed during multi-chunk verification')
  }
  if (
    after.ledgerIndex === before.ledgerIndex
    && (after.ledgerHash !== before.ledgerHash || after.workId !== before.workId)
  ) {
    throw new Error('Active Supabase watermark changed identity without advancing')
  }
  return {
    profileId: after.profileId,
    network: after.network,
    epochId: after.epochId,
    baseIdentity: after.baseIdentity,
    ledgerAdvance: after.ledgerIndex - before.ledgerIndex,
    isolatedWorkExcluded: true,
    nonRegressing: true,
  }
}

async function execute(): Promise<Json> {
  const supabaseUrl = env('SUPABASE_URL')
  const key = serviceKey()
  const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL')?.trim() || DEFAULT_ENDPOINT
  const activeBefore = await activeWatermark(supabaseUrl, key)
  const ledger = await readLedger(endpoint)
  const workId = buildPortableCollectorWorkId({
    network: 'devnet',
    epochId: EPOCH_ID,
    baseIdentity: BASE_IDENTITY,
    previousLedgerIndex: LEDGER_INDEX - 1,
    expectedParentHash: PARENT_HASH,
  })
  const normalized = await buildPortableXrplNormalizedWork({
    scan: singleLedgerScan(ledger),
    workId,
    network: 'devnet',
    epochId: EPOCH_ID,
    baseIdentity: BASE_IDENTITY,
    previousLedgerIndex: LEDGER_INDEX - 1,
    expectedParentHash: PARENT_HASH,
  })
  verifyNormalized(normalized)

  const owner = `multichunk-${crypto.randomUUID()}`
  const phaseSequence: Json[] = []

  for (let step = 0; step < 8; step += 1) {
    const claim = await postRpc<Claim>(
      supabaseUrl,
      key,
      'xrpl_claim_multichunk_witness_phase',
      {
        p_owner: owner,
        p_now: new Date().toISOString(),
        p_lease_seconds: 55,
      },
    )
    if (!claim.claimed) {
      if (claim.reason === 'already_committed') break
      throw new Error(`Multi-chunk phase was not claimable: ${claim.reason ?? 'unknown'}`)
    }
    const phase = parseClaim(claim)
    const completedAt = new Date().toISOString()

    if (phase.phase === 'scan') {
      const chunks = await Promise.all(
        normalized.chunks.map(async (built) => ({
          chunkIndex: built.chunk.chunkIndex,
          totalChunks: built.chunk.totalChunks,
          payloadJson: built.encodedJson,
          chunkDigest: built.chunk.chunkDigest.slice('sha256:'.length),
          encodedDigest: await sha256(built.encodedJson),
          recordCount: built.chunk.records.length,
        })),
      )
      const completion = await postRpc<Json>(
        supabaseUrl,
        key,
        'xrpl_complete_portable_scan_phase',
        {
          p_owner: owner,
          p_message_id: phase.messageId,
          p_completed_at: completedAt,
          p_ledger_index: LEDGER_INDEX,
          p_ledger_hash: LEDGER_HASH,
          p_parent_hash: PARENT_HASH,
          p_payload_digest: normalized.payload.digest.slice('sha256:'.length),
          p_semantic_counts_json: normalized.semanticCountsJson,
          p_chunks_json: canonicalPortableJson(chunks),
        },
      )
      phaseSequence.push({ phase: 'scan', messageId: phase.messageId, attemptCount: claim.attempt_count, completion })
      continue
    }

    if (phase.phase === 'commit') {
      const claimedWorkId = requireString(phase.payload.workId, 'workId')
      const chunkIndex = requireInteger(phase.payload.chunkIndex, 'chunkIndex')
      if (claimedWorkId !== workId || chunkIndex >= EXPECTED_CHUNK_RECORD_COUNTS.length) {
        throw new Error('Multi-chunk commit identity is invalid')
      }
      const stored = await readPayloadChunk(supabaseUrl, key, workId, chunkIndex)
      if (
        stored.encoded_digest === null
        || await sha256(stored.payload_json) !== stored.encoded_digest
        || new TextEncoder().encode(stored.payload_json).byteLength !== stored.byte_count
        || stored.record_count !== EXPECTED_CHUNK_RECORD_COUNTS[chunkIndex]
      ) {
        throw new Error(`Stored multi-chunk payload ${chunkIndex} failed integrity checks`)
      }
      const chunk = await decodeAndVerifyNormalizedPayloadChunk(
        new TextEncoder().encode(stored.payload_json),
      )
      if (
        chunk.workId !== workId
        || chunk.chunkIndex !== chunkIndex
        || chunk.records.length !== stored.record_count
        || chunk.chunkDigest.slice('sha256:'.length) !== stored.payload_digest
      ) {
        throw new Error(`Stored multi-chunk payload ${chunkIndex} identity changed`)
      }
      const referenceRowsJson = canonicalPortableJson(portableReferenceRowsFromChunk(chunk))
      const completion = await postRpc<Json>(
        supabaseUrl,
        key,
        'xrpl_complete_portable_commit_phase',
        {
          p_owner: owner,
          p_message_id: phase.messageId,
          p_completed_at: completedAt,
          p_reference_rows_json: referenceRowsJson,
          p_reference_rows_digest: await sha256(referenceRowsJson),
        },
      )
      phaseSequence.push({
        phase: 'commit',
        messageId: phase.messageId,
        attemptCount: claim.attempt_count,
        chunkIndex,
        rowCount: chunk.records.length,
        completion,
      })
      continue
    }

    const claimedWorkId = requireString(phase.payload.workId, 'workId')
    if (claimedWorkId !== workId) throw new Error('Multi-chunk finalize work identity changed')
    const completion = await postRpc<Json>(
      supabaseUrl,
      key,
      'xrpl_complete_portable_finalize_phase',
      {
        p_owner: owner,
        p_message_id: phase.messageId,
        p_completed_at: completedAt,
      },
    )
    phaseSequence.push({ phase: 'finalize', messageId: phase.messageId, attemptCount: claim.attempt_count, completion })
    break
  }

  const works = await getRows<Json>(
    supabaseUrl,
    key,
    `xrpl_phase_work?work_id=eq.${encodeURIComponent(workId)}&select=work_id,profile_id,network,epoch_id,base_identity,previous_ledger_index,start_ledger_index,scanned_end_ledger_index,final_ledger_hash,status,semantic_counts_json,payload_digest,expected_payload_chunks,expected_commit_chunks,committed_at&limit=2`,
  )
  if (works.length !== 1) throw new Error(`Multi-chunk work returned ${works.length} rows`)
  const work = works[0]!
  if (
    work.profile_id !== PROFILE_ID
    || work.status !== 'committed'
    || requireInteger(work.expected_payload_chunks, 'expected_payload_chunks') !== 3
    || requireInteger(work.expected_commit_chunks, 'expected_commit_chunks') !== 3
  ) {
    throw new Error('Multi-chunk work did not commit with three chunks')
  }

  const payloadChunks = await getRows<Json>(
    supabaseUrl,
    key,
    `xrpl_phase_payload_chunks?work_id=eq.${encodeURIComponent(workId)}&select=chunk_index,record_count,byte_count,payload_digest,encoded_digest&order=chunk_index.asc`,
  )
  const commitChunks = await getRows<Json>(
    supabaseUrl,
    key,
    `xrpl_phase_commit_chunks?work_id=eq.${encodeURIComponent(workId)}&select=chunk_index,status,operation_count,row_mutation_count,chunk_digest,completed_at&order=chunk_index.asc`,
  )
  const referenceRows = await getRows<Json>(
    supabaseUrl,
    key,
    `xrpl_phase_reference_rows?work_id=eq.${encodeURIComponent(workId)}&select=semantic_class,canonical_key,source_ledger_index,source_ledger_hash,source_transaction_hash,object_id,relationship_ids,value_json,is_tombstone,created_at&order=source_ledger_index.asc,semantic_class.asc,canonical_key.asc&limit=200`,
  )
  const watermarks = await getRows<Json>(
    supabaseUrl,
    key,
    `xrpl_phase_watermarks?profile_id=eq.${PROFILE_ID}&select=profile_id,network,epoch_id,base_identity,ledger_index,ledger_hash,work_id,updated_at&limit=2`,
  )
  if (watermarks.length !== 1) throw new Error('Multi-chunk witness watermark is unavailable')
  if (payloadChunks.length !== 3 || commitChunks.length !== 3 || referenceRows.length !== 116) {
    throw new Error(
      `Multi-chunk evidence mismatch: payload=${payloadChunks.length}, commit=${commitChunks.length}, rows=${referenceRows.length}`,
    )
  }
  const payloadCounts = payloadChunks.map((chunk) => requireInteger(chunk.record_count, 'record_count'))
  const commitCounts = commitChunks.map((chunk) => requireInteger(chunk.row_mutation_count, 'row_mutation_count'))
  if (
    canonicalPortableJson(payloadCounts) !== canonicalPortableJson(EXPECTED_CHUNK_RECORD_COUNTS)
    || canonicalPortableJson(commitCounts) !== canonicalPortableJson(EXPECTED_CHUNK_RECORD_COUNTS)
  ) {
    throw new Error('Multi-chunk payload and commit counts do not match 40/40/36')
  }

  const semanticCounts = Object.fromEntries(
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
      referenceRows.filter((row) => row.semantic_class === semanticClass).length,
    ]),
  )
  const expectedReferenceCounts = {
    'validated-ledger': 1,
    'protocol-event': 8,
    'object-change': 94,
    'loan-lifecycle': 1,
    'archived-object': 0,
    'balance-history': 2,
    'current-projection': 10,
  }
  if (canonicalPortableJson(semanticCounts) !== canonicalPortableJson(expectedReferenceCounts)) {
    throw new Error(`Multi-chunk committed semantic counts changed: ${canonicalPortableJson(semanticCounts)}`)
  }

  const activeAfter = await activeWatermark(supabaseUrl, key)
  const activeIsolation = verifyActiveWatermarkIsolation(activeBefore, activeAfter, workId)

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    profileId: PROFILE_ID,
    sourceLedger: {
      ledgerIndex: LEDGER_INDEX,
      ledgerHash: LEDGER_HASH,
      parentHash: PARENT_HASH,
    },
    workId,
    phaseSequence,
    work,
    payloadChunks,
    commitChunks,
    referenceRowCount: referenceRows.length,
    semanticCounts,
    watermark: watermarks[0],
    activeWatermarkIsolated: true,
    activeWatermarkIsolation: activeIsolation,
    activeWatermarkBefore: activeBefore,
    activeWatermarkAfter: activeAfter,
  }
}

Deno.serve(async (request) => {
  try {
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405)
    if (request.headers.get(PURPOSE_HEADER) !== PURPOSE) {
      return response({ error: 'invalid_purpose' }, 403)
    }
    if (request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')) {
      return response({ error: 'unauthorized' }, 401)
    }
    return response(await execute())
  } catch (error) {
    return response(
      {
        schemaVersion: 1,
        purpose: PURPOSE,
        profileId: PROFILE_ID,
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      },
      500,
    )
  }
})
