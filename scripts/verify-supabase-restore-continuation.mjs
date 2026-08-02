import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-restore-continuation`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const purpose = 'r4c2c-restore-continuation-qualification'

function headers() {
  return {
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
    'x-xrpl-reader-token': verifierToken,
  }
}

async function requestRaw(customHeaders = headers()) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: customHeaders,
    body: '{}',
    signal: AbortSignal.timeout(180_000),
  })
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text.slice(0, 1_000) }
  }
  return { ok: response.ok, status: response.status, body }
}

function verifyResult(result) {
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.fixtureId !== 'r4c2c-post-restore-continuation-v1'
    || result.sourceProfileId !== 'supabase-devnet-restore-continuation-source'
    || result.activeProfileId !== 'supabase-devnet'
    || result.targetId !== 'supabase-devnet-restore-continuation-v1'
  ) {
    throw new Error('restore continuation identity is invalid')
  }

  const prepare = result.prepare ?? {}
  if (
    prepare.prepared !== true
    || prepare.sourceProfileId !== result.sourceProfileId
    || prepare.targetId !== result.targetId
    || prepare.continuationLedgerIndex !== prepare.anchorLedgerIndex + 1
    || !/^[A-F0-9]{64}$/.test(prepare.anchorLedgerHash ?? '')
    || !/^[A-F0-9]{64}$/.test(prepare.continuationLedgerHash ?? '')
    || !/^[a-f0-9]{64}$/.test(prepare.sourceStateDigest ?? '')
  ) {
    throw new Error('restore continuation preparation is invalid')
  }

  const checks = {
    emptyTargetRestoreParity: true,
    pendingScanRestored: true,
    standardPhaseContinuation: true,
    watermarkAdvancedExactlyOne: true,
    committedRowParity: true,
    explicitSourceRebinding: true,
    duplicatePhaseReplayConverged: true,
    activeProfileIsolated: true,
    postRestoreContinuationProved: true,
  }
  for (const [key, expected] of Object.entries(checks)) {
    if (result.checks?.[key] !== expected) {
      throw new Error(`restore continuation check ${key} changed`)
    }
  }

  if (
    result.activeWatermarkBefore?.profileId !== 'supabase-devnet'
    || result.activeWatermarkAfter?.profileId !== 'supabase-devnet'
    || result.activeWatermarkBefore?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.ledgerIndex < result.activeWatermarkBefore?.ledgerIndex
    || result.activeIsolation?.nonRegressing !== true
    || result.activeIsolation?.sourceIdentityPreserved !== true
  ) {
    throw new Error('restore continuation changed the active profile boundary')
  }

  const evidence = result.evidence ?? {}
  if (
    evidence.checks?.continued !== true
    || evidence.checks?.watermarkAdvancedExactlyOne !== true
    || evidence.checks?.watermarkMatchesDurableSource !== true
    || evidence.checks?.workCommitted !== true
    || evidence.checks?.committedRowsOnly !== true
    || evidence.checks?.rowCountParity !== true
    || evidence.checks?.rowDigestParity !== true
    || evidence.checks?.sourceReboundExplicitly !== true
    || !/^[a-f0-9]{64}$/.test(evidence.continuationRowsDigest ?? '')
    || !/^[a-f0-9]{64}$/.test(evidence.targetStateDigest ?? '')
  ) {
    throw new Error('restore continuation target evidence is invalid')
  }

  const sequence = evidence.phaseSequence
  if (!Array.isArray(sequence)) throw new Error('restore continuation phase sequence is missing')
  const completed = sequence.filter((entry) => entry?.status === 'completed')
  const pending = sequence.filter((entry) => entry?.status === 'pending')
  if (
    completed.length < 3
    || completed[0]?.phase !== 'scan'
    || completed.at(-1)?.phase !== 'finalize'
    || completed.slice(1, -1).some((entry) => entry?.phase !== 'commit')
    || completed.some((entry) => entry?.attemptCount !== 1)
    || pending.length !== 1
    || pending[0]?.phase !== 'scan'
    || pending[0]?.attemptCount !== 0
  ) {
    throw new Error('restore continuation standard phase sequence changed')
  }

  if (
    !Array.isArray(result.duplicateReplay)
    || result.duplicateReplay.length !== completed.length
    || result.duplicateReplay.some((entry) => entry?.duplicate !== true)
  ) {
    throw new Error('restore continuation duplicate phase replay did not converge')
  }

  if (
    evidence.rowCounts?.streams !== 1
    || evidence.rowCounts?.work !== 2
    || evidence.rowCounts?.watermarks !== 1
    || evidence.rowCounts?.messages !== completed.length + 1
    || evidence.rowCounts?.successors !== completed.length
    || !Number.isSafeInteger(evidence.continuationRowCount)
    || evidence.continuationRowCount < 1
  ) {
    throw new Error('restore continuation row counts changed')
  }

  return { completed, pending }
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })

  const continuation = await requestRaw()
  if (!continuation.ok) {
    throw new Error(
      `restore continuation failed (${continuation.status}): ${JSON.stringify(continuation.body).slice(0, 1_000)}`,
    )
  }
  const phases = verifyResult(continuation.body)

  const missingToken = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
  })
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('restore continuation accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': 'wrong-purpose',
    'x-xrpl-reader-token': verifierToken,
  })
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('restore continuation accepted the wrong purpose')
  }

  const body = continuation.body
  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-restore-continuation-remote-verification',
    verifiedAt: new Date().toISOString(),
    fixtureId: body.fixtureId,
    sourceProfileId: body.sourceProfileId,
    activeProfileId: body.activeProfileId,
    targetId: body.targetId,
    sourceStateDigest: body.prepare.sourceStateDigest,
    sourceRowCounts: body.prepare.sourceRowCounts,
    anchor: {
      workId: body.prepare.anchorWorkId,
      ledgerIndex: body.prepare.anchorLedgerIndex,
      ledgerHash: body.prepare.anchorLedgerHash,
    },
    continuation: {
      workId: body.prepare.continuationWorkId,
      ledgerIndex: body.prepare.continuationLedgerIndex,
      ledgerHash: body.prepare.continuationLedgerHash,
      rowCount: body.evidence.continuationRowCount,
      rowsDigest: body.evidence.continuationRowsDigest,
    },
    phaseSequence: body.evidence.phaseSequence,
    completedPhaseCount: phases.completed.length,
    pendingPhaseCount: phases.pending.length,
    messageStatusCounts: body.evidence.messageStatusCounts,
    rowCounts: body.evidence.rowCounts,
    targetStateDigest: body.evidence.targetStateDigest,
    duplicatePhaseReplayCount: body.duplicateReplay.length,
    activeIsolation: body.activeIsolation,
    activeWatermarkBefore: body.activeWatermarkBefore,
    activeWatermarkAfter: body.activeWatermarkAfter,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    checks: body.checks,
  }

  await writeFile(
    `${evidenceDirectory}/verified-restore-continuation.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await verify()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2c-restore-continuation-remote-verification',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-restore-continuation-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
