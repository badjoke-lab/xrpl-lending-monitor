import { mkdir, writeFile } from 'node:fs/promises'

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

const purpose = 'r5-first-active-recovery-batch'
const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const firstBatchId =
  'r5-batch-v1-r5-recovery-selected-revision3-entry-00000001'
const profileId = 'supabase_free_postgres_pgcron_edge'
const profileRevision = 3
const profileIdentityDigest =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'
const selectionDigest =
  '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'
const triggerEndpoint =
  `https://${projectRef}.supabase.co/functions/v1/xrpl-r5-recovery-batch-trigger`
const managementEndpoint =
  `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const xrplEndpoint = 'https://s.devnet.rippletest.net:51234/'
const evidenceDirectory = 'supabase-remote-probe-evidence'
const maximumAttempts = 3
const retryDelayMilliseconds = 60_000
const transientStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524])

class TriggerError extends Error {
  constructor(message, { status = null, transient = false, response = null } = {}) {
    super(message)
    this.name = 'TriggerError'
    this.status = status
    this.transient = transient
    this.response = response
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

function requiredNumber(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
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
    throw new Error(
      `Supabase Management query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
    )
  }
  return rowsFromResponse(body)
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

async function readBatch() {
  return valueFromRows(
    await managementQuery({
      query:
        'select public.xrpl_read_r5_active_recovery_batch($1::text, $2::text) as batch',
      parameters: [recoveryRunId, firstBatchId],
      readOnly: true,
    }),
    'batch',
    'R5 recovery batch read',
  )
}

