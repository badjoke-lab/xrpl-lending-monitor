import { canonicalPortableJson } from '../../../src/shared/portable-collector-reference-store.ts'

const PURPOSE = 'r4c2c-complete-state-transfer-qualification'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const TARGET_ID = 'supabase-devnet-transfer-restore-v1'
const EXPORT_ID = 'r4c2c-multichunk-complete-state-v1'
const ACTIVE_PROFILE_ID = 'supabase-devnet'
const EXPECTED_COUNTS = {
  streams: 1,
  work: 1,
  payloadChunks: 3,
  referenceRows: 116,
  commitChunks: 3,
  watermarks: 1,
  messages: 6,
  successors: 5,
  publicationCandidates: 1,
  publicationWork: 1,
  publicationWatermarks: 1,
  maintenancePlans: 1,
  maintenanceMutations: 2,
} as const

type Json = Record<string, unknown>
type ActiveWatermark = {
  profileId: string
  network: string
  epochId: string
  baseIdentity: string
  ledgerIndex: number
  ledgerHash: string
  workId: string
}
type ExportResult = {
  schemaVersion: number
  exportId: string
  sourceProfileId: string
  state: Json
  stateCanonicalText: string
  stateDigest: string
  rowCounts: Json
  seed: Json
}
type RestoreResult = {
  restored: boolean
  duplicate: boolean
  targetId: string
  stateDigest: string
  rowCounts: Json
  restoredAt: string
}
type RestoredRead = {
  schemaVersion: number
  targetId: string
  sourceExportId: string
  state: Json
  stateCanonicalText: string
  stateDigest: string
  rowCounts: Json
  restoredAt: string
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
  timeout = 30_000,
): Promise<T> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  })
  const text = await result.text()
  if (!result.ok) {
    throw new Error(`${functionName} failed (${result.status}): ${text.slice(0, 1_000)}`)
  }
  return JSON.parse(text) as T
}

