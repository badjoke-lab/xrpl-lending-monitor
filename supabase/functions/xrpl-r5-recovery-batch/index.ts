import { isLendingTransactionType } from '../../../src/collector/incremental/lending-transaction-types.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../../../src/collector/incremental/read-validated-ledger.ts'
import type { IncrementalScanResult } from '../../../src/collector/incremental/scan-validated-ledgers.ts'
import {
  buildPortableXrplNormalizedWork,
  portableReferenceRowsFromChunk,
} from '../../../src/collector/history-segments/portable-xrpl-normalization.ts'
import { buildPortableCollectorWorkId } from '../../../src/shared/portable-collector-planner.ts'
import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store.ts'
import {
  evaluateSupabaseRevision3ResourceAccounting,
  SUPABASE_REVISION3_PROFILE,
  SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST,
  type SupabaseRevision3ResourceAccountingInput,
} from '../../../src/shared/supabase-revision3-resource-accounting.ts'

const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'
const RECOVERY_RUN_ID = 'r5-recovery-selected-revision3-entry'
const SELECTION_DIGEST = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
const MAX_BATCH_SIZE = 24
const FETCH_CONCURRENCY = 2
const LEASE_SECONDS = 55
const MEMORY_HALT_BYTES = 200 * 1024 * 1024
const MAX_SERVER_INFO_RESPONSE_BYTES = 256 * 1024
const MAX_LEDGER_RESPONSE_BYTES = 1024 * 1024
const MAX_DATABASE_RESPONSE_BYTES = 64 * 1024
const COMPLETION_REQUEST_RESERVE_BYTES = 2 * 1024 * 1024
const FAILURE_REQUEST_RESERVE_BYTES = 16 * 1024
const FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024
const TEXT_ENCODER = new TextEncoder()

type JsonObject = Record<string, unknown>
type MemorySample = {
  phase: string
  rssBytes: number
  heapTotalBytes: number
  heapUsedBytes: number
  externalBytes: number
}
type AccountingMeter = {
  networkRequestCount: number
  networkRequestBytes: number
  networkResponseBytes: number
  databaseRequestCount: number
  databaseRequestBytes: number
  databaseResponseBytes: number
}
type RecoveryClaim = {
  claimed: boolean
  reason?: string
  runId?: string
  batchId?: string
  batchSequence?: number
  startLedgerIndex?: number
  endLedgerIndex?: number
  ledgerCount?: number
  expectedParentHash?: string
  network?: string
  epochId?: string
  baseIdentity?: string
  profileRevision?: number
  profileIdentityDigest?: string
  selectionDigest?: string
  priorConservativeEgress31dBytes?: number
  projectedInvocations31d?: number
  priorInvocations31d?: number
  reservationBeforeAnyNetworkRead?: boolean
  freshHeadMustCoverReservedEndBeforeFetch?: boolean
}
type ValidatedRecoveryClaim = {
  claimed: true
  runId: string
  batchId: string
  batchSequence: number
  startLedgerIndex: number
  endLedgerIndex: number
  ledgerCount: number
  expectedParentHash: string
  network: 'devnet'
  epochId: 'supabase-r4c2c-v1'
  baseIdentity: string
  profileRevision: 3
  profileIdentityDigest: string
  selectionDigest: string
  priorConservativeEgress31dBytes: number
  projectedInvocations31d: number
  priorInvocations31d: number
}
type BuiltWork = {
  work: JsonObject
  normalizedRecordCount: number
  payloadChunkCount: number
  payloadBytes: number
  relationshipCount: number
}

class RecoveryError extends Error {
  readonly terminal: boolean

  constructor(message: string, terminal: boolean) {
    super(message)
    this.name = 'RecoveryError'
    this.terminal = terminal
  }
}

function sampleMemory(phase: string): MemorySample {
  const usage = Deno.memoryUsage()
  const sample = {
    phase,
    rssBytes: usage.rss,
    heapTotalBytes: usage.heapTotal,
    heapUsedBytes: usage.heapUsed,
    externalBytes: usage.external,
  }
  for (const [name, value] of Object.entries(sample)) {
    if (name !== 'phase' && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RecoveryError(`memory ${phase}.${name} is invalid`, true)
    }
  }
  if (sample.heapUsedBytes > sample.heapTotalBytes) {
    throw new RecoveryError(`memory ${phase} heap usage exceeds heap total`, true)
  }
  return sample
}

