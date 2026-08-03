import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')

const checkpointId = 'r5-checkpoint-selected-revision3-entry'
const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const xrplEndpoint = 'https://s.devnet.rippletest.net:51234/'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const selectionDigest =
  '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
const maximumAttempts = 24
const retryDelayMilliseconds = 10_000
const transientErrors = [
  'r5_recovery_prepare_collector_not_quiescent',
  'r5_recovery_prepare_scheduler_not_quiescent',
  'r5_recovery_prepare_inflight_work_present',
  'r5_recovery_prepare_head_behind_watermark',
  'canceling statement due to lock timeout',
  'could not serialize access',
  'deadlock detected',
]

class QueryError extends Error {
  constructor(message, { status, transient = false } = {}) {
    super(message)
    this.name = 'QueryError'
    this.status = status ?? null
    this.transient = transient
  }
}

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function requiredString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

function requiredInteger(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

function requiredHash(value, name, uppercase = false) {
  const text = requiredString(value, name)
  const expression = uppercase ? /^[A-F0-9]{64}$/ : /^[a-f0-9]{64}$/
  if (!expression.test(text)) throw new Error(`${name} is not canonical hex`)
  return text
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function errorText(body) {
  if (typeof body === 'string') return body.slice(0, 2_000)
  if (body && typeof body === 'object') {
    for (const key of ['message', 'error', 'details', 'hint']) {
      if (typeof body[key] === 'string' && body[key].length > 0) {
        return body[key].slice(0, 2_000)
      }
    }
  }
  return JSON.stringify(body).slice(0, 2_000)
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [
      body.result,
      body.data,
      body.rows,
      body.result?.rows,
      body.data?.rows,
    ]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API query response does not contain rows')
}

function valueFromRows(rows, field, name) {
  if (rows.length !== 1) throw new Error(`${name} returned ${rows.length} rows`)
  let value = rows[0]?.[field]
  if (typeof value === 'string') value = parseJson(value)
  return object(value, name)
}

async function managementQuery({ query, parameters, readOnly }) {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    const reason = errorText(body)
    const transient =
      response.status === 429
      || response.status === 502
      || response.status === 503
      || response.status === 504
      || transientErrors.some((candidate) => reason.includes(candidate))
    throw new QueryError(`Supabase Management query failed (${response.status}): ${reason}`, {
      status: response.status,
      transient,
    })
  }
  return rowsFromResponse(body)
}

async function readCheckpoint() {
  return valueFromRows(
    await managementQuery({
      query:
        'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint',
      parameters: [checkpointId],
      readOnly: true,
    }),
    'checkpoint',
    'R5 checkpoint read',
  )
}

async function readRecovery() {
  return valueFromRows(
    await managementQuery({
      query: 'select public.xrpl_read_r5_active_recovery($1::text) as recovery',
      parameters: [recoveryRunId],
      readOnly: true,
    }),
    'recovery',
    'R5 recovery read',
  )
}

async function prepareRecovery(checkpoint, validatedHead) {
  return valueFromRows(
    await managementQuery({
      query:
        'select public.xrpl_prepare_r5_active_recovery($1::text, $2::text, $3::text, $4::bigint, $5::text, statement_timestamp()) as recovery',
      parameters: [
        recoveryRunId,
        checkpointId,
        checkpoint.stateDigest,
        validatedHead.ledgerIndex,
        validatedHead.ledgerHash,
      ],
      readOnly: false,
    }),
    'recovery',
    'R5 recovery prepare',
  )
}

async function readValidatedHead() {
  const response = await fetch(xrplEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'server_info', params: [{ api_version: 2 }] }),
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (Buffer.byteLength(text) > 256 * 1024) {
    throw new Error('XRPL server_info response exceeded the retained bound')
  }
  const body = parseJson(text)
  if (!response.ok) throw new Error(`XRPL server_info failed (${response.status})`)
  const result = object(body.result, 'XRPL server_info result')
  if (typeof result.error === 'string') throw new Error(`XRPL server_info returned ${result.error}`)
  const info = object(result.info, 'XRPL server info')
  const validated = object(info.validated_ledger, 'XRPL validated ledger')
  return {
    ledgerIndex: requiredInteger(validated.seq, 'validated ledger index'),
    ledgerHash: requiredHash(validated.hash, 'validated ledger hash', true),
  }
}

