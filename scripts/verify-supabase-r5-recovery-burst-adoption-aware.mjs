import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
if (!/^[a-z]{20}$/.test(projectRef)) {
  throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
}
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
const verifierToken = process.env.XRPL_R5_RECOVERY_VERIFY_TOKEN ?? ''
if (!/^[a-f0-9]{64}$/.test(verifierToken)) {
  throw new Error('XRPL_R5_RECOVERY_VERIFY_TOKEN must be an exact masked 64-character hex token')
}

function boundedIntegerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const requestedBatchLimit = boundedIntegerEnvironment(
  'R5_RECOVERY_BURST_BATCH_LIMIT',
  8,
  1,
  64,
)
const requestedWallSeconds = boundedIntegerEnvironment(
  'R5_RECOVERY_BURST_WALL_SECONDS',
  900,
  60,
  1800,
)
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
const evidenceDirectory = 'supabase-r5-recovery-burst-evidence'
const legacyVerifier = 'scripts/verify-supabase-r5-recovery-burst.mjs'
const nonAtomicMessage = 'R5 recovery changed non-atomically while awaiting batch'
const maximumCapturedBytes = 2 * 1024 * 1024
const transientStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524])

class RemoteError extends Error {
  constructor(message, { transient = false } = {}) {
    super(message)
    this.name = 'RemoteError'
    this.transient = transient
  }
}

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function array(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
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

async function managementQuery({ query, parameters }) {
  let response
  try {
    response = await fetch(managementEndpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, parameters, read_only: true }),
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    throw new RemoteError(
      `Supabase Management query transport failed: ${error instanceof Error ? error.message : String(error)}`,
      { transient: true },
    )
  }
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new RemoteError(
      `Supabase Management query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
      { transient: transientStatuses.has(response.status) },
    )
  }
  return rowsFromResponse(body)
}

function watermark(value, name) {
  const parsed = object(value, name)
  return {
    ledgerIndex: requiredInteger(parsed.ledgerIndex, `${name}.ledgerIndex`),
    ledgerHash: requiredHash(parsed.ledgerHash, `${name}.ledgerHash`, true),
    workId: requiredString(parsed.workId, `${name}.workId`),
  }
}

function verifyRecovery(raw, name) {
  const recovery = object(raw, name)
  const checks = object(recovery.checks, `${name}.checks`)
  if (
    recovery.found !== true
    || recovery.schemaVersion !== 1
    || recovery.purpose !== 'r5-supabase-active-recovery-summary'
    || recovery.runId !== recoveryRunId
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
    throw new Error(`${name} identity or health changed`)
  }
  for (const check of [
    'exactRevision3Identity',
    'exactSelectionBound',
    'checkpointDigestBound',
    'checkpointDescendantChainProved',
    'headNotBehindStart',
    'lagArithmeticExact',
    'publicReaderUnchanged',
    'mainnetDisabled',
  ]) {
    if (checks[check] !== true) throw new Error(`${name}.${check} failed`)
  }
  if (checks.stabilizationAuthorized !== false || checks.soakAuthorized !== false) {
    throw new Error(`${name} overstated stabilization or soak authorization`)
  }
  const startWatermark = watermark(recovery.startWatermark, `${name}.startWatermark`)
  const currentWatermark = watermark(recovery.currentWatermark, `${name}.currentWatermark`)
  const completedBatches = requiredInteger(recovery.completedBatches, `${name}.completedBatches`)
  const committedLedgers = requiredInteger(recovery.committedLedgers, `${name}.committedLedgers`)
  if (
    committedLedgers !== currentWatermark.ledgerIndex - startWatermark.ledgerIndex
    || completedBatches * 24 < committedLedgers
    || (completedBatches === 0) !== (committedLedgers === 0)
  ) {
    throw new Error(`${name} batch or ledger arithmetic changed`)
  }
  return {
    status: recovery.status,
    startWatermark,
    currentWatermark,
    completedBatches,
    committedLedgers,
    lastAccountingDigest: recovery.lastAccountingDigest,
  }
}

async function readRecovery() {
  return verifyRecovery(
    valueFromRows(
      await managementQuery({
        query: 'select public.xrpl_read_r5_active_recovery($1::text) as recovery',
        parameters: [recoveryRunId],
      }),
      'recovery',
      'R5 recovery read',
    ),
    'R5 recovery',
  )
}

function verifyAdoptionSummary(raw, name) {
  const summary = object(raw, name)
  if (
    summary.schemaVersion !== 1
    || summary.purpose !== 'r5-active-descendant-adoption-summary'
    || summary.runId !== recoveryRunId
  ) {
    throw new Error(`${name} identity changed`)
  }
  const adoptionCount = requiredInteger(summary.adoptionCount, `${name}.adoptionCount`)
  const adoptedLedgerCount = requiredInteger(
    summary.adoptedLedgerCount,
    `${name}.adoptedLedgerCount`,
  )
  const adoptedBatchCount = requiredInteger(
    summary.adoptedBatchCount,
    `${name}.adoptedBatchCount`,
  )
  const adoptions = array(summary.adoptions, `${name}.adoptions`)
  if (adoptions.length !== adoptionCount) {
    throw new Error(`${name} adoption count parity failed`)
  }
  return { adoptionCount, adoptedLedgerCount, adoptedBatchCount, adoptions }
}

async function readAdoptions() {
  return verifyAdoptionSummary(
    valueFromRows(
      await managementQuery({
        query:
          'select public.xrpl_read_r5_active_recovery_adoptions($1::text) as adoptions',
        parameters: [recoveryRunId],
      }),
      'adoptions',
      'R5 adoption summary read',
    ),
    'R5 adoption summary',
  )
}

function batchIdForSequence(sequence) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 99_999_999) {
    throw new Error('R5 batch sequence is outside the canonical ID range')
  }
  return `r5-batch-v1-${recoveryRunId}-${String(sequence).padStart(8, '0')}`
}

async function readBatch(sequence) {
  const batchId = batchIdForSequence(sequence)
  return valueFromRows(
    await managementQuery({
      query:
        'select public.xrpl_read_r5_active_recovery_batch($1::text, $2::text) as batch',
      parameters: [recoveryRunId, batchId],
    }),
    'batch',
    `R5 recovery batch ${sequence}`,
  )
}

function normalizeCompletedBatch(raw, sequence) {
  const batch = object(raw, `R5 recovery batch ${sequence}`)
  const batchId = batchIdForSequence(sequence)
  if (
    batch.found === false
    || batch.schemaVersion !== 1
    || batch.runId !== recoveryRunId
    || batch.batchId !== batchId
    || batch.batchSequence !== sequence
    || batch.status !== 'completed'
    || batch.profileId !== profileId
    || batch.profileRevision !== profileRevision
    || batch.profileIdentityDigest !== profileIdentityDigest
    || batch.selectionDigest !== selectionDigest
  ) {
    throw new Error(`R5 recovery batch ${sequence} identity or completion changed`)
  }
  const startLedgerIndex = requiredInteger(batch.startLedgerIndex, 'batch.startLedgerIndex')
  const endLedgerIndex = requiredInteger(batch.endLedgerIndex, 'batch.endLedgerIndex')
  const ledgerCount = requiredInteger(batch.ledgerCount, 'batch.ledgerCount')
  const finalizedEgressUpperBoundBytes = requiredInteger(
    batch.finalizedEgressUpperBoundBytes,
    'batch.finalizedEgressUpperBoundBytes',
  )
  if (
    ledgerCount < 1
    || ledgerCount > 24
    || endLedgerIndex !== startLedgerIndex + ledgerCount - 1
    || batch.reservedEgressUpperBoundBytes !== 134217728
    || finalizedEgressUpperBoundBytes >= 33554432
    || finalizedEgressUpperBoundBytes >= batch.reservedEgressUpperBoundBytes
  ) {
    throw new Error(`R5 recovery batch ${sequence} retained bounds changed`)
  }
  return {
    batchId,
    batchSequence: sequence,
    startLedgerIndex,
    endLedgerIndex,
    ledgerCount,
    expectedParentHash: requiredHash(batch.expectedParentHash, 'batch.expectedParentHash', true),
    finalLedgerHash: requiredHash(batch.finalLedgerHash, 'batch.finalLedgerHash', true),
    finalWorkId: requiredString(batch.finalWorkId, 'batch.finalWorkId'),
    accountingDigest: requiredHash(batch.accountingDigest, 'batch.accountingDigest'),
    finalizedEgressUpperBoundBytes,
    attemptCount: requiredInteger(batch.attemptCount, 'batch.attemptCount'),
  }
}

async function readActiveBoundary() {
  return valueFromRows(
    await managementQuery({
      query: `
        select jsonb_build_object(
          'watermark', (
            select jsonb_build_object(
              'ledgerIndex', ledger_index,
              'ledgerHash', ledger_hash,
              'workId', work_id
            )
            from public.xrpl_phase_watermarks
            where profile_id = 'supabase-devnet'
          ),
          'pendingCount', (
            select count(*) from public.xrpl_phase_messages
            where profile_id = 'supabase-devnet' and status = 'pending'
          ),
          'leasedCount', (
            select count(*) from public.xrpl_phase_messages
            where profile_id = 'supabase-devnet' and status = 'leased'
          ),
          'retryCount', (
            select count(*) from public.xrpl_phase_messages
            where profile_id = 'supabase-devnet' and status = 'retry'
          ),
          'inflightWorkCount', (
            select count(*) from public.xrpl_phase_work
            where profile_id = 'supabase-devnet'
              and status in ('planned', 'staged', 'committing', 'finalizing')
          )
        ) as boundary
      `,
      parameters: [],
    }),
    'boundary',
    'R5 active boundary read',
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

function appendCaptured(chunks, chunk, state) {
  const buffer = Buffer.from(chunk)
  const remaining = maximumCapturedBytes - state.bytes
  if (remaining > 0) {
    chunks.push(buffer.subarray(0, remaining))
    state.bytes += Math.min(buffer.length, remaining)
  }
}

async function runLegacyVerifier(batchLimit, wallSeconds) {
  return await new Promise((resolve, reject) => {
    const stdoutChunks = []
    const stderrChunks = []
    const stdoutState = { bytes: 0 }
    const stderrState = { bytes: 0 }
    const child = spawn(process.execPath, [legacyVerifier], {
      env: {
        ...process.env,
        R5_RECOVERY_BURST_BATCH_LIMIT: String(batchLimit),
        R5_RECOVERY_BURST_WALL_SECONDS: String(wallSeconds),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk)
      appendCaptured(stdoutChunks, chunk, stdoutState)
    })
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk)
      appendCaptured(stderrChunks, chunk, stderrState)
    })
    child.once('error', reject)
    child.once('close', (code, signal) => {
      resolve({
        code: code ?? 1,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
}

function normalizeAdoption(raw, expectedSequence) {
  const adoption = object(raw, `R5 adoption ${expectedSequence}`)
  const adoptionSequence = requiredInteger(
    adoption.adoptionSequence,
    'adoption.adoptionSequence',
  )
  if (adoptionSequence !== expectedSequence) {
    throw new Error('R5 adoption sequence changed')
  }
  const startLedgerIndex = requiredInteger(
    adoption.startLedgerIndex,
    'adoption.startLedgerIndex',
  )
  const endLedgerIndex = requiredInteger(adoption.endLedgerIndex, 'adoption.endLedgerIndex')
  const ledgerCount = requiredInteger(adoption.ledgerCount, 'adoption.ledgerCount')
  const workCount = requiredInteger(adoption.workCount, 'adoption.workCount')
  const firstBatchSequence = requiredInteger(
    adoption.firstBatchSequence,
    'adoption.firstBatchSequence',
  )
  const adoptedBatchCount = requiredInteger(
    adoption.adoptedBatchCount,
    'adoption.adoptedBatchCount',
  )
  if (
    ledgerCount < 1
    || workCount !== ledgerCount
    || endLedgerIndex !== startLedgerIndex + ledgerCount - 1
    || adoptedBatchCount !== Math.ceil(ledgerCount / 24)
  ) {
    throw new Error('R5 adoption range arithmetic changed')
  }
  return {
    adoptionSequence,
    startLedgerIndex,
    endLedgerIndex,
    ledgerCount,
    expectedParentHash: requiredHash(
      adoption.expectedParentHash,
      'adoption.expectedParentHash',
      true,
    ),
    finalLedgerHash: requiredHash(adoption.finalLedgerHash, 'adoption.finalLedgerHash', true),
    finalWorkId: requiredString(adoption.finalWorkId, 'adoption.finalWorkId'),
    workCount,
    worksDigest: requiredHash(adoption.worksDigest, 'adoption.worksDigest'),
    rowsDigest: requiredHash(adoption.rowsDigest, 'adoption.rowsDigest'),
    firstBatchSequence,
    adoptedBatchCount,
    adoptedAt: requiredString(adoption.adoptedAt, 'adoption.adoptedAt'),
  }
}

async function verifyAdoptionBridge(before, beforeAdoptions, after, afterAdoptions) {
  if (afterAdoptions.adoptionCount !== beforeAdoptions.adoptionCount + 1) {
    throw new Error('R5 non-atomic observation did not add exactly one adoption record')
  }
  const adoption = normalizeAdoption(
    afterAdoptions.adoptions.at(-1),
    afterAdoptions.adoptionCount,
  )
  if (
    afterAdoptions.adoptedLedgerCount
      !== beforeAdoptions.adoptedLedgerCount + adoption.ledgerCount
    || afterAdoptions.adoptedBatchCount
      !== beforeAdoptions.adoptedBatchCount + adoption.adoptedBatchCount
    || adoption.firstBatchSequence !== before.completedBatches + 1
    || adoption.startLedgerIndex !== before.currentWatermark.ledgerIndex + 1
    || adoption.expectedParentHash !== before.currentWatermark.ledgerHash
  ) {
    throw new Error('R5 adoption summary did not extend the exact prior recovery boundary')
  }

  const advancedBatches = after.completedBatches - before.completedBatches
  const executorBatchCount = advancedBatches - adoption.adoptedBatchCount
  if (
    adoption.adoptedBatchCount < 1
    || adoption.adoptedBatchCount > requestedBatchLimit
    || ![0, 1].includes(executorBatchCount)
    || advancedBatches < 1
    || advancedBatches > requestedBatchLimit
  ) {
    throw new Error('R5 adoption bridge exceeded the finite per-trigger batch bound')
  }

  const batches = []
  let expectedLedgerIndex = before.currentWatermark.ledgerIndex + 1
  let expectedParentHash = before.currentWatermark.ledgerHash
  let summedLedgers = 0
  for (
    let sequence = before.completedBatches + 1;
    sequence <= after.completedBatches;
    sequence += 1
  ) {
    const batch = normalizeCompletedBatch(await readBatch(sequence), sequence)
    if (
      batch.startLedgerIndex !== expectedLedgerIndex
      || batch.expectedParentHash !== expectedParentHash
    ) {
      throw new Error(`R5 adoption bridge batch ${sequence} is not hash-contiguous`)
    }
    const adopted = sequence < adoption.firstBatchSequence + adoption.adoptedBatchCount
    if (adopted && batch.finalizedEgressUpperBoundBytes !== 0) {
      throw new Error(`R5 adopted batch ${sequence} added recovery egress`)
    }
    batches.push({
      ...batch,
      origin: adopted ? 'adopted_active_descendant' : 'r5_executor',
      verifierAttempt: 1,
      transientRetries: 0,
    })
    summedLedgers += batch.ledgerCount
    expectedLedgerIndex = batch.endLedgerIndex + 1
    expectedParentHash = batch.finalLedgerHash
  }

  const adoptedBatches = batches.slice(0, adoption.adoptedBatchCount)
  const adoptedLedgers = adoptedBatches.reduce((sum, batch) => sum + batch.ledgerCount, 0)
  const lastAdoptedBatch = adoptedBatches.at(-1)
  const lastBatch = batches.at(-1)
  if (
    adoptedLedgers !== adoption.ledgerCount
    || lastAdoptedBatch?.endLedgerIndex !== adoption.endLedgerIndex
    || lastAdoptedBatch?.finalLedgerHash !== adoption.finalLedgerHash
    || lastAdoptedBatch?.finalWorkId !== adoption.finalWorkId
    || after.committedLedgers !== before.committedLedgers + summedLedgers
    || after.currentWatermark.ledgerIndex !== lastBatch?.endLedgerIndex
    || after.currentWatermark.ledgerHash !== lastBatch?.finalLedgerHash
    || after.currentWatermark.workId !== lastBatch?.finalWorkId
    || after.lastAccountingDigest !== lastBatch?.accountingDigest
  ) {
    throw new Error('R5 adoption bridge final recovery parity failed')
  }

  return { adoption, batches, advancedBatches, summedLedgers }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function directFinalEvidence(before, bridge, startedAtMilliseconds) {
  const after = await readRecovery()
  const boundary = object(await readActiveBoundary(), 'R5 active boundary')
  const boundaryWatermark = watermark(boundary.watermark, 'R5 active boundary watermark')
  const currentValidatedHead = await readValidatedHead()
  if (
    boundaryWatermark.ledgerIndex !== after.currentWatermark.ledgerIndex
    || boundaryWatermark.ledgerHash !== after.currentWatermark.ledgerHash
    || boundaryWatermark.workId !== after.currentWatermark.workId
    || requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
    || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
    || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
    || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    || currentValidatedHead.ledgerIndex < after.currentWatermark.ledgerIndex
  ) {
    throw new Error('R5 adoption-only burst final boundary failed')
  }
  return {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-burst-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    requestedBatchLimit,
    wallSeconds: requestedWallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,
    stopReason: 'batch_limit',
    transientRetries: 0,
    before: {
      status: before.status,
      completedBatches: before.completedBatches,
      committedLedgers: before.committedLedgers,
      currentWatermark: before.currentWatermark,
    },
    batches: bridge.batches,
    adoptionBridge: bridge.adoption,
    after: {
      status: after.status,
      completedBatches: after.completedBatches,
      committedLedgers: after.committedLedgers,
      currentWatermark: after.currentWatermark,
      currentValidatedHead,
      currentObservedLag: currentValidatedHead.ledgerIndex - after.currentWatermark.ledgerIndex,
    },
    activeBoundary: {
      watermark: boundaryWatermark,
      pendingCount: 1,
      leasedCount: 0,
      retryCount: 0,
      inflightWorkCount: 0,
    },
    checks: {
      firstBatchPreviouslyVerified: before.completedBatches >= 1,
      boundedBatchLimit: requestedBatchLimit <= 64,
      boundedWallClock: requestedWallSeconds <= 1800,
      adoptionBridgeVerified: true,
      exactBatchAdvance: bridge.advancedBatches === bridge.batches.length,
      exactLedgerAdvance: bridge.summedLedgers
        === after.committedLedgers - before.committedLedgers,
      onePendingScanAfterBurst: true,
      noLeasedOrRetryMessagesAfterBurst: true,
      noInflightWorkAfterBurst: true,
      activeRecoveryStarted: after.status === 'running',
      lagZero: after.status === 'caught_up',
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const startedAtMilliseconds = Date.now()
  const before = await readRecovery()
  const beforeAdoptions = await readAdoptions()
  const first = await runLegacyVerifier(requestedBatchLimit, requestedWallSeconds)
  if (first.code === 0) return

  const firstOutput = `${first.stdout}\n${first.stderr}`
  if (!firstOutput.includes(nonAtomicMessage)) {
    throw new Error(
      `legacy R5 burst verifier failed outside the adoption bridge: code=${first.code} signal=${first.signal ?? 'none'}`,
    )
  }

  const afterBridge = await readRecovery()
  const afterAdoptions = await readAdoptions()
  const bridge = await verifyAdoptionBridge(
    before,
    beforeAdoptions,
    afterBridge,
    afterAdoptions,
  )
  await writeFile(
    `${evidenceDirectory}/verified-r5-adoption-bridge.json`,
    `${JSON.stringify({
      schemaVersion: 1,
      purpose: 'r5-burst-adoption-bridge-verification',
      verifiedAt: new Date().toISOString(),
      sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
      sourceCommit: process.env.GITHUB_SHA ?? null,
      recoveryRunId,
      before,
      adoption: bridge.adoption,
      batches: bridge.batches,
      after: afterBridge,
      checks: {
        exactlyOneAdoptionRecordAdded: true,
        canonicalBatchSequenceRetained: true,
        hashLinkedRangeProved: true,
        adoptionEgressZero: true,
        atMostOneExecutorBatchFollowedAdoption: true,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }, null, 2)}\n`,
  )
  await rm(
    `${evidenceDirectory}/failed-r5-recovery-burst-verification.json`,
    { force: true },
  )

  const remainingBatchLimit = requestedBatchLimit - bridge.advancedBatches
  let combinedEvidence
  if (remainingBatchLimit === 0) {
    combinedEvidence = await directFinalEvidence(before, bridge, startedAtMilliseconds)
  } else {
    const elapsedSeconds = Math.ceil((Date.now() - startedAtMilliseconds) / 1_000)
    const remainingWallSeconds = requestedWallSeconds - elapsedSeconds
    if (remainingWallSeconds < 60) {
      throw new Error('R5 adoption bridge exhausted the bounded wall clock')
    }
    const second = await runLegacyVerifier(remainingBatchLimit, remainingWallSeconds)
    if (second.code !== 0) {
      throw new Error(
        `R5 burst continuation after verified adoption failed: code=${second.code} signal=${second.signal ?? 'none'}`,
      )
    }
    const continuation = object(
      await readJson(`${evidenceDirectory}/verified-r5-recovery-burst.json`),
      'R5 continuation evidence',
    )
    const continuationBefore = object(continuation.before, 'continuation.before')
    const continuationAfter = object(continuation.after, 'continuation.after')
    const continuationBatches = array(continuation.batches, 'continuation.batches')
    if (
      continuationBefore.completedBatches !== afterBridge.completedBatches
      || continuationBefore.committedLedgers !== afterBridge.committedLedgers
      || continuationBatches.length > remainingBatchLimit
      || continuationAfter.completedBatches - before.completedBatches
        !== bridge.batches.length + continuationBatches.length
    ) {
      throw new Error('R5 continuation evidence did not begin at the verified adoption boundary')
    }
    combinedEvidence = {
      ...continuation,
      verifiedAt: new Date().toISOString(),
      requestedBatchLimit,
      wallSeconds: requestedWallSeconds,
      elapsedMilliseconds: Date.now() - startedAtMilliseconds,
      before: {
        status: before.status,
        completedBatches: before.completedBatches,
        committedLedgers: before.committedLedgers,
        currentWatermark: before.currentWatermark,
      },
      batches: [...bridge.batches, ...continuationBatches],
      adoptionBridge: bridge.adoption,
      checks: {
        ...object(continuation.checks, 'continuation.checks'),
        adoptionBridgeVerified: true,
        boundedBatchLimit:
          bridge.batches.length + continuationBatches.length <= requestedBatchLimit,
        boundedWallClock: Date.now() - startedAtMilliseconds
          <= requestedWallSeconds * 1_000 + 30_000,
        exactBatchAdvance:
          continuationAfter.completedBatches - before.completedBatches
          === bridge.batches.length + continuationBatches.length,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }
  }

  await rm(
    `${evidenceDirectory}/failed-r5-recovery-burst-verification.json`,
    { force: true },
  )
  await writeFile(
    `${evidenceDirectory}/verified-r5-recovery-burst.json`,
    `${JSON.stringify(combinedEvidence, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify(combinedEvidence, null, 2)}\n`)
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r5-supabase-active-recovery-burst-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    requestedBatchLimit,
    wallSeconds: requestedWallSeconds,
    error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    checks: {
      burstCompleted: false,
      adoptionBridgeFailClosed: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-r5-recovery-burst-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