function memoryHighWater(samples: readonly MemorySample[]): number {
  const required = [
    'request_start',
    'after_claim',
    'after_head',
    'after_fetch',
    'after_normalize',
    'before_commit',
  ]
  const phases = new Set(samples.map((sample) => sample.phase))
  for (const phase of required) {
    if (!phases.has(phase)) {
      throw new RecoveryError(`R5 memory phase ${phase} is missing`, true)
    }
  }
  if (phases.size !== samples.length || samples.length !== required.length) {
    throw new RecoveryError('R5 memory phases are duplicated or incomplete', true)
  }
  return Math.max(...samples.map((sample) => sample.rssBytes))
}

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength
}

function emptyMeter(): AccountingMeter {
  return {
    networkRequestCount: 0,
    networkRequestBytes: 0,
    networkResponseBytes: 0,
    databaseRequestCount: 0,
    databaseRequestBytes: 0,
    databaseResponseBytes: 0,
  }
}

function addMeterValue(meter: AccountingMeter, key: keyof AccountingMeter, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RecoveryError(`${key} is invalid`, true)
  }
  const next = meter[key] + value
  if (!Number.isSafeInteger(next) || next < 0) {
    throw new RecoveryError(`${key} exceeds safe range`, true)
  }
  meter[key] = next
}

async function boundedResponseText(
  response: Response,
  maximumBytes: number,
  name: string,
): Promise<string> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new RecoveryError(`${name} maximum response bytes is invalid`, true)
  }
  if (!response.body) {
    const text = await response.text()
    if (byteLength(text) > maximumBytes) {
      throw new RecoveryError(`${name} response exceeds byte limit`, false)
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
        await reader.cancel(`${name} response exceeds byte limit`)
        throw new RecoveryError(`${name} response exceeds byte limit:${total}`, false)
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new RecoveryError(`Missing ${name}`, true)
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
    throw new RecoveryError(`${name} must be an object`, true)
  }
  return value as JsonObject
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RecoveryError(`${name} must be a non-empty string`, true)
  }
  return value.trim()
}

function requiredInteger(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RecoveryError(`${name} must be a non-negative safe integer`, true)
  }
  return parsed
}

function requiredHash(value: unknown, name: string): string {
  const hash = requiredString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) {
    throw new RecoveryError(`${name} must be a canonical 64-character hash`, true)
  }
  return hash
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = TEXT_ENCODER.encode(value)
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', input))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function stripSha256Prefix(value: string, name: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new RecoveryError(`${name} has an invalid SHA-256 digest`, true)
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

function transientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503
    || status === 504 || status === 520 || status === 522 || status === 524
}

function transientThrown(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'TimeoutError'
    || error instanceof TypeError
}

async function postRpc<T>(
  supabaseUrl: string,
  secretKey: string,
  functionName: string,
  body: JsonObject,
  meter?: AccountingMeter,
  maximumResponseBytes = MAX_DATABASE_RESPONSE_BYTES,
): Promise<T> {
  const bodyText = JSON.stringify(body)
  if (meter) {
    addMeterValue(meter, 'databaseRequestCount', 1)
    addMeterValue(meter, 'databaseRequestBytes', byteLength(bodyText))
  }
  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
      method: 'POST',
      headers: adminHeaders(secretKey),
      body: bodyText,
      signal: AbortSignal.timeout(55_000),
    })
  } catch (error) {
    throw new RecoveryError(
      `${functionName} transport failed: ${error instanceof Error ? error.message : String(error)}`,
      !transientThrown(error),
    )
  }
  const text = await boundedResponseText(response, maximumResponseBytes, functionName)
  if (meter) addMeterValue(meter, 'databaseResponseBytes', byteLength(text))
  if (!response.ok) {
    throw new RecoveryError(
      `${functionName} failed (${response.status}): ${text.slice(0, 1_000)}`,
      !transientStatus(response.status),
    )
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new RecoveryError(`${functionName} returned invalid JSON`, true)
  }
}