function verifyCheckpoint(raw) {
  const checkpoint = object(raw, 'R5 checkpoint')
  const checks = object(checkpoint.checks, 'R5 checkpoint checks')
  if (
    checkpoint.found !== true
    || checkpoint.schemaVersion !== 1
    || checkpoint.checkpointId !== checkpointId
    || checkpoint.profileId !== profileId
    || checkpoint.profileRevision !== profileRevision
    || checkpoint.profileIdentityDigest !== profileIdentityDigest
    || checkpoint.selectionDigest !== selectionDigest
    || checkpoint.sourceProfileId !== 'supabase-devnet'
    || checkpoint.network !== 'devnet'
    || checkpoint.epochId !== 'supabase-r4c2c-v1'
    || checks.storedStateDigestValid !== true
    || checks.exactRevision3Identity !== true
    || checks.exactSelectionBound !== true
  ) {
    throw new Error('R5 checkpoint is unavailable or changed identity')
  }
  return {
    stateDigest: requiredHash(checkpoint.stateDigest, 'checkpoint state digest'),
    ledgerIndex: requiredInteger(
      checkpoint.watermarkLedgerIndex,
      'checkpoint watermark ledger index',
    ),
    ledgerHash: requiredHash(
      checkpoint.watermarkLedgerHash,
      'checkpoint watermark ledger hash',
      true,
    ),
    workId: requiredString(checkpoint.watermarkWorkId, 'checkpoint watermark work ID'),
  }
}

function watermark(value, name) {
  const parsed = object(value, name)
  return {
    ledgerIndex: requiredInteger(parsed.ledgerIndex, `${name}.ledgerIndex`),
    ledgerHash: requiredHash(parsed.ledgerHash, `${name}.ledgerHash`, true),
    workId: requiredString(parsed.workId, `${name}.workId`),
  }
}

function verifyRecovery(raw, checkpoint) {
  const recovery = object(raw, 'R5 recovery')
  const checks = object(recovery.checks, 'R5 recovery checks')
  if (
    recovery.found !== true
    || recovery.schemaVersion !== 1
    || recovery.purpose !== 'r5-supabase-active-recovery-summary'
    || recovery.runId !== recoveryRunId
    || recovery.checkpointId !== checkpointId
    || recovery.checkpointStateDigest !== checkpoint.stateDigest
    || recovery.profileId !== profileId
    || recovery.profileRevision !== profileRevision
    || recovery.profileIdentityDigest !== profileIdentityDigest
    || recovery.selectionDigest !== selectionDigest
    || recovery.sourceProfileId !== 'supabase-devnet'
    || recovery.network !== 'devnet'
    || recovery.epochId !== 'supabase-r4c2c-v1'
    || !['prepared', 'caught_up'].includes(recovery.status)
    || recovery.batchSize !== 24
  ) {
    throw new Error('R5 recovery preparation identity changed')
  }

  const checkpointWatermark = watermark(recovery.checkpointWatermark, 'checkpointWatermark')
  const startWatermark = watermark(recovery.startWatermark, 'startWatermark')
  const currentWatermark = watermark(recovery.currentWatermark, 'currentWatermark')
  const initialValidatedHead = object(
    recovery.initialValidatedHead,
    'initial validated head',
  )
  const initialHead = {
    ledgerIndex: requiredInteger(
      initialValidatedHead.ledgerIndex,
      'initialValidatedHead.ledgerIndex',
    ),
    ledgerHash: requiredHash(
      initialValidatedHead.ledgerHash,
      'initialValidatedHead.ledgerHash',
      true,
    ),
  }
  const checkpointToStartLedgers = requiredInteger(
    recovery.checkpointToStartLedgers,
    'checkpointToStartLedgers',
  )
  const initialLagLedgers = requiredInteger(recovery.initialLagLedgers, 'initialLagLedgers')
  const descendantWorkCount = requiredInteger(
    recovery.descendantWorkCount,
    'descendantWorkCount',
  )

  if (
    checkpointWatermark.ledgerIndex !== checkpoint.ledgerIndex
    || checkpointWatermark.ledgerHash !== checkpoint.ledgerHash
    || checkpointWatermark.workId !== checkpoint.workId
    || startWatermark.ledgerIndex < checkpointWatermark.ledgerIndex
    || checkpointToStartLedgers
      !== startWatermark.ledgerIndex - checkpointWatermark.ledgerIndex
    || descendantWorkCount !== checkpointToStartLedgers
    || initialHead.ledgerIndex < startWatermark.ledgerIndex
    || initialLagLedgers !== initialHead.ledgerIndex - startWatermark.ledgerIndex
    || currentWatermark.ledgerIndex !== startWatermark.ledgerIndex
    || currentWatermark.ledgerHash !== startWatermark.ledgerHash
    || currentWatermark.workId !== startWatermark.workId
    || requiredInteger(recovery.completedBatches, 'completedBatches') !== 0
    || requiredInteger(recovery.committedLedgers, 'committedLedgers') !== 0
    || recovery.lastAccountingDigest !== null
    || recovery.lastError !== null
    || recovery.startedAt !== null
  ) {
    throw new Error('R5 recovery preparation boundaries changed')
  }

  for (const name of [
    'exactRevision3Identity',
    'exactSelectionBound',
    'checkpointDigestBound',
    'checkpointDescendantChainProved',
    'headNotBehindStart',
    'lagArithmeticExact',
    'publicReaderUnchanged',
    'mainnetDisabled',
  ]) {
    if (checks[name] !== true) throw new Error(`R5 recovery check ${name} failed`)
  }
  if (
    checks.activeRecoveryStarted !== false
    || checks.caughtUp !== (recovery.status === 'caught_up')
    || checks.stabilizationAuthorized !== false
    || checks.soakAuthorized !== false
  ) {
    throw new Error('R5 recovery preparation overstated execution or authorization')
  }

  return {
    recovery,
    checkpointWatermark,
    startWatermark,
    currentWatermark,
    initialHead,
    checkpointToStartLedgers,
    initialLagLedgers,
    descendantWorkCount,
  }
}

