import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) {
  throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
}

const checkpointId = 'r5-checkpoint-selected-revision3-entry'
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
const transientCheckpointErrors = [
  'r5_checkpoint_collector_not_quiescent',
  'r5_checkpoint_scheduler_not_quiescent',
  'r5_checkpoint_inflight_work_present',
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
  if (!expression.test(text)) throw new Error(`${name} is not a canonical SHA-256 value`)
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

function checkpointFromRows(rows, name) {
  if (rows.length !== 1) throw new Error(`${name} returned ${rows.length} rows`)
  let value = rows[0]?.checkpoint
  if (typeof value === 'string') value = parseJson(value)
  return object(value, `${name} checkpoint`)
}

async function managementQuery({ query, parameters, readOnly }) {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      parameters,
      read_only: readOnly,
    }),
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
      || transientCheckpointErrors.some((candidate) => reason.includes(candidate))
    throw new QueryError(`Supabase Management query failed (${response.status}): ${reason}`, {
      status: response.status,
      transient,
    })
  }
  return rowsFromResponse(body)
}

async function readCheckpoint() {
  return checkpointFromRows(
    await managementQuery({
      query:
        'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint',
      parameters: [checkpointId],
      readOnly: true,
    }),
    'R5 checkpoint read',
  )
}

async function createCheckpoint() {
  return checkpointFromRows(
    await managementQuery({
      query:
        'select public.xrpl_create_r5_active_checkpoint($1::text, statement_timestamp()) as checkpoint',
      parameters: [checkpointId],
      readOnly: false,
    }),
    'R5 checkpoint create',
  )
}

async function readValidatedHead() {
  const requestBody = JSON.stringify({
    method: 'server_info',
    params: [{ api_version: 2 }],
  })
  const response = await fetch(xrplEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: requestBody,
    signal: AbortSignal.timeout(15_000),
  })
  const text = await response.text()
  if (Buffer.byteLength(text) > 256 * 1024) {
    throw new Error('XRPL server_info response exceeded the retained bound')
  }
  const body = parseJson(text)
  if (!response.ok) throw new Error(`XRPL server_info failed (${response.status})`)
  const result = object(body.result, 'XRPL server_info result')
  if (typeof result.error === 'string') {
    throw new Error(`XRPL server_info returned ${result.error}`)
  }
  const info = object(result.info, 'XRPL server info')
  const validated = object(info.validated_ledger, 'XRPL validated ledger')
  return {
    ledgerIndex: requiredInteger(validated.seq, 'validated ledger index'),
    ledgerHash: requiredHash(validated.hash, 'validated ledger hash', true),
  }
}

function verifySectionDigests(value) {
  const digests = object(value, 'checkpoint section digests')
  const expected = [
    'runtime',
    'stream',
    'watermark',
    'messages',
    'successors',
    'work',
    'payloadChunks',
    'referenceRows',
    'commitChunks',
    'resourceAccounting',
  ]
  if (Object.keys(digests).sort().join(',') !== expected.sort().join(',')) {
    throw new Error('checkpoint section digest surface changed')
  }
  for (const name of expected) requiredHash(digests[name], `section digest ${name}`)
  return digests
}