async function expectRpcFailure(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
  expected: string,
): Promise<boolean> {
  const result = await fetch(`${supabaseUrl}/rest/v1/rpc/${functionName}`, {
    method: 'POST',
    headers: adminHeaders(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await result.text()
  if (result.ok || !text.includes(expected)) {
    throw new Error(
      `${functionName} did not fail with ${expected}: ${result.status}/${text.slice(0, 500)}`,
    )
  }
  return true
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

async function activeWatermark(supabaseUrl: string, key: string): Promise<ActiveWatermark> {
  const rows = await getRows<Json>(
    supabaseUrl,
    key,
    'xrpl_phase_watermarks?profile_id=eq.supabase-devnet&select=profile_id,network,epoch_id,base_identity,ledger_index,ledger_hash,work_id&limit=2',
  )
  if (rows.length !== 1) throw new Error(`active watermark returned ${rows.length} rows`)
  const row = rows[0]!
  const result = {
    profileId: requireString(row.profile_id, 'active profile_id'),
    network: requireString(row.network, 'active network'),
    epochId: requireString(row.epoch_id, 'active epoch_id'),
    baseIdentity: requireString(row.base_identity, 'active base_identity'),
    ledgerIndex: requireInteger(row.ledger_index, 'active ledger_index'),
    ledgerHash: requireHash(row.ledger_hash, 'active ledger_hash'),
    workId: requireString(row.work_id, 'active work_id'),
  }
  if (
    result.profileId !== ACTIVE_PROFILE_ID
    || result.network !== 'devnet'
    || result.epochId !== 'supabase-r4c2c-v1'
  ) {
    throw new Error('active watermark source identity changed')
  }
  return result
}

function assertCounts(value: Json, name: string): void {
  if (canonicalPortableJson(value) !== canonicalPortableJson(EXPECTED_COUNTS)) {
    throw new Error(`${name} row counts changed: ${canonicalPortableJson(value)}`)
  }
}

function arrayAt(state: Json, section: string, table: string): unknown[] {
  const sectionValue = requireRecord(state[section], `${section}`)
  const value = sectionValue[table]
  if (!Array.isArray(value)) throw new Error(`${section}.${table} must be an array`)
  return value
}

function verifyStateShape(state: Json): Json {
  if (state.schemaVersion !== 1) throw new Error('complete-state schema changed')
  const source = requireRecord(state.source, 'source')
  if (
    source.profileId !== 'supabase-devnet-multichunk-witness'
    || source.network !== 'devnet'
    || source.epochId !== 'supabase-r4c2c-v1'
    || source.baseIdentity !== 'multichunk-witness-2776760'
    || source.watermarkLedgerIndex !== 2_776_760
    || source.watermarkLedgerHash !== '83CD41036ADD7F9D8FA247F04BF5156B6826D95C4E6A346B9A5499BE90C43A9D'
  ) {
    throw new Error('complete-state source identity changed')
  }

  const streams = arrayAt(state, 'collection', 'streams')
  const work = arrayAt(state, 'collection', 'work')
  const payloadChunks = arrayAt(state, 'collection', 'payloadChunks')
  const referenceRows = arrayAt(state, 'collection', 'referenceRows')
  const commitChunks = arrayAt(state, 'collection', 'commitChunks')
  const watermarks = arrayAt(state, 'collection', 'watermarks')
  const messages = arrayAt(state, 'scheduler', 'messages')
  const successors = arrayAt(state, 'scheduler', 'successors')
  const publicationCandidates = arrayAt(state, 'publication', 'candidates')
  const publicationWork = arrayAt(state, 'publication', 'work')
  const publicationWatermarks = arrayAt(state, 'publication', 'watermarks')
  const maintenancePlans = arrayAt(state, 'maintenance', 'plans')
  const maintenanceMutations = arrayAt(state, 'maintenance', 'mutations')

  const counts = {
    streams: streams.length,
    work: work.length,
    payloadChunks: payloadChunks.length,
    referenceRows: referenceRows.length,
    commitChunks: commitChunks.length,
    watermarks: watermarks.length,
    messages: messages.length,
    successors: successors.length,
    publicationCandidates: publicationCandidates.length,
    publicationWork: publicationWork.length,
    publicationWatermarks: publicationWatermarks.length,
    maintenancePlans: maintenancePlans.length,
    maintenanceMutations: maintenanceMutations.length,
  }
  assertCounts(counts, 'complete-state')

  const sourceWork = requireRecord(work[0], 'source work')
  if (
    sourceWork.status !== 'committed'
    || sourceWork.expected_payload_chunks !== 3
    || sourceWork.expected_commit_chunks !== 3
  ) {
    throw new Error('complete-state work is not the committed three-chunk work')
  }
  if (payloadChunks.map((entry) => requireRecord(entry, 'payload chunk').record_count).join(',') !== '40,40,36') {
    throw new Error('complete-state payload chunk counts changed')
  }
  if (commitChunks.map((entry) => requireRecord(entry, 'commit chunk').row_mutation_count).join(',') !== '40,40,36') {
    throw new Error('complete-state commit chunk counts changed')
  }
  const statusCounts = messages.reduce<Record<string, number>>((countsByStatus, entry) => {
    const status = requireString(requireRecord(entry, 'message').status, 'message status')
    countsByStatus[status] = (countsByStatus[status] ?? 0) + 1
    return countsByStatus
  }, {})
  if (statusCounts.completed !== 5 || statusCounts.pending !== 1) {
    throw new Error(`complete-state scheduler status counts changed: ${canonicalPortableJson(statusCounts)}`)
  }
  const publication = requireRecord(publicationCandidates[0], 'publication candidate')
  const publicationWatermark = requireRecord(publicationWatermarks[0], 'publication watermark')
  const maintenancePlan = requireRecord(maintenancePlans[0], 'maintenance plan')
  if (
    publication.status !== 'verified'
    || publicationWatermark.ledger_index !== 2_776_760
    || maintenancePlan.status !== 'applied'
    || maintenanceMutations.some((entry) => requireRecord(entry, 'maintenance mutation').status !== 'applied')
  ) {
    throw new Error('publication or maintenance state is not verified and applied')
  }
  return { counts, schedulerStatusCounts: statusCounts }
}

function verifyActiveIsolation(before: ActiveWatermark, after: ActiveWatermark): Json {
  if (
    before.profileId !== after.profileId
    || before.network !== after.network
    || before.epochId !== after.epochId
    || before.baseIdentity !== after.baseIdentity
    || after.ledgerIndex < before.ledgerIndex
  ) {
    throw new Error('complete-state transfer changed or regressed the active source identity')
  }
  if (
    after.ledgerIndex === before.ledgerIndex
    && (after.ledgerHash !== before.ledgerHash || after.workId !== before.workId)
  ) {
    throw new Error('active watermark changed identity without advancing')
  }
  return {
    ledgerAdvance: after.ledgerIndex - before.ledgerIndex,
    nonRegressing: true,
    sourceIdentityPreserved: true,
  }
}

async function execute(): Promise<Json> {
  const supabaseUrl = env('SUPABASE_URL')
  const key = serviceKey()
  const activeBefore = await activeWatermark(supabaseUrl, key)

  const exported = await postRpc<ExportResult>(
    supabaseUrl,
    key,
    'xrpl_export_multichunk_complete_state',
    { p_now: new Date().toISOString() },
    60_000,
  )
  if (
    exported.schemaVersion !== 1
    || exported.exportId !== EXPORT_ID
    || exported.sourceProfileId !== 'supabase-devnet-multichunk-witness'
    || !/^[a-f0-9]{64}$/u.test(exported.stateDigest)
  ) {
    throw new Error('complete-state export identity is invalid')
  }
  if (await sha256(exported.stateCanonicalText) !== exported.stateDigest) {
    throw new Error('complete-state export digest does not match canonical text')
  }
  const sourceShape = verifyStateShape(exported.state)
  assertCounts(exported.rowCounts, 'export')

  const firstRestore = await postRpc<RestoreResult>(
    supabaseUrl,
    key,
    'xrpl_restore_multichunk_complete_state',
    {
      p_target_id: TARGET_ID,
      p_source_export_id: EXPORT_ID,
      p_state: exported.state,
      p_state_digest: exported.stateDigest,
      p_restored_at: new Date().toISOString(),
    },
    60_000,
  )
  if (
    firstRestore.restored !== true
    || firstRestore.targetId !== TARGET_ID
    || firstRestore.stateDigest !== exported.stateDigest
  ) {
    throw new Error('first complete-state restore result is invalid')
  }
  assertCounts(firstRestore.rowCounts, 'first restore')

  const restored = await postRpc<RestoredRead>(
    supabaseUrl,
    key,
    'xrpl_read_restored_multichunk_complete_state',
    {},
    60_000,
  )
  if (
    restored.schemaVersion !== 1
    || restored.targetId !== TARGET_ID
    || restored.sourceExportId !== EXPORT_ID
    || restored.stateDigest !== exported.stateDigest
    || restored.stateCanonicalText !== exported.stateCanonicalText
    || canonicalPortableJson(restored.state) !== canonicalPortableJson(exported.state)
    || await sha256(restored.stateCanonicalText) !== restored.stateDigest
  ) {
    throw new Error('restored complete-state canonical parity failed')
  }
  const restoredShape = verifyStateShape(restored.state)
  assertCounts(restored.rowCounts, 'restored read')

  const duplicateRestore = await postRpc<RestoreResult>(
    supabaseUrl,
    key,
    'xrpl_restore_multichunk_complete_state',
    {
      p_target_id: TARGET_ID,
      p_source_export_id: EXPORT_ID,
      p_state: exported.state,
      p_state_digest: exported.stateDigest,
      p_restored_at: new Date().toISOString(),
    },
    60_000,
  )
  if (
    duplicateRestore.restored !== true
    || duplicateRestore.duplicate !== true
    || duplicateRestore.stateDigest !== exported.stateDigest
  ) {
    throw new Error('duplicate complete-state restore did not converge')
  }

  const tamperedDigest = `${exported.stateDigest.slice(0, -1)}${exported.stateDigest.endsWith('0') ? '1' : '0'}`
  const digestTamperRejected = await expectRpcFailure(
    supabaseUrl,
    key,
    'xrpl_restore_multichunk_complete_state',
    {
      p_target_id: TARGET_ID,
      p_source_export_id: EXPORT_ID,
      p_state: exported.state,
      p_state_digest: tamperedDigest,
      p_restored_at: new Date().toISOString(),
    },
    'restore_digest_mismatch',
  )

  const activeAfter = await activeWatermark(supabaseUrl, key)
  const activeIsolation = verifyActiveIsolation(activeBefore, activeAfter)

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    exportId: exported.exportId,
    targetId: TARGET_ID,
    stateDigest: exported.stateDigest,
    sourceStateCanonicalText: exported.stateCanonicalText,
    restoredStateCanonicalText: restored.stateCanonicalText,
    rowCounts: exported.rowCounts,
    sourceShape,
    restoredShape,
    firstRestoreDuplicate: firstRestore.duplicate,
    duplicateRestoreConverged: true,
    digestTamperRejected,
    typedRestoreNamespace: 'xrpl_restore_v1',
    activeIsolation,
    activeWatermarkBefore: activeBefore,
    activeWatermarkAfter: activeAfter,
    checks: {
      collectionStateIncluded: true,
      schedulerStateIncluded: true,
      publicationStateIncluded: true,
      maintenanceStateIncluded: true,
      emptyTargetRestoreObserved: firstRestore.duplicate === false,
      canonicalTextParity: true,
      digestParity: true,
      duplicateRestoreConverged: true,
      digestTamperRejected,
      activeProfileIsolated: true,
      postRestoreContinuationProved: false,
    },
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
        error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
      },
      500,
    )
  }
})
