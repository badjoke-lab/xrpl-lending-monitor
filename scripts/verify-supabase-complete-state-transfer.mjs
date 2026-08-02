import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

const endpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-complete-state-transfer`
const evidenceDirectory = 'supabase-remote-probe-evidence'
const purpose = 'r4c2c-complete-state-transfer-qualification'
const expectedCounts = {
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
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    )
  }
  return value
}

function canonicalJson(value) {
  return JSON.stringify(normalize(value))
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

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
    signal: AbortSignal.timeout(120_000),
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

function assertCounts(value, name) {
  if (canonicalJson(value) !== canonicalJson(expectedCounts)) {
    throw new Error(`${name} counts changed: ${canonicalJson(value)}`)
  }
}

function verifyTransfer(result) {
  if (
    result.schemaVersion !== 1
    || result.purpose !== purpose
    || result.exportId !== 'r4c2c-multichunk-complete-state-v1'
    || result.targetId !== 'supabase-devnet-transfer-restore-v1'
    || result.typedRestoreNamespace !== 'xrpl_restore_v1'
    || !/^[a-f0-9]{64}$/.test(result.stateDigest)
  ) {
    throw new Error('complete-state transfer identity is invalid')
  }
  if (
    typeof result.sourceStateCanonicalText !== 'string'
    || typeof result.restoredStateCanonicalText !== 'string'
    || result.sourceStateCanonicalText !== result.restoredStateCanonicalText
    || sha256(result.sourceStateCanonicalText) !== result.stateDigest
    || sha256(result.restoredStateCanonicalText) !== result.stateDigest
  ) {
    throw new Error('complete-state canonical text or digest parity failed')
  }
  assertCounts(result.rowCounts, 'transfer')
  assertCounts(result.sourceShape?.counts, 'source shape')
  assertCounts(result.restoredShape?.counts, 'restored shape')
  if (
    canonicalJson(result.sourceShape?.schedulerStatusCounts) !== canonicalJson({ completed: 5, pending: 1 })
    || canonicalJson(result.restoredShape?.schedulerStatusCounts) !== canonicalJson({ completed: 5, pending: 1 })
  ) {
    throw new Error('complete-state scheduler status parity failed')
  }
  if (
    typeof result.firstRestoreDuplicate !== 'boolean'
    || result.duplicateRestoreConverged !== true
    || result.digestTamperRejected !== true
    || result.activeIsolation?.nonRegressing !== true
    || result.activeIsolation?.sourceIdentityPreserved !== true
  ) {
    throw new Error('complete-state restore or active isolation checks failed')
  }
  const expectedChecks = {
    collectionStateIncluded: true,
    schedulerStateIncluded: true,
    publicationStateIncluded: true,
    maintenanceStateIncluded: true,
    canonicalTextParity: true,
    digestParity: true,
    duplicateRestoreConverged: true,
    digestTamperRejected: true,
    activeProfileIsolated: true,
    postRestoreContinuationProved: false,
  }
  for (const [key, value] of Object.entries(expectedChecks)) {
    if (result.checks?.[key] !== value) {
      throw new Error(`complete-state check ${key} changed: ${String(result.checks?.[key])}`)
    }
  }
  if (
    result.activeWatermarkBefore?.profileId !== 'supabase-devnet'
    || result.activeWatermarkAfter?.profileId !== 'supabase-devnet'
    || result.activeWatermarkBefore?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.epochId !== 'supabase-r4c2c-v1'
    || result.activeWatermarkAfter?.ledgerIndex < result.activeWatermarkBefore?.ledgerIndex
  ) {
    throw new Error('complete-state transfer changed the active watermark boundary')
  }
}

async function verify() {
  await mkdir(evidenceDirectory, { recursive: true })

  const transfer = await requestRaw()
  if (!transfer.ok) {
    throw new Error(
      `complete-state transfer failed (${transfer.status}): ${JSON.stringify(transfer.body).slice(0, 1_000)}`,
    )
  }
  verifyTransfer(transfer.body)

  const missingToken = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': purpose,
  })
  if (missingToken.status !== 401 || missingToken.body?.error !== 'unauthorized') {
    throw new Error('complete-state transfer accepted a missing verifier token')
  }

  const wrongPurpose = await requestRaw({
    'content-type': 'application/json',
    'x-xrpl-reader-purpose': 'wrong-purpose',
    'x-xrpl-reader-token': verifierToken,
  })
  if (wrongPurpose.status !== 403 || wrongPurpose.body?.error !== 'invalid_purpose') {
    throw new Error('complete-state transfer accepted the wrong purpose')
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-complete-state-transfer-remote-verification',
    verifiedAt: new Date().toISOString(),
    exportId: transfer.body.exportId,
    targetId: transfer.body.targetId,
    typedRestoreNamespace: transfer.body.typedRestoreNamespace,
    stateDigest: transfer.body.stateDigest,
    canonicalTextBytes: Buffer.byteLength(transfer.body.sourceStateCanonicalText, 'utf8'),
    rowCounts: transfer.body.rowCounts,
    schedulerStatusCounts: transfer.body.sourceShape.schedulerStatusCounts,
    firstRestoreDuplicate: transfer.body.firstRestoreDuplicate,
    emptyTargetRestoreObserved: transfer.body.firstRestoreDuplicate === false,
    duplicateRestoreConverged: transfer.body.duplicateRestoreConverged,
    digestTamperRejected: transfer.body.digestTamperRejected,
    credentialChecks: {
      missingTokenRejected: true,
      wrongPurposeRejected: true,
    },
    activeIsolation: transfer.body.activeIsolation,
    activeWatermarkBefore: transfer.body.activeWatermarkBefore,
    activeWatermarkAfter: transfer.body.activeWatermarkAfter,
    checks: transfer.body.checks,
  }

  await writeFile(
    `${evidenceDirectory}/verified-complete-state-transfer.json`,
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
    purpose: 'r4c2c-complete-state-transfer-remote-verification',
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-complete-state-transfer-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