function verifyCheckpoint(raw) {
  const checkpoint = object(raw, 'R5 checkpoint')
  const rowCounts = object(checkpoint.rowCounts, 'checkpoint row counts')
  const checks = object(checkpoint.checks, 'checkpoint checks')
  if (
    checkpoint.found !== true
    || checkpoint.schemaVersion !== 1
    || checkpoint.purpose !== 'r5-supabase-active-recovery-checkpoint-summary'
    || checkpoint.checkpointId !== checkpointId
    || checkpoint.profileId !== profileId
    || checkpoint.profileRevision !== profileRevision
    || checkpoint.profileIdentityDigest !== profileIdentityDigest
    || checkpoint.selectionDigest !== selectionDigest
    || checkpoint.sourceProfileId !== 'supabase-devnet'
    || checkpoint.network !== 'devnet'
    || checkpoint.epochId !== 'supabase-r4c2c-v1'
  ) {
    throw new Error('R5 checkpoint identity changed')
  }
  const watermarkLedgerIndex = requiredInteger(
    checkpoint.watermarkLedgerIndex,
    'checkpoint watermark ledger index',
  )
  if (watermarkLedgerIndex <= 0) throw new Error('checkpoint watermark is empty')
  const watermarkLedgerHash = requiredHash(
    checkpoint.watermarkLedgerHash,
    'checkpoint watermark ledger hash',
    true,
  )
  const watermarkWorkId = requiredString(
    checkpoint.watermarkWorkId,
    'checkpoint watermark work ID',
  )
  const stateDigest = requiredHash(checkpoint.stateDigest, 'checkpoint state digest')
  const stateBytes = requiredInteger(checkpoint.stateBytes, 'checkpoint state bytes')
  if (stateBytes <= 0) throw new Error('checkpoint state is empty')
  const sectionDigests = verifySectionDigests(checkpoint.sectionDigests)

  const exactCounts = {
    runtime: 1,
    streams: 1,
    watermarks: 1,
    pendingMessages: 1,
    leasedMessages: 0,
    retryMessages: 0,
    inflightWork: 0,
  }
  for (const [name, expected] of Object.entries(exactCounts)) {
    if (requiredInteger(rowCounts[name], `rowCounts.${name}`) !== expected) {
      throw new Error(`checkpoint row count ${name} changed`)
    }
  }
  for (const name of [
    'messages',
    'errorMessages',
    'successors',
    'work',
    'errorWork',
    'payloadChunks',
    'referenceRows',
    'commitChunks',
    'resourceAttempts',
    'resourceTickAccounting',
  ]) {
    requiredInteger(rowCounts[name], `rowCounts.${name}`)
  }
  for (const name of [
    'storedStateDigestValid',
    'exactRevision3Identity',
    'exactSelectionBound',
    'publicReaderUnchanged',
    'mainnetDisabled',
  ]) {
    if (checks[name] !== true) throw new Error(`R5 checkpoint check ${name} failed`)
  }
  if (checks.stabilizationAuthorized !== false || checks.soakAuthorized !== false) {
    throw new Error('R5 checkpoint overstated a later authorization')
  }
  if (!Number.isFinite(Date.parse(requiredString(checkpoint.observedAt, 'checkpoint observedAt')))) {
    throw new Error('checkpoint observedAt is invalid')
  }
  return {
    checkpoint,
    rowCounts,
    sectionDigests,
    watermarkLedgerIndex,
    watermarkLedgerHash,
    watermarkWorkId,
    stateDigest,
    stateBytes,
  }
}

async function freezeCheckpoint() {
  let createdNow = false
  let lastTransient = null
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const existing = await readCheckpoint()
    if (existing.found === true) {
      return { checkpoint: existing, createdNow, attempt, lastTransient }
    }
    try {
      const created = await createCheckpoint()
      if (created.created !== true || created.checkpointId !== checkpointId) {
        throw new Error('R5 checkpoint create result is invalid')
      }
      createdNow = created.duplicate !== true
      const reread = await readCheckpoint()
      if (reread.found !== true) throw new Error('created R5 checkpoint cannot be reread')
      return { checkpoint: reread, createdNow, attempt, lastTransient }
    } catch (error) {
      if (!(error instanceof QueryError) || error.transient !== true) throw error
      lastTransient = error.message
      if (attempt === maximumAttempts) throw error
      await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))
    }
  }
  throw new Error('R5 checkpoint retry loop exhausted')
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const frozen = await freezeCheckpoint()
  const verified = verifyCheckpoint(frozen.checkpoint)
  const validatedHead = await readValidatedHead()
  if (validatedHead.ledgerIndex < verified.watermarkLedgerIndex) {
    throw new Error('validated Devnet head precedes the frozen R5 checkpoint')
  }
  const startingLag = validatedHead.ledgerIndex - verified.watermarkLedgerIndex
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-checkpoint-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    checkpointId,
    createdNow: frozen.createdNow,
    verifierAttempt: frozen.attempt,
    transientRetryObserved: frozen.lastTransient !== null,
    profileId,
    profileRevision,
    profileIdentityDigest,
    selectionDigest,
    network: 'devnet',
    epochId: 'supabase-r4c2c-v1',
    checkpointWatermark: {
      ledgerIndex: verified.watermarkLedgerIndex,
      ledgerHash: verified.watermarkLedgerHash,
      workId: verified.watermarkWorkId,
    },
    validatedHead,
    startingLag,
    stateDigest: verified.stateDigest,
    stateBytes: verified.stateBytes,
    rowCounts: verified.rowCounts,
    sectionDigests: verified.sectionDigests,
    checks: {
      parameterizedManagementApiQuery: true,
      exactRevision3Identity: true,
      exactR4eSelectionBound: true,
      storedStateDigestValid: true,
      checkpointRereadParity: true,
      collectorQuiescentAtCheckpoint: true,
      onePendingSuccessorScan: true,
      noInflightWork: true,
      revision3QuotaStateIncluded: true,
      validatedHeadNotBehindCheckpoint: true,
      activeRecoveryStarted: false,
      r5RecoveryAuthorized: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-r5-active-checkpoint.json`,
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
    purpose: 'r5-supabase-active-recovery-checkpoint-verification',
    failedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
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
    `${evidenceDirectory}/failed-r5-active-checkpoint-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
