import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')

const checkpointId = 'r5-checkpoint-selected-revision3-entry'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'

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

function requiredHash(value, name) {
  const text = requiredString(value, name)
  if (!/^[A-F0-9]{64}$/.test(text)) throw new Error(`${name} is not canonical hex`)
  return text
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rows(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API query response does not contain rows')
}

async function query(sql, parameters, readOnly) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ query: sql, parameters, read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    const reason = typeof body?.message === 'string'
      ? body.message
      : typeof body?.error === 'string'
        ? body.error
        : JSON.stringify(body)
    throw new Error(`Supabase Management query failed (${response.status}): ${reason.slice(0, 2_000)}`)
  }
  return rows(body)
}

function valueFromRows(resultRows, field, name) {
  if (resultRows.length !== 1) throw new Error(`${name} returned ${resultRows.length} rows`)
  let value = resultRows[0]?.[field]
  if (typeof value === 'string') value = parseJson(value)
  return object(value, name)
}

async function readCheckpoint() {
  return valueFromRows(
    await query(
      'select public.xrpl_read_r5_active_checkpoint($1::text) as checkpoint',
      [checkpointId],
      true,
    ),
    'checkpoint',
    'R5 checkpoint read',
  )
}

async function drainBoundary() {
  const owner = `r5-checkpoint-drain-${process.env.GITHUB_RUN_ID ?? 'manual'}`
  return valueFromRows(
    await query(
      'select public.xrpl_drain_r5_checkpoint_boundary($1::text, statement_timestamp()) as drain',
      [owner],
      false,
    ),
    'drain',
    'R5 checkpoint drain',
  )
}

function boundary(value, name) {
  const parsed = object(value, name)
  return {
    ledgerIndex: requiredInteger(parsed.ledgerIndex, `${name}.ledgerIndex`),
    ledgerHash: requiredHash(parsed.ledgerHash, `${name}.ledgerHash`),
    workId: requiredString(parsed.workId, `${name}.workId`),
  }
}

function verifyDrain(raw) {
  const drain = object(raw, 'R5 checkpoint drain')
  const checks = object(drain.checks, 'R5 checkpoint drain checks')
  if (
    drain.drained !== true
    || drain.schemaVersion !== 1
    || drain.purpose !== 'r5-checkpoint-boundary-drain'
    || drain.profileId !== profileId
    || drain.profileRevision !== profileRevision
    || drain.profileIdentityDigest !== profileIdentityDigest
    || drain.sourceProfileId !== 'supabase-devnet'
    || drain.network !== 'devnet'
    || drain.epochId !== 'supabase-r4c2c-v1'
    || !Array.isArray(drain.drainedPhases)
  ) {
    throw new Error('R5 checkpoint drain identity changed')
  }
  const drainedStepCount = requiredInteger(drain.drainedStepCount, 'drainedStepCount')
  if (drainedStepCount !== drain.drainedPhases.length || drainedStepCount > 256) {
    throw new Error('R5 checkpoint drain step count changed')
  }
  for (const [index, candidate] of drain.drainedPhases.entries()) {
    const phase = object(candidate, `drained phase ${index + 1}`)
    if (
      phase.sequence !== index + 1
      || !['commit', 'finalize'].includes(phase.phase)
      || typeof phase.messageId !== 'string'
      || typeof phase.workId !== 'string'
      || typeof phase.successorMessageId !== 'string'
    ) {
      throw new Error(`drained phase ${index + 1} changed identity`)
    }
  }
  for (const name of [
    'collectorQuiescent',
    'activeStreamHealthy',
    'onlyExistingCommitOrFinalizeDrained',
    'noScanExecuted',
    'onePendingScan',
    'pendingScanBoundToWatermark',
    'noInflightWork',
    'watermarkIdentityPreserved',
    'publicReaderUnchanged',
    'mainnetDisabled',
  ]) {
    if (checks[name] !== true) throw new Error(`R5 checkpoint drain check ${name} failed`)
  }
  if (
    checks.activeRecoveryStarted !== false
    || checks.stabilizationAuthorized !== false
    || checks.soakAuthorized !== false
  ) {
    throw new Error('R5 checkpoint drain overstated execution or authorization')
  }
  const before = boundary(drain.watermarkBefore, 'watermarkBefore')
  const after = boundary(drain.watermarkAfter, 'watermarkAfter')
  if (after.ledgerIndex < before.ledgerIndex || after.ledgerIndex - before.ledgerIndex > 1) {
    throw new Error('R5 checkpoint drain advanced more than one existing work')
  }
  const pendingScan = object(drain.pendingScan, 'pending scan')
  if (
    requiredInteger(
      pendingScan.expectedPreviousLedgerIndex,
      'pendingScan.expectedPreviousLedgerIndex',
    ) !== after.ledgerIndex
    || requiredHash(
      pendingScan.expectedPreviousLedgerHash,
      'pendingScan.expectedPreviousLedgerHash',
    ) !== after.ledgerHash
  ) {
    throw new Error('R5 checkpoint drain pending scan is not bound to watermark')
  }
  return { drain, drainedStepCount, before, after, pendingScan }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const existing = await readCheckpoint()
  if (existing.found === true) {
    const evidence = {
      schemaVersion: 1,
      purpose: 'r5-supabase-checkpoint-boundary-drain-verification',
      verifiedAt: new Date().toISOString(),
      sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
      sourceCommit: process.env.GITHUB_SHA ?? null,
      checkpointId,
      skipped: true,
      reason: 'checkpoint_already_frozen',
      drainedStepCount: 0,
      drainedPhases: [],
      checks: {
        activeRecoveryStarted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }
    await writeFile(
      `${evidenceDirectory}/verified-r5-checkpoint-boundary-drain.json`,
      `${JSON.stringify(evidence, null, 2)}\n`,
    )
    console.log(JSON.stringify(evidence))
    return
  }

  const verified = verifyDrain(await drainBoundary())
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-checkpoint-boundary-drain-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    checkpointId,
    skipped: false,
    drainedStepCount: verified.drainedStepCount,
    drainedPhases: verified.drain.drainedPhases,
    watermarkBefore: verified.before,
    watermarkAfter: verified.after,
    pendingScan: verified.pendingScan,
    checks: {
      onlyExistingCommitOrFinalizeDrained: true,
      noScanExecuted: true,
      pendingScanBoundToWatermark: true,
      noInflightWork: true,
      watermarkIdentityPreserved: true,
      activeRecoveryStarted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-r5-checkpoint-boundary-drain.json`,
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
    purpose: 'r5-supabase-checkpoint-boundary-drain-verification',
    failedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
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
    `${evidenceDirectory}/failed-r5-checkpoint-boundary-drain-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
