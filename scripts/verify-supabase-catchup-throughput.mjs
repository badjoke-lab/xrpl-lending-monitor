import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { verifyRetainedR5Qualifications } from './verify-supabase-retained-r5-qualification-evidence.mjs'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-catchup-throughput`
const purpose = 'r4c2d-isolated-catchup-throughput'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const runId = `r4c2d-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`

function headers() {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    'x-xrpl-reader-token': verifierToken,
  }
}

async function requestRaw(customHeaders = headers(), body = { runId }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: customHeaders,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = { raw: text.slice(0, 2_000) }
  }
  return { ok: response.ok, status: response.status, body: parsed }
}

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function numberValue(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
    throw new Error(`${name} must be a finite number`)
  }
  return parsed
}

function verify(result) {
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.profileId !== 'supabase-devnet-catchup-qualification'
    || result.sourceProfileId !== 'supabase-devnet'
    || result.network !== 'devnet'
    || result.sourceCount !== 64
    || result.trialCount !== 5
    || !Array.isArray(result.trials)
    || result.trials.length !== 5
  ) {
    throw new Error('catch-up throughput result identity is invalid')
  }

  for (const [index, rawTrial] of result.trials.entries()) {
    const trial = object(rawTrial, `trial ${index + 1}`)
    const messages = object(trial.messages, `trial ${index + 1} messages`)
    const checks = object(trial.checks, `trial ${index + 1} checks`)
    const watermark = object(trial.targetWatermark, `trial ${index + 1} watermark`)
    const activeBefore = object(trial.activeBefore, `trial ${index + 1} active before`)
    const activeAfter = object(trial.activeAfter, `trial ${index + 1} active after`)

    if (
      trial.status !== 'completed'
      || trial.sourceCount !== 64
      || trial.committedWorks !== 64
      || messages.total !== 193
      || messages.completed !== 192
      || messages.pending !== 1
      || messages.completedAttemptOne !== 192
      || trial.successors !== 192
      || trial.sourceRowCount !== trial.targetRowCount
      || trial.sourceRowsDigest !== trial.targetRowsDigest
      || watermark.ledgerIndex !== trial.sourceEndLedgerIndex
      || watermark.ledgerHash !== trial.sourceEndLedgerHash
      || numberValue(activeAfter.ledgerIndex, 'active after ledger')
        < numberValue(activeBefore.ledgerIndex, 'active before ledger')
    ) {
      throw new Error(`catch-up throughput trial ${index + 1} parity failed`)
    }
    for (const [name, passed] of Object.entries(checks)) {
      if (passed !== true) throw new Error(`catch-up throughput trial ${index + 1} check ${name} failed`)
    }
    for (const name of [
      'dbElapsedMilliseconds',
      'edgeWallMilliseconds',
      'effectiveElapsedMilliseconds',
      'committedLedgersPerMinute',
    ]) {
      if (numberValue(trial[name], `trial ${index + 1}.${name}`) <= 0) {
        throw new Error(`catch-up throughput trial ${index + 1}.${name} must be positive`)
      }
    }
  }

  const summary = object(result.summary, 'catch-up summary')
  for (const name of [
    'minimumCommittedLedgersPerMinute',
    'p50CommittedLedgersPerMinute',
    'p95CommittedLedgersPerMinute',
    'maximumCommittedLedgersPerMinute',
    'p50DbElapsedMilliseconds',
    'p95DbElapsedMilliseconds',
    'p50EdgeWallMilliseconds',
    'p95EdgeWallMilliseconds',
  ]) {
    if (numberValue(summary[name], `summary.${name}`) <= 0) {
      throw new Error(`summary.${name} must be positive`)
    }
  }
  if (
    summary.catchUpThreshold !== 30
    || typeof summary.catchUpObservedPass !== 'boolean'
    || summary.steadyObservedPass !== false
    || summary.g7Qualified !== false
  ) {
    throw new Error('catch-up throughput summary overstated G7')
  }

  const checks = object(result.checks, 'catch-up checks')
  for (const required of [
    'fiveTrialsCompleted',
    'sixtyFourWorksPerTrial',
    'fullPhaseSchedulerParity',
    'allCompletedAttemptsOne',
    'committedRowDigestParity',
    'targetWatermarkParity',
    'activeProfileNonRegressing',
    'catchUpComponentMeasured',
    'g7NotOverstated',
  ]) {
    if (checks[required] !== true) throw new Error(`catch-up throughput check ${required} failed`)
  }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const retained = await verifyRetainedR5Qualifications()
  if (retained !== null) {
    await writeFile(
      `${evidenceDirectory}/verified-catchup-throughput.json`,
      `${JSON.stringify(retained.catchUp, null, 2)}\n`,
    )
    console.log(JSON.stringify(retained.catchUp))
    return
  }

  const response = await requestRaw()
  if (!response.ok) {
    throw new Error(
      `catch-up throughput failed (${response.status}): ${JSON.stringify(response.body).slice(0, 2_000)}`,
    )
  }
  verify(response.body)

  const missingToken = await requestRaw(
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': purpose,
    },
    { runId: `${runId}-missing` },
  )
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('catch-up throughput accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw(
    {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': 'wrong-purpose',
      'x-xrpl-reader-token': verifierToken,
    },
    { runId: `${runId}-purpose` },
  )
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('catch-up throughput accepted the wrong purpose')
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-isolated-catchup-throughput-verification',
    verifiedAt: new Date().toISOString(),
    runId,
    ...response.body,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-catchup-throughput.json`,
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
    purpose: 'r4c2d-isolated-catchup-throughput-verification',
    failedAt: new Date().toISOString(),
    runId,
    reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-catchup-throughput-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
