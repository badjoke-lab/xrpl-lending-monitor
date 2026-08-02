const PURPOSE = 'r4c2c-restore-continuation-qualification'
const PURPOSE_HEADER = 'x-xrpl-reader-purpose'
const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'
const ACTIVE_PROFILE_ID = 'supabase-devnet'
const RESTORED_SOURCE_PROFILE_ID = 'supabase-devnet-restore-continuation-source'
const TARGET_ID = 'supabase-devnet-restore-continuation-v1'
const FIXTURE_ID = 'r4c2c-post-restore-continuation-v1'

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
type PrepareResult = {
  prepared: boolean
  duplicate: boolean
  continued: boolean
  sourceProfileId: string
  targetId: string
  anchorWorkId: string
  continuationWorkId: string
  anchorLedgerIndex: number
  anchorLedgerHash: string
  continuationLedgerIndex: number
  continuationLedgerHash: string
  sourceStateDigest: string
  sourceRowCounts: Json
  pendingMessageId?: string
}
type ClaimResult = {
  claimed: boolean
  reason?: string
  reclaimed?: boolean
  messageId?: string
  phase?: 'scan' | 'commit' | 'finalize'
  payload?: Json
  attemptCount?: number
  leaseExpiresAt?: string
}
type CompletionResult = {
  completed: boolean
  duplicate?: boolean
  reason?: string
  workId?: string
  ledgerIndex?: number
  ledgerHash?: string
  successorMessageId?: string
  successorPhase?: string
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
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`)
  }
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
  const hash = requireString(value, name).toUpperCase()
  if (!/^[A-F0-9]{64}$/u.test(hash)) throw new Error(`${name} must be a canonical hash`)
  return hash
}

async function postRpc<T>(
  supabaseUrl: string,
  key: string,
  functionName: string,
  body: Json,
  timeout = 60_000,
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

function verifyActiveIsolation(before: ActiveWatermark, after: ActiveWatermark): Json {
  if (
    before.profileId !== after.profileId
    || before.network !== after.network
    || before.epochId !== after.epochId
    || before.baseIdentity !== after.baseIdentity
    || after.ledgerIndex < before.ledgerIndex
  ) {
    throw new Error('restore continuation changed or regressed active source identity')
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

function verifyPrepare(value: PrepareResult): void {
  if (
    value.prepared !== true
    || value.sourceProfileId !== RESTORED_SOURCE_PROFILE_ID
    || value.targetId !== TARGET_ID
    || value.continuationLedgerIndex !== value.anchorLedgerIndex + 1
    || !/^[A-F0-9]{64}$/u.test(value.anchorLedgerHash)
    || !/^[A-F0-9]{64}$/u.test(value.continuationLedgerHash)
    || !/^[a-f0-9]{64}$/u.test(value.sourceStateDigest)
    || !value.anchorWorkId
    || !value.continuationWorkId
    || value.anchorWorkId === value.continuationWorkId
  ) {
    throw new Error('restored continuation preparation identity is invalid')
  }
  const expectedFixedCounts = {
    streams: 1,
    work: 1,
    watermarks: 1,
    messages: 1,
    successors: 0,
  }
  for (const [key, expected] of Object.entries(expectedFixedCounts)) {
    if (value.sourceRowCounts?.[key] !== expected) {
      throw new Error(`restored continuation source count ${key} changed`)
    }
  }
  for (const key of ['payloadChunks', 'referenceRows', 'commitChunks']) {
    if (!Number.isSafeInteger(value.sourceRowCounts?.[key]) || Number(value.sourceRowCounts[key]) < 1) {
      throw new Error(`restored continuation source count ${key} is invalid`)
    }
  }
}

function phasePayload(claim: ClaimResult): { messageId: string; phase: 'scan' | 'commit' | 'finalize' } {
  if (!claim.claimed || !claim.messageId || !claim.phase || !claim.payload) {
    throw new Error('restored continuation claim is incomplete')
  }
  const payload = requireRecord(claim.payload, 'claim payload')
  if (
    payload.schemaVersion !== 1
    || payload.phase !== claim.phase
    || payload.messageId !== claim.messageId
  ) {
    throw new Error('restored continuation claim identity changed')
  }
  return { messageId: claim.messageId, phase: claim.phase }
}

async function completePhase(
  supabaseUrl: string,
  key: string,
  owner: string,
  messageId: string,
  phase: 'scan' | 'commit' | 'finalize',
  completedAt: string,
): Promise<CompletionResult> {
  const functionName = phase === 'scan'
    ? 'xrpl_complete_restored_continuation_scan'
    : phase === 'commit'
      ? 'xrpl_complete_restored_continuation_commit'
      : 'xrpl_complete_restored_continuation_finalize'
  const result = await postRpc<CompletionResult>(supabaseUrl, key, functionName, {
    p_owner: owner,
    p_message_id: messageId,
    p_completed_at: completedAt,
  })
  if (result.completed !== true) {
    throw new Error(`${phase} completion failed: ${result.reason ?? 'unknown'}`)
  }
  return result
}

function verifyEvidence(value: Json, prepare: PrepareResult): Json {
  if (
    value.schemaVersion !== 1
    || value.fixtureId !== FIXTURE_ID
    || value.sourceProfileId !== RESTORED_SOURCE_PROFILE_ID
    || value.activeProfileId !== ACTIVE_PROFILE_ID
    || value.targetId !== TARGET_ID
    || value.sourceStateDigest !== prepare.sourceStateDigest
    || value.continuedAt === null
  ) {
    throw new Error('restored continuation evidence identity is invalid')
  }

  const anchor = requireRecord(value.anchor, 'anchor')
  const continuation = requireRecord(value.continuation, 'continuation')
  const watermark = requireRecord(value.targetWatermark, 'target watermark')
  const work = requireRecord(value.targetWork, 'target work')
  const activeWork = requireRecord(value.activeSourceWork, 'active source work')
  const checks = requireRecord(value.checks, 'checks')

  if (
    anchor.workId !== prepare.anchorWorkId
    || anchor.ledgerIndex !== prepare.anchorLedgerIndex
    || anchor.ledgerHash !== prepare.anchorLedgerHash
    || continuation.workId !== prepare.continuationWorkId
    || continuation.ledgerIndex !== prepare.continuationLedgerIndex
    || continuation.ledgerHash !== prepare.continuationLedgerHash
    || watermark.profile_id !== RESTORED_SOURCE_PROFILE_ID
    || watermark.ledger_index !== prepare.continuationLedgerIndex
    || watermark.ledger_hash !== prepare.continuationLedgerHash
    || watermark.work_id !== prepare.continuationWorkId
    || work.profile_id !== RESTORED_SOURCE_PROFILE_ID
    || work.work_id !== prepare.continuationWorkId
    || work.status !== 'committed'
    || activeWork.profile_id !== ACTIVE_PROFILE_ID
    || activeWork.work_id !== prepare.continuationWorkId
    || activeWork.status !== 'committed'
  ) {
    throw new Error('restored continuation work or watermark parity failed')
  }

  for (const check of [
    'continued',
    'watermarkAdvancedExactlyOne',
    'watermarkMatchesDurableSource',
    'workCommitted',
    'committedRowsOnly',
    'rowCountParity',
    'rowDigestParity',
    'sourceReboundExplicitly',
  ]) {
    if (checks[check] !== true) throw new Error(`restored continuation check ${check} failed`)
  }

  if (
    value.continuationRowCount !== value.activeContinuationRowCount
    || value.continuationRowsDigest !== value.activeContinuationRowsDigest
    || !/^[a-f0-9]{64}$/u.test(requireString(value.continuationRowsDigest, 'row digest'))
    || !/^[a-f0-9]{64}$/u.test(requireString(value.targetStateDigest, 'target state digest'))
  ) {
    throw new Error('restored continuation committed-row parity failed')
  }

  if (!Array.isArray(value.phaseSequence)) throw new Error('phase sequence is missing')
  const completed = value.phaseSequence
    .map((entry) => requireRecord(entry, 'phase sequence entry'))
    .filter((entry) => entry.status === 'completed')
  const pending = value.phaseSequence
    .map((entry) => requireRecord(entry, 'phase sequence entry'))
    .filter((entry) => entry.status === 'pending')
  if (
    completed.length < 3
    || completed[0]?.phase !== 'scan'
    || completed.at(-1)?.phase !== 'finalize'
    || completed.slice(1, -1).some((entry) => entry.phase !== 'commit')
    || completed.some((entry) => entry.attemptCount !== 1)
    || pending.length !== 1
    || pending[0]?.phase !== 'scan'
    || pending[0]?.attemptCount !== 0
  ) {
    throw new Error('restored continuation phase sequence is invalid')
  }

  const rowCounts = requireRecord(value.rowCounts, 'row counts')
  if (
    rowCounts.streams !== 1
    || rowCounts.work !== 2
    || rowCounts.watermarks !== 1
    || rowCounts.messages !== completed.length + 1
    || rowCounts.successors !== completed.length
    || rowCounts.payloadChunks !== Number(prepare.sourceRowCounts.payloadChunks)
      + Number(activeWork.expected_payload_chunks)
    || rowCounts.commitChunks !== Number(prepare.sourceRowCounts.commitChunks)
      + Number(activeWork.expected_commit_chunks)
    || rowCounts.referenceRows !== Number(prepare.sourceRowCounts.referenceRows)
      + Number(value.continuationRowCount)
  ) {
    throw new Error('restored continuation aggregate row counts changed')
  }

  return {
    phaseSequence: value.phaseSequence,
    messageStatusCounts: value.messageStatusCounts,
    rowCounts,
    continuationRowCount: value.continuationRowCount,
    continuationRowsDigest: value.continuationRowsDigest,
    targetStateDigest: value.targetStateDigest,
    checks,
  }
}

async function execute(): Promise<Json> {
  const supabaseUrl = env('SUPABASE_URL')
  const key = serviceKey()
  const activeBefore = await activeWatermark(supabaseUrl, key)
  const prepare = await postRpc<PrepareResult>(
    supabaseUrl,
    key,
    'xrpl_prepare_restored_continuation',
    { p_now: new Date().toISOString() },
  )
  verifyPrepare(prepare)

  const owner = `restore-continuation-${crypto.randomUUID()}`
  const started = Date.now()
  const executions: Json[] = []

  if (!prepare.continued) {
    for (let step = 0; step < 260; step += 1) {
      const claimAt = new Date(started + step * 1_000).toISOString()
      const claim = await postRpc<ClaimResult>(
        supabaseUrl,
        key,
        'xrpl_claim_restored_continuation_phase',
        { p_owner: owner, p_now: claimAt, p_lease_seconds: 45 },
      )
      if (!claim.claimed) {
        const evidence = await postRpc<Json>(
          supabaseUrl,
          key,
          'xrpl_read_restored_continuation_evidence',
          {},
        )
        if (requireRecord(evidence.checks, 'checks').continued === true) break
        throw new Error(`restored continuation stopped before finalize: ${claim.reason ?? 'unknown'}`)
      }
      const identity = phasePayload(claim)
      if (claim.attemptCount !== 1 || claim.reclaimed === true) {
        throw new Error('restored continuation initial execution did not use a fresh first attempt')
      }
      const completedAt = new Date(started + step * 1_000 + 100).toISOString()
      const completion = await completePhase(
        supabaseUrl,
        key,
        owner,
        identity.messageId,
        identity.phase,
        completedAt,
      )
      if (completion.duplicate === true) {
        throw new Error('restored continuation initial completion was unexpectedly duplicate')
      }
      executions.push({
        phase: identity.phase,
        messageId: identity.messageId,
        attemptCount: claim.attemptCount,
        completion,
      })
      if (identity.phase === 'finalize') break
    }
  }

  const evidence = await postRpc<Json>(
    supabaseUrl,
    key,
    'xrpl_read_restored_continuation_evidence',
    {},
  )
  const verifiedEvidence = verifyEvidence(evidence, prepare)

  const completedMessages = (evidence.phaseSequence as unknown[])
    .map((entry) => requireRecord(entry, 'phase sequence entry'))
    .filter((entry) => entry.status === 'completed')
  const duplicateReplay: Json[] = []
  for (let index = 0; index < completedMessages.length; index += 1) {
    const message = completedMessages[index]!
    const phase = requireString(message.phase, 'duplicate phase') as 'scan' | 'commit' | 'finalize'
    if (!['scan', 'commit', 'finalize'].includes(phase)) {
      throw new Error(`unsupported duplicate replay phase: ${phase}`)
    }
    const messageId = requireString(message.messageId, 'duplicate messageId')
    const completion = await completePhase(
      supabaseUrl,
      key,
      owner,
      messageId,
      phase,
      new Date(started + 300_000 + index * 1_000).toISOString(),
    )
    if (completion.duplicate !== true) {
      throw new Error(`duplicate ${phase} replay did not converge`)
    }
    duplicateReplay.push({ phase, messageId, duplicate: true })
  }

  const activeAfter = await activeWatermark(supabaseUrl, key)
  const activeIsolation = verifyActiveIsolation(activeBefore, activeAfter)

  return {
    schemaVersion: 1,
    purpose: PURPOSE,
    fixtureId: FIXTURE_ID,
    sourceProfileId: RESTORED_SOURCE_PROFILE_ID,
    activeProfileId: ACTIVE_PROFILE_ID,
    targetId: TARGET_ID,
    prepare,
    executions,
    duplicateReplay,
    evidence: verifiedEvidence,
    activeWatermarkBefore: activeBefore,
    activeWatermarkAfter: activeAfter,
    activeIsolation,
    checks: {
      emptyTargetRestoreParity: true,
      pendingScanRestored: true,
      standardPhaseContinuation: true,
      watermarkAdvancedExactlyOne: true,
      committedRowParity: true,
      explicitSourceRebinding: true,
      duplicatePhaseReplayConverged: true,
      activeProfileIsolated: true,
      postRestoreContinuationProved: true,
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
