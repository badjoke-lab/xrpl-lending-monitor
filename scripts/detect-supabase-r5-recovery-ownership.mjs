import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
const outputPath = process.env.GITHUB_OUTPUT ?? ''
if (outputPath.length === 0) throw new Error('GITHUB_OUTPUT is unavailable')

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const selectionDigest =
  '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
const managementEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const evidenceDirectory = 'supabase-remote-probe-evidence'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
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

async function readRecovery() {
  const response = await fetch(managementEndpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: 'select public.xrpl_read_r5_active_recovery($1::text) as recovery',
      parameters: [recoveryRunId],
      read_only: true,
    }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(
      `Supabase Management recovery ownership read failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
    )
  }
  const rows = rowsFromResponse(body)
  if (rows.length !== 1) throw new Error(`R5 ownership read returned ${rows.length} rows`)
  let recovery = rows[0]?.recovery
  if (typeof recovery === 'string') recovery = parseJson(recovery)
  return object(recovery, 'R5 recovery ownership')
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const recovery = await readRecovery()
  let activeRecoveryOwned = false
  let status = 'absent'

  if (recovery.found === true) {
    if (
      recovery.schemaVersion !== 1
      || recovery.purpose !== 'r5-supabase-active-recovery-summary'
      || recovery.runId !== recoveryRunId
      || recovery.profileId !== profileId
      || recovery.profileRevision !== profileRevision
      || recovery.profileIdentityDigest !== profileIdentityDigest
      || recovery.selectionDigest !== selectionDigest
      || recovery.sourceProfileId !== 'supabase-devnet'
      || recovery.network !== 'devnet'
      || recovery.epochId !== 'supabase-r4c2c-v1'
      || !['prepared', 'running', 'caught_up', 'halted'].includes(recovery.status)
    ) {
      throw new Error('R5 recovery ownership identity or status changed')
    }
    activeRecoveryOwned = true
    status = recovery.status
  } else if (recovery.found !== false) {
    throw new Error('R5 recovery ownership found flag is invalid')
  }

  await writeFile(
    outputPath,
    `active_recovery_owned=${activeRecoveryOwned}\nrecovery_status=${status}\n`,
    { flag: 'a' },
  )

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-ownership-detection',
    detectedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    recoveryRunId,
    recoveryFound: recovery.found === true,
    recoveryStatus: status,
    activeRecoveryOwned,
    checks: {
      exactRevision3Identity: recovery.found !== true || recovery.profileRevision === 3,
      activeProbeMustBeSkipped: activeRecoveryOwned,
      failClosedOnMalformedRecovery: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/r5-recovery-ownership.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  await writeFile(
    `${evidenceDirectory}/failed-r5-recovery-ownership-detection.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      purpose: 'r5-supabase-active-recovery-ownership-detection',
      detectedAt: new Date().toISOString(),
      sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
      sourceCommit: process.env.GITHUB_SHA ?? null,
      recoveryRunId,
      error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
      activeProbeMustBeSkipped: true,
      failClosed: true,
    }, null, 2)}\n`,
  )
  throw error
}
