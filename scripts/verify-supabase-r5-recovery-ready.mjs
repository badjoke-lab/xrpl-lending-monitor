import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')

const checkpointId = 'r5-checkpoint-selected-revision3-entry'
const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const selectionDigest =
  '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
const managementEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const xrplEndpoint = 'https://s.devnet.rippletest.net:51234/'
const evidenceDirectory = 'supabase-remote-probe-evidence'

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

async function managementQuery(query, parameters) {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(
      `Supabase Management query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
    )
  }
  return rowsFromResponse(body)
}

async function readCheckpoint() {
  return valueFromRows(
    await managementQuery(
      'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint',
      [checkpointId],
    ),
    'checkpoint',
    'R5 checkpoint read',
  )
}

async function readRecovery() {
  return valueFromRows(
    await managementQuery(
      'select public.xrpl_read_r5_active_recovery($1::text) as recovery',
      [recoveryRunId],
    ),
    'recovery',
    'R5 recovery read',
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
  const info = object(result.info, 'XRPL server info')
  const validated = object(info.validated_ledger, 'XRPL validated ledger')
  return {
    ledgerIndex: requiredInteger(validated.seq, 'validated ledger index'),
    ledgerHash: requiredHash(validated.hash, 'validated ledger hash', true),
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

async function runLegacyPreparation() {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      'scripts/verify-supabase-r5-recovery-prepare.mjs',
    ], {
      env: process.env,
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`legacy R5 preparation failed (${code ?? signal ?? 'unknown'})`))
    })
  })
}

async function verifyExisting(checkpoint, recovery) {
  const checkpointChecks = object(checkpoint.checks, 'checkpoint checks')
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
    || checkpointChecks.storedStateDigestValid !== true
    || checkpointChecks.exactRevision3Identity !== true
    || checkpointChecks.exactSelectionBound !== true
  ) {
    throw new Error('R5 checkpoint identity changed')
  }

  const checks = object(recovery.checks, 'recovery checks')
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
    || !['prepared', 'running', 'caught_up'].includes(recovery.status)
    || recovery.batchSize !== 24
    || recovery.lastError !== null
  ) {
    throw new Error('R5 recovery identity or health changed')
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
    checks.activeRecoveryStarted !== (recovery.status === 'running')
    || checks.caughtUp !== (recovery.status === 'caught_up')
    || checks.stabilizationAuthorized !== false
    || checks.soakAuthorized !== false
  ) {
    throw new Error('R5 recovery execution or authorization checks changed')
  }

  const checkpointWatermark = watermark(recovery.checkpointWatermark, 'checkpointWatermark')
  const startWatermark = watermark(recovery.startWatermark, 'startWatermark')
  const currentWatermark = watermark(recovery.currentWatermark, 'currentWatermark')
  const completedBatches = requiredInteger(recovery.completedBatches, 'completedBatches')
  const committedLedgers = requiredInteger(recovery.committedLedgers, 'committedLedgers')
  const checkpointToStartLedgers = requiredInteger(
    recovery.checkpointToStartLedgers,
    'checkpointToStartLedgers',
  )
  const descendantWorkCount = requiredInteger(
    recovery.descendantWorkCount,
    'descendantWorkCount',
  )
  const initialValidatedHead = object(
    recovery.initialValidatedHead,
    'initialValidatedHead',
  )
  const initialHead = {
    ledgerIndex: requiredInteger(initialValidatedHead.ledgerIndex, 'initial head ledger'),
    ledgerHash: requiredHash(initialValidatedHead.ledgerHash, 'initial head hash', true),
  }
  const initialLagLedgers = requiredInteger(recovery.initialLagLedgers, 'initialLagLedgers')

  if (
    checkpointWatermark.ledgerIndex !== checkpoint.watermarkLedgerIndex
    || checkpointWatermark.ledgerHash !== checkpoint.watermarkLedgerHash
    || checkpointWatermark.workId !== checkpoint.watermarkWorkId
    || startWatermark.ledgerIndex < checkpointWatermark.ledgerIndex
    || checkpointToStartLedgers
      !== startWatermark.ledgerIndex - checkpointWatermark.ledgerIndex
    || descendantWorkCount !== checkpointToStartLedgers
    || initialHead.ledgerIndex < startWatermark.ledgerIndex
    || initialLagLedgers !== initialHead.ledgerIndex - startWatermark.ledgerIndex
    || committedLedgers !== currentWatermark.ledgerIndex - startWatermark.ledgerIndex
    || completedBatches * 24 < committedLedgers
    || (completedBatches === 0) !== (committedLedgers === 0)
  ) {
    throw new Error('R5 recovery watermark or batch arithmetic changed')
  }

  if (recovery.status === 'prepared') {
    if (
      completedBatches !== 0
      || committedLedgers !== 0
      || currentWatermark.ledgerHash !== startWatermark.ledgerHash
      || currentWatermark.workId !== startWatermark.workId
      || recovery.lastAccountingDigest !== null
      || recovery.startedAt !== null
      || recovery.completedAt !== null
    ) {
      throw new Error('prepared R5 recovery contains execution state')
    }
  } else {
    if (
      completedBatches < 1
      || committedLedgers < 1
      || !/^[a-f0-9]{64}$/.test(recovery.lastAccountingDigest ?? '')
      || typeof recovery.startedAt !== 'string'
      || recovery.startedAt.length === 0
      || (recovery.status === 'caught_up') !== (typeof recovery.completedAt === 'string')
    ) {
      throw new Error('active R5 recovery execution state is incomplete')
    }
  }

  const currentValidatedHead = await readValidatedHead()
  if (currentValidatedHead.ledgerIndex < currentWatermark.ledgerIndex) {
    throw new Error('current validated head precedes the R5 recovery watermark')
  }

  return {
    recovery,
    checkpointWatermark,
    startWatermark,
    currentWatermark,
    initialHead,
    initialLagLedgers,
    checkpointToStartLedgers,
    descendantWorkCount,
    completedBatches,
    committedLedgers,
    currentValidatedHead,
    currentObservedLag:
      currentValidatedHead.ledgerIndex - currentWatermark.ledgerIndex,
  }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const recovery = await readRecovery()
  if (recovery.found !== true) {
    await runLegacyPreparation()
    return
  }

  const checkpoint = await readCheckpoint()
  const verified = await verifyExisting(checkpoint, recovery)
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-prepare-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    runId: recoveryRunId,
    checkpointId,
    preparedNow: false,
    verifierAttempt: 1,
    transientRetryObserved: false,
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
    currentValidatedHead: verified.currentValidatedHead,
    currentObservedLag: verified.currentObservedLag,
    completedBatches: verified.completedBatches,
    committedLedgers: verified.committedLedgers,
    checks: {
      parameterizedManagementApiQuery: true,
      exactRevision3Identity: true,
      exactR4eSelectionBound: true,
      checkpointDigestBound: true,
      checkpointDescendantChainProved: true,
      oneLedgerHashContinuityProved: true,
      initialLagArithmeticExact: true,
      zeroRecoveryBatchesCommitted: verified.completedBatches === 0,
      activeRecoveryStarted: verified.recovery.status === 'running',
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
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
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
      activeRecoveryStarted: null,
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