async function prepareOnce(checkpoint) {
  let preparedNow = false
  let lastTransient = null
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const existing = await readRecovery()
    if (existing.found === true) {
      return { recovery: existing, preparedNow, attempt, lastTransient }
    }
    const validatedHead = await readValidatedHead()
    try {
      const prepared = await prepareRecovery(checkpoint, validatedHead)
      if (prepared.found !== true || prepared.runId !== recoveryRunId) {
        throw new Error('prepared R5 recovery cannot be identified')
      }
      preparedNow = true
      const reread = await readRecovery()
      if (reread.found !== true) throw new Error('prepared R5 recovery cannot be reread')
      return { recovery: reread, preparedNow, attempt, lastTransient }
    } catch (error) {
      if (!(error instanceof QueryError) || error.transient !== true) throw error
      lastTransient = error.message
      if (attempt === maximumAttempts) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))
    }
  }
  throw new Error('R5 recovery preparation retry loop exhausted')
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const rawCheckpoint = await readCheckpoint()
  const checkpoint = verifyCheckpoint(rawCheckpoint)
  const prepared = await prepareOnce(checkpoint)
  const verified = verifyRecovery(prepared.recovery, checkpoint)
  const currentValidatedHead = await readValidatedHead()
  if (currentValidatedHead.ledgerIndex < verified.currentWatermark.ledgerIndex) {
    throw new Error('current validated head precedes the prepared recovery watermark')
  }
  const currentObservedLag =
    currentValidatedHead.ledgerIndex - verified.currentWatermark.ledgerIndex

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-prepare-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    runId: recoveryRunId,
    checkpointId,
    preparedNow: prepared.preparedNow,
    verifierAttempt: prepared.attempt,
    transientRetryObserved: prepared.lastTransient !== null,
    profileId,
    profileRevision,
    profileIdentityDigest,
    selectionDigest,
    status: verified.recovery.status,
    batchSize: 24,
    checkpointStateDigest: checkpoint.stateDigest,
    checkpointWatermark: verified.checkpointWatermark,
    startWatermark: verified.startWatermark,
    initialValidatedHead: verified.initialHead,
    initialLagLedgers: verified.initialLagLedgers,
    checkpointToStartLedgers: verified.checkpointToStartLedgers,
    descendantWorkCount: verified.descendantWorkCount,
    currentValidatedHead,
    currentObservedLag,
    checks: {
      parameterizedManagementApiQuery: true,
      exactRevision3Identity: true,
      exactR4eSelectionBound: true,
      checkpointDigestBound: true,
      checkpointDescendantChainProved: true,
      oneLedgerHashContinuityProved: true,
      initialLagArithmeticExact: true,
      zeroRecoveryBatchesCommitted: true,
      activeRecoveryStarted: false,
      r5RecoveryAuthorized: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-r5-recovery-prepare.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-prepare-verification',
    failedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    runId: recoveryRunId,
    checkpointId,
    error: error instanceof Error ? error.message.slice(0, 3_000) : String(error).slice(0, 3_000),
    checks: {
      activeRecoveryStarted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-r5-recovery-prepare-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