async function xrplRpc(
  endpoint: string,
  method: string,
  params: JsonObject,
  meter: AccountingMeter,
  maximumResponseBytes: number,
): Promise<JsonObject> {
  const bodyText = JSON.stringify({ method, params: [{ ...params, api_version: 2 }] })
  addMeterValue(meter, 'networkRequestCount', 1)
  addMeterValue(meter, 'networkRequestBytes', byteLength(bodyText))
  let response: Response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: bodyText,
      signal: AbortSignal.timeout(12_000),
    })
  } catch (error) {
    throw new RecoveryError(
      `XRPL ${method} transport failed: ${error instanceof Error ? error.message : String(error)}`,
      false,
    )
  }
  const text = await boundedResponseText(response, maximumResponseBytes, `XRPL ${method}`)
  addMeterValue(meter, 'networkResponseBytes', byteLength(text))
  if (!response.ok) {
    throw new RecoveryError(`XRPL ${method} failed (${response.status})`, false)
  }
  let payload: { result?: JsonObject }
  try {
    payload = JSON.parse(text) as { result?: JsonObject }
  } catch {
    throw new RecoveryError(`XRPL ${method} returned invalid JSON`, false)
  }
  if (!payload.result) throw new RecoveryError(`XRPL ${method} returned no result`, false)
  if (typeof payload.result.error === 'string') {
    throw new RecoveryError(
      `XRPL ${method} error: ${String(payload.result.error_message ?? payload.result.error)}`,
      false,
    )
  }
  return payload.result
}