async function readActiveBoundary(startLedgerIndex, endLedgerIndex) {
  const query = `
    select jsonb_build_object(
      'watermark', (
        select jsonb_build_object(
          'ledgerIndex', ledger_index,
          'ledgerHash', ledger_hash,
          'workId', work_id,
          'network', network,
          'epochId', epoch_id,
          'baseIdentity', base_identity
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
      ),
      'firstBatchCommittedWorkCount', (
        select count(*) from public.xrpl_phase_work
        where profile_id = 'supabase-devnet'
          and status = 'committed'
          and start_ledger_index between $1::bigint and $2::bigint
      ),
      'firstBatchReferenceRowCount', (
        select count(*)
        from public.xrpl_phase_reference_rows rows
        join public.xrpl_phase_work work on work.work_id = rows.work_id
        where work.profile_id = 'supabase-devnet'
          and work.start_ledger_index between $1::bigint and $2::bigint
      )
    ) as boundary
  `
  return valueFromRows(
    await managementQuery({
      query,
      parameters: [startLedgerIndex, endLedgerIndex],
      readOnly: true,
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
  return {
    raw: recovery,
    checks,
    status: recovery.status,
    startWatermark: watermark(recovery.startWatermark, `${name}.startWatermark`),
    currentWatermark: watermark(recovery.currentWatermark, `${name}.currentWatermark`),
    completedBatches: requiredInteger(recovery.completedBatches, `${name}.completedBatches`),
    committedLedgers: requiredInteger(recovery.committedLedgers, `${name}.committedLedgers`),
    initialLagLedgers: requiredInteger(recovery.initialLagLedgers, `${name}.initialLagLedgers`),
    lastAccountingDigest: recovery.lastAccountingDigest,
    startedAt: recovery.startedAt,
  }
}

function verifyCompletedFirstBatch(raw, startWatermark) {
  const batch = object(raw, 'first R5 recovery batch')
  if (
    batch.found === false
    || batch.schemaVersion !== 1
    || batch.runId !== recoveryRunId
    || batch.batchId !== firstBatchId
    || batch.batchSequence !== 1
    || batch.status !== 'completed'
    || batch.profileId !== profileId
    || batch.profileRevision !== profileRevision
    || batch.profileIdentityDigest !== profileIdentityDigest
    || batch.selectionDigest !== selectionDigest
  ) {
    throw new Error('first R5 recovery batch identity or completion changed')
  }
  const startLedgerIndex = requiredInteger(batch.startLedgerIndex, 'batch.startLedgerIndex')
  const endLedgerIndex = requiredInteger(batch.endLedgerIndex, 'batch.endLedgerIndex')
  const ledgerCount = requiredInteger(batch.ledgerCount, 'batch.ledgerCount')
  const reservedEgressUpperBoundBytes = requiredInteger(
    batch.reservedEgressUpperBoundBytes,
    'batch.reservedEgressUpperBoundBytes',
  )
  const finalizedEgressUpperBoundBytes = requiredInteger(
    batch.finalizedEgressUpperBoundBytes,
    'batch.finalizedEgressUpperBoundBytes',
  )
  if (
    startLedgerIndex !== startWatermark.ledgerIndex + 1
    || endLedgerIndex !== startLedgerIndex + 23
    || ledgerCount !== 24
    || batch.expectedParentHash !== startWatermark.ledgerHash
    || reservedEgressUpperBoundBytes !== 134217728
    || finalizedEgressUpperBoundBytes >= 33554432
    || finalizedEgressUpperBoundBytes >= reservedEgressUpperBoundBytes
    || requiredInteger(batch.attemptCount, 'batch.attemptCount') < 1
  ) {
    throw new Error('first R5 recovery batch range or resource bounds changed')
  }
  return {
    raw: batch,
    startLedgerIndex,
    endLedgerIndex,
    ledgerCount,
    expectedParentHash: requiredHash(
      batch.expectedParentHash,
      'batch.expectedParentHash',
      true,
    ),
    finalLedgerHash: requiredHash(batch.finalLedgerHash, 'batch.finalLedgerHash', true),
    finalWorkId: requiredString(batch.finalWorkId, 'batch.finalWorkId'),
    worksDigest: requiredHash(batch.worksDigest, 'batch.worksDigest'),
    rowsDigest: requiredHash(batch.rowsDigest, 'batch.rowsDigest'),
    accountingDigest: requiredHash(batch.accountingDigest, 'batch.accountingDigest'),
    reservedEgressUpperBoundBytes,
    finalizedEgressUpperBoundBytes,
    attemptCount: requiredInteger(batch.attemptCount, 'batch.attemptCount'),
    completedAt: requiredString(batch.completedAt, 'batch.completedAt'),
  }
}

async function invokeTrigger() {
  let response
  try {
    response = await fetch(triggerEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-xrpl-r5-purpose': purpose,
        'x-xrpl-r5-token': verifierToken,
      },
      body: JSON.stringify({ source: 'github_actions', run_id: recoveryRunId }),
      signal: AbortSignal.timeout(90_000),
    })
  } catch (error) {
    throw new TriggerError(
      `R5 trigger transport failed: ${error instanceof Error ? error.message : String(error)}`,
      { transient: true },
    )
  }
  const text = await response.text()
  const body = parseJson(text)
  const trigger = body && typeof body === 'object' ? body.trigger : null
  if (trigger && typeof trigger === 'object') {
    if (
      trigger.combinedProxyBytesWithinFixedReserve !== true
      || trigger.twoInvocationReservationUsed !== true
      || trigger.serviceKeyNotReturned !== true
      || requiredInteger(trigger.fixedFunctionResponseReserveBytes, 'fixed response reserve')
        !== 131072
      || requiredInteger(trigger.combinedProxyBytes, 'combined proxy bytes') >= 131072
    ) {
      throw new TriggerError('R5 trigger proxy accounting boundary changed', {
        status: response.status,
        transient: false,
        response: body,
      })
    }
  }
  if (!response.ok) {
    const executor = body && typeof body === 'object' ? body.executor : null
    const transient = transientStatuses.has(response.status)
      && (executor?.transient === true || response.status !== 500)
    throw new TriggerError(
      `R5 trigger failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
      { status: response.status, transient, response: body },
    )
  }
  return object(body, 'R5 trigger response')
}

async function ensureFirstBatch(before) {
  let lastTrigger = null
  let transientRetries = 0
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const existingBatch = await readBatch()
    if (existingBatch.found !== false && existingBatch.status === 'completed') {
      return {
        batch: existingBatch,
        executedNow: before.completedBatches === 0,
        verifierAttempt: attempt,
        transientRetries,
        lastTrigger,
      }
    }
    if (existingBatch.found !== false && existingBatch.status === 'halted') {
      throw new Error(`first R5 recovery batch halted: ${existingBatch.error}`)
    }

    try {
      const trigger = await invokeTrigger()
      lastTrigger = trigger
      const executor = object(trigger.executor, 'R5 executor response')
      if (executor.ok !== true) {
        throw new TriggerError(
          `R5 executor did not succeed: ${JSON.stringify(executor).slice(0, 2_000)}`,
          { transient: executor.transient === true, response: trigger },
        )
      }
      if (executor.claimed === false) {
        const reason = requiredString(executor.reason, 'executor reason')
        if (!['batch_lease_active', 'not_claimed'].includes(reason)) {
          throw new TriggerError(`R5 executor declined first batch: ${reason}`, {
            transient: false,
            response: trigger,
          })
        }
      }
    } catch (error) {
      if (!(error instanceof TriggerError) || error.transient !== true) throw error
      transientRetries += 1
      lastTrigger = error.response
    }

    const reread = await readBatch()
    if (reread.found !== false && reread.status === 'completed') {
      return {
        batch: reread,
        executedNow: before.completedBatches === 0,
        verifierAttempt: attempt,
        transientRetries,
        lastTrigger,
      }
    }
    if (attempt === maximumAttempts) {
      throw new Error('first R5 recovery batch did not complete within bounded retries')
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))
  }
  throw new Error('first R5 recovery batch retry loop exhausted')
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const before = verifyRecovery(await readRecovery(), 'recoveryBefore')
  const ensured = await ensureFirstBatch(before)
  const after = verifyRecovery(await readRecovery(), 'recoveryAfter')
  const batch = verifyCompletedFirstBatch(ensured.batch, after.startWatermark)
  const boundary = object(
    await readActiveBoundary(batch.startLedgerIndex, batch.endLedgerIndex),
    'active boundary',
  )
  const boundaryWatermark = watermark(boundary.watermark, 'activeBoundary.watermark')
  const currentValidatedHead = await readValidatedHead()

  if (
    after.completedBatches < 1
    || after.committedLedgers < 24
    || after.currentWatermark.ledgerIndex < batch.endLedgerIndex
    || after.currentWatermark.ledgerHash
      !== (after.currentWatermark.ledgerIndex === batch.endLedgerIndex
        ? batch.finalLedgerHash
        : after.currentWatermark.ledgerHash)
    || after.lastAccountingDigest !== batch.accountingDigest
    || after.startedAt === null
    || after.checks.activeRecoveryStarted !== (after.status === 'running')
    || boundaryWatermark.ledgerIndex !== after.currentWatermark.ledgerIndex
    || boundaryWatermark.ledgerHash !== after.currentWatermark.ledgerHash
    || boundaryWatermark.workId !== after.currentWatermark.workId
    || requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
    || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
    || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
    || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    || requiredInteger(
      boundary.firstBatchCommittedWorkCount,
      'boundary.firstBatchCommittedWorkCount',
    ) !== 24
    || requiredInteger(
      boundary.firstBatchReferenceRowCount,
      'boundary.firstBatchReferenceRowCount',
    ) < 24
    || currentValidatedHead.ledgerIndex < after.currentWatermark.ledgerIndex
  ) {
    throw new Error('first R5 recovery batch active-state parity failed')
  }

  const exactFirstBatchOnly = after.completedBatches === 1
  if (exactFirstBatchOnly && (
    after.currentWatermark.ledgerIndex !== batch.endLedgerIndex
    || after.currentWatermark.ledgerHash !== batch.finalLedgerHash
    || after.currentWatermark.workId !== batch.finalWorkId
    || after.committedLedgers !== 24
  )) {
    throw new Error('first R5 recovery batch exact watermark advance failed')
  }

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-supabase-first-active-recovery-batch-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    batchId: firstBatchId,
    executedNow: ensured.executedNow,
    verifierAttempt: ensured.verifierAttempt,
    transientRetries: ensured.transientRetries,
    profileId,
    profileRevision,
    profileIdentityDigest,
    selectionDigest,
    status: after.status,
    before: {
      completedBatches: before.completedBatches,
      committedLedgers: before.committedLedgers,
      currentWatermark: before.currentWatermark,
    },
    batch: {
      batchSequence: 1,
      startLedgerIndex: batch.startLedgerIndex,
      endLedgerIndex: batch.endLedgerIndex,
      ledgerCount: batch.ledgerCount,
      expectedParentHash: batch.expectedParentHash,
      finalLedgerHash: batch.finalLedgerHash,
      finalWorkId: batch.finalWorkId,
      worksDigest: batch.worksDigest,
      rowsDigest: batch.rowsDigest,
      accountingDigest: batch.accountingDigest,
      reservedEgressUpperBoundBytes: batch.reservedEgressUpperBoundBytes,
      finalizedEgressUpperBoundBytes: batch.finalizedEgressUpperBoundBytes,
      attemptCount: batch.attemptCount,
      completedAt: batch.completedAt,
    },
    after: {
      completedBatches: after.completedBatches,
      committedLedgers: after.committedLedgers,
      currentWatermark: after.currentWatermark,
      currentValidatedHead,
      currentObservedLag:
        currentValidatedHead.ledgerIndex - after.currentWatermark.ledgerIndex,
    },
    activeBoundary: {
      watermark: boundaryWatermark,
      pendingCount: requiredInteger(boundary.pendingCount, 'boundary.pendingCount'),
      leasedCount: requiredInteger(boundary.leasedCount, 'boundary.leasedCount'),
      retryCount: requiredInteger(boundary.retryCount, 'boundary.retryCount'),
      inflightWorkCount: requiredInteger(
        boundary.inflightWorkCount,
        'boundary.inflightWorkCount',
      ),
      firstBatchCommittedWorkCount: requiredInteger(
        boundary.firstBatchCommittedWorkCount,
        'boundary.firstBatchCommittedWorkCount',
      ),
      firstBatchReferenceRowCount: requiredInteger(
        boundary.firstBatchReferenceRowCount,
        'boundary.firstBatchReferenceRowCount',
      ),
    },
    trigger: ensured.lastTrigger,
    checks: {
      firstBatchCompleted: true,
      exactlyTwentyFourLedgersCommitted: batch.ledgerCount === 24,
      startBoundToPreparedWatermark:
        batch.startLedgerIndex === after.startWatermark.ledgerIndex + 1,
      hashLinkedToPreparedWatermark:
        batch.expectedParentHash === after.startWatermark.ledgerHash,
      activeWatermarkAdvancedAtLeastThroughFirstBatch:
        after.currentWatermark.ledgerIndex >= batch.endLedgerIndex,
      exactFirstBatchOnly,
      exactTwentyFourLedgerAdvanceWhenFirstBatchOnly:
        !exactFirstBatchOnly
        || after.currentWatermark.ledgerIndex
          === after.startWatermark.ledgerIndex + 24,
      reservationShrunkOnlyAfterSuccess:
        batch.finalizedEgressUpperBoundBytes
          < batch.reservedEgressUpperBoundBytes,
      revision3AccountingBound:
        after.lastAccountingDigest === batch.accountingDigest,
      onePendingScanAfterCommit:
        requiredInteger(boundary.pendingCount, 'boundary.pendingCount') === 1,
      noLeasedOrRetryMessagesAfterCommit:
        requiredInteger(boundary.leasedCount, 'boundary.leasedCount') === 0
        && requiredInteger(boundary.retryCount, 'boundary.retryCount') === 0,
      noInflightWorkAfterCommit:
        requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') === 0,
      activeRecoveryStarted: after.status === 'running',
      lagZero: after.status === 'caught_up',
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-r5-first-recovery-batch.json`,
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
    purpose: 'r5-supabase-first-active-recovery-batch-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    batchId: firstBatchId,
    error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    checks: {
      firstBatchCompleted: false,
      activeRecoveryStarted: false,
      lagZero: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-r5-first-recovery-batch-verification.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}