async function readValidatedHead(
  endpoint: string,
  meter: AccountingMeter,
): Promise<{ index: number; hash: string }> {
  const result = await xrplRpc(
    endpoint,
    'server_info',
    {},
    meter,
    MAX_SERVER_INFO_RESPONSE_BYTES,
  )
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
  meter: AccountingMeter,
): Promise<ValidatedLedgerRead> {
  const result = await xrplRpc(
    endpoint,
    'ledger',
    {
      ledger_index: ledgerIndex,
      transactions: true,
      expand: true,
      owner_funds: false,
    },
    meter,
    MAX_LEDGER_RESPONSE_BYTES,
  )
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
    throw new RecoveryError(
      `expanded ledger ${ledgerIndex} is invalid: ${error instanceof Error ? error.message : String(error)}`,
      true,
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

function validateClaim(raw: RecoveryClaim): ValidatedRecoveryClaim {
  if (!raw.claimed) throw new RecoveryError('R5 recovery batch was not claimed', true)
  const claim: ValidatedRecoveryClaim = {
    claimed: true,
    runId: requiredString(raw.runId, 'runId'),
    batchId: requiredString(raw.batchId, 'batchId'),
    batchSequence: requiredInteger(raw.batchSequence, 'batchSequence'),
    startLedgerIndex: requiredInteger(raw.startLedgerIndex, 'startLedgerIndex'),
    endLedgerIndex: requiredInteger(raw.endLedgerIndex, 'endLedgerIndex'),
    ledgerCount: requiredInteger(raw.ledgerCount, 'ledgerCount'),
    expectedParentHash: requiredHash(raw.expectedParentHash, 'expectedParentHash'),
    network: requiredString(raw.network, 'network') as 'devnet',
    epochId: requiredString(raw.epochId, 'epochId') as 'supabase-r4c2c-v1',
    baseIdentity: requiredString(raw.baseIdentity, 'baseIdentity'),
    profileRevision: requiredInteger(raw.profileRevision, 'profileRevision') as 3,
    profileIdentityDigest: requiredString(
      raw.profileIdentityDigest,
      'profileIdentityDigest',
    ),
    selectionDigest: requiredString(raw.selectionDigest, 'selectionDigest'),
    priorConservativeEgress31dBytes: requiredInteger(
      raw.priorConservativeEgress31dBytes,
      'priorConservativeEgress31dBytes',
    ),
    projectedInvocations31d: requiredInteger(
      raw.projectedInvocations31d,
      'projectedInvocations31d',
    ),
    priorInvocations31d: requiredInteger(raw.priorInvocations31d, 'priorInvocations31d'),
  }
  if (
    claim.runId !== RECOVERY_RUN_ID
    || !/^r5-batch-v1-r5-recovery-[a-z0-9][a-z0-9-]{7,79}-[0-9]{8}$/u.test(
      claim.batchId,
    )
    || claim.network !== 'devnet'
    || claim.epochId !== 'supabase-r4c2c-v1'
    || claim.profileRevision !== SUPABASE_REVISION3_PROFILE.revision
    || claim.profileIdentityDigest !== SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST
    || claim.selectionDigest !== SELECTION_DIGEST
    || claim.ledgerCount < 1
    || claim.ledgerCount > MAX_BATCH_SIZE
    || claim.endLedgerIndex !== claim.startLedgerIndex + claim.ledgerCount - 1
    || claim.projectedInvocations31d !== claim.priorInvocations31d + 1
    || raw.reservationBeforeAnyNetworkRead !== true
    || raw.freshHeadMustCoverReservedEndBeforeFetch !== true
  ) {
    throw new RecoveryError('R5 recovery claim identity changed', true)
  }
  return claim
}

async function buildWork(options: {
  endpoint: string
  claim: ValidatedRecoveryClaim
  ledger: ValidatedLedgerRead
  previousLedgerIndex: number
  expectedParentHash: string
}): Promise<BuiltWork> {
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
  let normalizedRecordCount = 0
  let payloadBytes = 0
  let relationshipCount = 0
  const chunks = await Promise.all(
    normalized.chunks.map(async (built) => {
      const referenceRows = portableReferenceRowsFromChunk(built.chunk)
      normalizedRecordCount += built.chunk.records.length
      payloadBytes += byteLength(built.encodedJson)
      for (const row of referenceRows) relationshipCount += row.relationshipIds.length
      const referenceRowsJson = canonicalPortableJson(referenceRows)
      return {
        chunkIndex: built.chunk.chunkIndex,
        totalChunks: built.chunk.totalChunks,
        payloadJson: built.encodedJson,
        chunkDigest: stripSha256Prefix(built.chunk.chunkDigest, 'chunkDigest'),
        encodedDigest: await sha256Hex(built.encodedJson),
        byteCount: byteLength(built.encodedJson),
        recordCount: built.chunk.records.length,
        referenceRowsJson,
        referenceRowsDigest: await sha256Hex(referenceRowsJson),
      }
    }),
  )
  return {
    work: {
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
    },
    normalizedRecordCount,
    payloadChunkCount: chunks.length,
    payloadBytes,
    relationshipCount,
  }
}

function metadataNodeCount(ledgers: readonly ValidatedLedgerRead[]): number {
  let count = 0
  for (const ledger of ledgers) {
    for (const transaction of ledger.transactions) {
      const affectedNodes = transaction.metadata.AffectedNodes
      if (Array.isArray(affectedNodes)) count += affectedNodes.length
    }
  }
  return count
}

Deno.serve(async (request) => {
  const wallStarted = performance.now()
  const memorySamples: MemorySample[] = [sampleMemory('request_start')]
  const meter = emptyMeter()
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

  let claim: ValidatedRecoveryClaim | null = null
  const owner = `r5-recovery-${crypto.randomUUID()}`
  try {
    const body = object(await request.json(), 'request body')
    if (body.source !== 'github_actions') {
      return json({ ok: false, error: 'invalid_source' }, 403)
    }
    if ((body.run_id ?? RECOVERY_RUN_ID) !== RECOVERY_RUN_ID) {
      return json({ ok: false, error: 'invalid_run_id' }, 400)
    }

    const rawClaim = await postRpc<RecoveryClaim>(
      supabaseUrl,
      secretKey,
      'xrpl_claim_r5_active_recovery_batch_from_prepared_head',
      {
        p_run_id: RECOVERY_RUN_ID,
        p_owner: owner,
        p_now: new Date().toISOString(),
        p_lease_seconds: LEASE_SECONDS,
      },
      meter,
    )
    if (!rawClaim.claimed) {
      return json({
        ok: true,
        claimed: false,
        reason: rawClaim.reason ?? 'not_claimed',
        runId: rawClaim.runId ?? RECOVERY_RUN_ID,
      })
    }
    claim = validateClaim(rawClaim)
    memorySamples.push(sampleMemory('after_claim'))

    const endpoint = Deno.env.get('XRPL_DEVNET_RPC_URL') ?? DEFAULT_XRPL_DEVNET_RPC_URL
    const head = await readValidatedHead(endpoint, meter)
    if (head.index < claim.endLedgerIndex) {
      throw new RecoveryError(
        `validated head ${head.index} is below reserved end ${claim.endLedgerIndex}`,
        false,
      )
    }
    memorySamples.push(sampleMemory('after_head'))

    const fetchStarted = performance.now()
    const indexes = Array.from(
      { length: claim.ledgerCount },
      (_, index) => claim!.startLedgerIndex + index,
    )
    const ledgers = await mapLimit(
      indexes,
      FETCH_CONCURRENCY,
      (ledgerIndex) => readExactLedger(endpoint, ledgerIndex, meter),
    )
    const fetchMilliseconds = performance.now() - fetchStarted
    memorySamples.push(sampleMemory('after_fetch'))

    let expectedParentHash = claim.expectedParentHash
    for (const [index, ledger] of ledgers.entries()) {
      const expectedIndex = claim.startLedgerIndex + index
      if (ledger.ledgerIndex !== expectedIndex || ledger.parentHash !== expectedParentHash) {
        throw new RecoveryError(`R5 ledger continuity failed at ${expectedIndex}`, true)
      }
      expectedParentHash = ledger.ledgerHash
    }
    const finalLedger = ledgers.at(-1)
    if (!finalLedger) throw new RecoveryError('R5 recovery fetched no ledgers', true)
    if (head.index === claim.endLedgerIndex && finalLedger.ledgerHash !== head.hash) {
      throw new RecoveryError('R5 reserved-end hash conflicts with fresh validated head', true)
    }

    const normalizeStarted = performance.now()
    const builtWorks: BuiltWork[] = []
    let previousLedgerIndex = claim.startLedgerIndex - 1
    expectedParentHash = claim.expectedParentHash
    for (const ledger of ledgers) {
      builtWorks.push(await buildWork({
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
    memorySamples.push(sampleMemory('after_normalize'))

    const works = builtWorks.map((built) => built.work)
    const worksJson = canonicalPortableJson(works)
    const worksDigest = await sha256Hex(worksJson)
    memorySamples.push(sampleMemory('before_commit'))
    const memoryHighWaterBytes = memoryHighWater(memorySamples)
    if (memoryHighWaterBytes >= MEMORY_HALT_BYTES) {
      throw new RecoveryError(`R5 memory halt threshold reached:${memoryHighWaterBytes}`, true)
    }

    const input: SupabaseRevision3ResourceAccountingInput = {
      ledgerCount: ledgers.length,
      networkRequestCount: meter.networkRequestCount,
      networkRequestBytes: meter.networkRequestBytes,
      networkResponseBytes: meter.networkResponseBytes,
      databaseRequestCount: meter.databaseRequestCount + 2,
      databaseRequestBytes:
        meter.databaseRequestBytes
        + COMPLETION_REQUEST_RESERVE_BYTES
        + FAILURE_REQUEST_RESERVE_BYTES,
      databaseResponseBytes: meter.databaseResponseBytes + 2 * MAX_DATABASE_RESPONSE_BYTES,
      functionResponseBytes: FUNCTION_RESPONSE_RESERVE_BYTES,
      transactionCount: ledgers.reduce((sum, ledger) => sum + ledger.transactions.length, 0),
      metadataNodeCount: metadataNodeCount(ledgers),
      normalizedRecordCount: builtWorks.reduce(
        (sum, built) => sum + built.normalizedRecordCount,
        0,
      ),
      payloadChunkCount: builtWorks.reduce(
        (sum, built) => sum + built.payloadChunkCount,
        0,
      ),
      relationshipCount: builtWorks.reduce(
        (sum, built) => sum + built.relationshipCount,
        0,
      ),
      canonicalJsonBytes: byteLength(worksJson),
      payloadBytes: builtWorks.reduce((sum, built) => sum + built.payloadBytes, 0),
      priorConservativeEgress31dBytes: claim.priorConservativeEgress31dBytes,
      priorInvocations31d: claim.priorInvocations31d,
    }
    const accountingResult = evaluateSupabaseRevision3ResourceAccounting(input)
    const accounting = {
      schemaVersion: 1,
      profileId: SUPABASE_REVISION3_PROFILE.profileId,
      profileRevision: SUPABASE_REVISION3_PROFILE.revision,
      profileIdentityDigest: SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST,
      runId: claim.runId,
      batchId: claim.batchId,
      input,
      result: accountingResult,
      checks: {
        exactBatchIdentityBound: true,
        exactProfileIdentityBound: true,
        accountingValidatedInsideAtomicCompletion: true,
        completionRequestReserveApplied: true,
        reservationBeforeAnyNetworkRead: true,
      },
    }
    const accountingJson = canonicalPortableJson(accounting)
    const accountingDigest = await sha256Hex(accountingJson)
    if (!accountingResult.allowed) {
      throw new RecoveryError(
        `revision3_resource_halt:${accountingResult.failures.join(',')}`,
        true,
      )
    }
    if (accountingResult.projectedInvocations31d !== claim.projectedInvocations31d) {
      throw new RecoveryError('R5 invocation accounting parity failed', true)
    }

    const edgeWallMilliseconds = performance.now() - wallStarted
    const completionBody = {
      p_run_id: claim.runId,
      p_batch_id: claim.batchId,
      p_owner: owner,
      p_completed_at: new Date().toISOString(),
      p_works_json: worksJson,
      p_works_digest: worksDigest,
      p_accounting_json: accountingJson,
      p_accounting_digest: accountingDigest,
      p_finalized_egress_upper_bound_bytes:
        accountingResult.conservativeTickEgressUpperBoundBytes,
      p_fetch_milliseconds: fetchMilliseconds,
      p_normalize_milliseconds: normalizeMilliseconds,
      p_edge_wall_milliseconds: edgeWallMilliseconds,
    }
    const completionBodyBytes = byteLength(JSON.stringify(completionBody))
    if (completionBodyBytes > COMPLETION_REQUEST_RESERVE_BYTES) {
      throw new RecoveryError(
        `R5 completion request exceeds reserved bytes:${completionBodyBytes}`,
        true,
      )
    }

    const completion = await postRpc<JsonObject>(
      supabaseUrl,
      secretKey,
      'xrpl_complete_r5_active_recovery_batch',
      completionBody,
      meter,
    )
    if (
      completion.completed !== true
      || completion.runId !== claim.runId
      || completion.batchId !== claim.batchId
      || completion.startLedgerIndex !== claim.startLedgerIndex
      || completion.endLedgerIndex !== claim.endLedgerIndex
      || completion.ledgerCount !== claim.ledgerCount
      || completion.worksDigest !== worksDigest
      || completion.accountingDigest !== accountingDigest
    ) {
      throw new RecoveryError('R5 completion response parity failed', true)
    }

    return json({
      ok: true,
      claimed: true,
      runId: claim.runId,
      batchId: claim.batchId,
      batchSequence: claim.batchSequence,
      startLedgerIndex: claim.startLedgerIndex,
      endLedgerIndex: claim.endLedgerIndex,
      ledgerCount: claim.ledgerCount,
      validatedHead: head,
      fetchMilliseconds,
      normalizeMilliseconds,
      edgeWallMilliseconds,
      memoryHighWaterBytes,
      memorySampleCount: memorySamples.length,
      worksDigest,
      accountingDigest,
      finalizedEgressUpperBoundBytes:
        accountingResult.conservativeTickEgressUpperBoundBytes,
      completion,
      boundaries: {
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationNotStarted: true,
        soakNotStarted: true,
      },
    })
  } catch (error) {
    const recoveryError = error instanceof RecoveryError
      ? error
      : new RecoveryError(error instanceof Error ? error.message : String(error), true)
    if (claim !== null && recoveryError.terminal) {
      try {
        await postRpc<JsonObject>(
          supabaseUrl,
          secretKey,
          'xrpl_fail_r5_active_recovery_batch',
          {
            p_run_id: claim.runId,
            p_batch_id: claim.batchId,
            p_owner: owner,
            p_error_message: recoveryError.message,
            p_failed_at: new Date().toISOString(),
          },
          meter,
        )
      } catch {
        // The original fail-closed error remains authoritative.
      }
    }
    return json(
      {
        ok: false,
        transient: !recoveryError.terminal,
        runId: claim?.runId ?? RECOVERY_RUN_ID,
        batchId: claim?.batchId ?? null,
        error: recoveryError.message.slice(0, 2_000),
        activeMutationCommitted: false,
      },
      recoveryError.terminal ? 500 : 503,
    )
  }
})
