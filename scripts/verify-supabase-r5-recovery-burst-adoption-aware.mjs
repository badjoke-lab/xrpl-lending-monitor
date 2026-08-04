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

function boundedIntegerEnvironment(name, fallback, minimum, maximum) {
  const raw = process.env[name]
  const value = raw === undefined || raw === '' ? fallback : Number(raw)
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

const batchLimit = boundedIntegerEnvironment('R5_RECOVERY_BURST_BATCH_LIMIT', 8, 1, 64)
const wallSeconds = boundedIntegerEnvironment('R5_RECOVERY_BURST_WALL_SECONDS', 900, 60, 1800)
const purpose = 'r5-first-active-recovery-batch'
const recoveryRunId = 'r5-recovery-selected-revision3-entry'
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
const evidenceDirectory = 'supabase-r5-recovery-burst-evidence'
const maximumAttemptsPerTrigger = 3
const retryDelayMilliseconds = 60_000
const transientStatuses = new Set([429, 500, 502, 503, 504, 520, 522, 524])
const terminalStopReasons = new Set([
  'recovery_already_caught_up',
  'caught_up_at_claim_boundary',
  'fresh_head_refresh_required',
])
const retryableDeclineReasons = new Set(['batch_lease_active', 'not_claimed'])

class TriggerError extends Error {
  constructor(message, { transient = false, response = null } = {}) {
    super(message)
    this.name = 'TriggerError'
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
    throw new TriggerError(
      `Supabase Management query transport failed: ${error instanceof Error ? error.message : String(error)}`,
      { transient: true },
    )
  }
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new TriggerError(
      `Supabase Management query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`,
      { transient: transientStatuses.has(response.status), response: body },
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
      { transient, response: body },
    )
  }
  return object(body, 'R5 trigger response')
}

async function verifyCycle(before, beforeAdoptions, after, afterAdoptions, remainingLimit) {
  const advancedBatches = after.completedBatches - before.completedBatches
  const advancedLedgers = after.committedLedgers - before.committedLedgers
  const addedAdoptions = afterAdoptions.adoptionCount - beforeAdoptions.adoptionCount
  if (
    advancedBatches < 0
    || advancedLedgers < 0
    || advancedBatches > remainingLimit
    || ![0, 1].includes(addedAdoptions)
  ) {
    throw new Error('R5 trigger exceeded the finite cycle advance boundary')
  }
  if (advancedBatches === 0) {
    if (
      advancedLedgers !== 0
      || addedAdoptions !== 0
      || after.currentWatermark.ledgerIndex !== before.currentWatermark.ledgerIndex
      || after.currentWatermark.ledgerHash !== before.currentWatermark.ledgerHash
      || after.currentWatermark.workId !== before.currentWatermark.workId
    ) {
      throw new Error('R5 trigger changed recovery without a completed batch')
    }
    return { batches: [], adoptions: [], advancedBatches: 0, advancedLedgers: 0 }
  }

  let adoption = null
  let adoptedBatchCount = 0
  if (addedAdoptions === 1) {
    adoption = normalizeAdoption(
      afterAdoptions.adoptions.at(-1),
      afterAdoptions.adoptionCount,
    )
    adoptedBatchCount = adoption.adoptedBatchCount
    const executorBatchCount = advancedBatches - adoptedBatchCount
    if (
      afterAdoptions.adoptedLedgerCount
        !== beforeAdoptions.adoptedLedgerCount + adoption.ledgerCount
      || afterAdoptions.adoptedBatchCount
        !== beforeAdoptions.adoptedBatchCount + adoptedBatchCount
      || adoption.firstBatchSequence !== before.completedBatches + 1
      || adoption.startLedgerIndex !== before.currentWatermark.ledgerIndex + 1
      || adoption.expectedParentHash !== before.currentWatermark.ledgerHash
      || adoptedBatchCount < 1
      || ![0, 1].includes(executorBatchCount)
    ) {
      throw new Error('R5 adoption did not bind to the exact prior recovery boundary')
    }
  } else if (advancedBatches !== 1) {
    throw new Error('R5 trigger advanced multiple batches without one adoption record')
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
      throw new Error(`R5 cycle batch ${sequence} is not hash-contiguous`)
    }
    const adopted = adoption !== null
      && sequence < adoption.firstBatchSequence + adoptedBatchCount
    if (adopted && batch.finalizedEgressUpperBoundBytes !== 0) {
      throw new Error(`R5 adopted batch ${sequence} added recovery egress`)
    }
    batches.push({
      ...batch,
      origin: adopted ? 'adopted_active_descendant' : 'r5_executor',
    })
    summedLedgers += batch.ledgerCount
    expectedLedgerIndex = batch.endLedgerIndex + 1
    expectedParentHash = batch.finalLedgerHash
  }

  const lastBatch = batches.at(-1)
  if (
    summedLedgers !== advancedLedgers
    || after.currentWatermark.ledgerIndex !== lastBatch?.endLedgerIndex
    || after.currentWatermark.ledgerHash !== lastBatch?.finalLedgerHash
    || after.currentWatermark.workId !== lastBatch?.finalWorkId
    || after.lastAccountingDigest !== lastBatch?.accountingDigest
  ) {
    throw new Error('R5 trigger batch chain did not match final recovery state')
  }
  if (adoption !== null) {
    const adoptedBatches = batches.slice(0, adoptedBatchCount)
    const adoptedLedgers = adoptedBatches.reduce((sum, batch) => sum + batch.ledgerCount, 0)
    const lastAdoptedBatch = adoptedBatches.at(-1)
    if (
      adoptedLedgers !== adoption.ledgerCount
      || lastAdoptedBatch?.endLedgerIndex !== adoption.endLedgerIndex
      || lastAdoptedBatch?.finalLedgerHash !== adoption.finalLedgerHash
      || lastAdoptedBatch?.finalWorkId !== adoption.finalWorkId
    ) {
      throw new Error('R5 adopted batch records did not match the adoption summary')
    }
  }
  return {
    batches,
    adoptions: adoption === null ? [] : [adoption],
    advancedBatches,
    advancedLedgers,
  }
}

async function executeOneCycle(before, beforeAdoptions, remainingLimit, deadlineMilliseconds) {
  let transientRetries = 0
  let lastTrigger = null
  for (let attempt = 1; attempt <= maximumAttemptsPerTrigger; attempt += 1) {
    if (Date.now() >= deadlineMilliseconds) {
      return {
        stopped: true,
        reason: 'wall_clock_limit',
        transientRetries,
        lastTrigger,
        cycle: null,
        after: before,
        afterAdoptions: beforeAdoptions,
      }
    }

    try {
      lastTrigger = await invokeTrigger()
    } catch (error) {
      if (!(error instanceof TriggerError) || error.transient !== true) throw error
      transientRetries += 1
      lastTrigger = error.response
    }

    const after = await readRecovery()
    const afterAdoptions = await readAdoptions()
    const cycle = await verifyCycle(
      before,
      beforeAdoptions,
      after,
      afterAdoptions,
      remainingLimit,
    )
    if (cycle.advancedBatches > 0) {
      return {
        stopped: false,
        reason: null,
        transientRetries,
        lastTrigger,
        cycle,
        after,
        afterAdoptions,
        verifierAttempt: attempt,
      }
    }

    const executor = lastTrigger && typeof lastTrigger === 'object'
      ? object(lastTrigger.executor, 'R5 executor response')
      : null
    if (executor?.ok === true && executor.claimed === false) {
      const reason = requiredString(executor.reason, 'executor reason')
      if (terminalStopReasons.has(reason)) {
        return {
          stopped: true,
          reason,
          transientRetries,
          lastTrigger,
          cycle,
          after,
          afterAdoptions,
        }
      }
      if (!retryableDeclineReasons.has(reason)) {
        throw new Error(`R5 executor declined the finite cycle: ${reason}`)
      }
    }

    if (attempt === maximumAttemptsPerTrigger) {
      throw new Error('R5 trigger made no progress within bounded retries')
    }
    if (Date.now() + retryDelayMilliseconds >= deadlineMilliseconds) {
      return {
        stopped: true,
        reason: 'wall_clock_limit',
        transientRetries,
        lastTrigger,
        cycle,
        after,
        afterAdoptions,
      }
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMilliseconds))
  }
  throw new Error('R5 trigger retry loop exhausted')
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const startedAtMilliseconds = Date.now()
  const deadlineMilliseconds = startedAtMilliseconds + wallSeconds * 1_000
  const before = await readRecovery()
  if (before.completedBatches < 1 || before.committedLedgers < 1) {
    throw new Error('R5 first recovery batch must be verified before burst execution')
  }
  let current = before
  let currentAdoptions = await readAdoptions()
  const batches = []
  const adoptions = []
  const cycles = []
  let stopReason = null
  let transientRetries = 0

  while (batches.length < batchLimit) {
    if (current.status === 'caught_up') {
      stopReason = 'recovery_already_caught_up'
      break
    }
    if (Date.now() >= deadlineMilliseconds) {
      stopReason = 'wall_clock_limit'
      break
    }
    const remainingLimit = batchLimit - batches.length
    const result = await executeOneCycle(
      current,
      currentAdoptions,
      remainingLimit,
      deadlineMilliseconds,
    )
    transientRetries += result.transientRetries
    if (result.stopped) {
      stopReason = result.reason
      current = result.after
      currentAdoptions = result.afterAdoptions
      break
    }
    const cycleBatches = result.cycle.batches.map((batch) => ({
      ...batch,
      verifierAttempt: result.verifierAttempt,
      transientRetries: result.transientRetries,
    }))
    batches.push(...cycleBatches)
    adoptions.push(...result.cycle.adoptions)
    cycles.push({
      verifierAttempt: result.verifierAttempt,
      transientRetries: result.transientRetries,
      advancedBatches: result.cycle.advancedBatches,
      advancedLedgers: result.cycle.advancedLedgers,
      batchSequences: cycleBatches.map((batch) => batch.batchSequence),
      adoptionSequences: result.cycle.adoptions.map((adoption) => adoption.adoptionSequence),
    })
    current = result.after
    currentAdoptions = result.afterAdoptions
  }
  if (stopReason === null) stopReason = 'batch_limit'

  const after = await readRecovery()
  const finalAdoptions = await readAdoptions()
  const boundary = object(await readActiveBoundary(), 'R5 active boundary')
  const boundaryWatermark = watermark(boundary.watermark, 'R5 active boundary watermark')
  const currentValidatedHead = await readValidatedHead()
  const advancedBatches = after.completedBatches - before.completedBatches
  const advancedLedgers = after.committedLedgers - before.committedLedgers
  const summedLedgers = batches.reduce((sum, batch) => sum + batch.ledgerCount, 0)
  if (
    advancedBatches !== batches.length
    || advancedLedgers !== summedLedgers
    || after.currentWatermark.ledgerIndex !== before.currentWatermark.ledgerIndex + advancedLedgers
    || boundaryWatermark.ledgerIndex !== after.currentWatermark.ledgerIndex
    || boundaryWatermark.ledgerHash !== after.currentWatermark.ledgerHash
    || boundaryWatermark.workId !== after.currentWatermark.workId
    || requiredInteger(boundary.pendingCount, 'boundary.pendingCount') !== 1
    || requiredInteger(boundary.leasedCount, 'boundary.leasedCount') !== 0
    || requiredInteger(boundary.retryCount, 'boundary.retryCount') !== 0
    || requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') !== 0
    || currentValidatedHead.ledgerIndex < after.currentWatermark.ledgerIndex
    || batches.length > batchLimit
    || Date.now() > deadlineMilliseconds + 30_000
    || finalAdoptions.adoptionCount - currentAdoptions.adoptionCount !== 0
  ) {
    throw new Error('R5 adoption-aware recovery burst final parity failed')
  }
  if (batches.length === 0 && ![
    'recovery_already_caught_up',
    'caught_up_at_claim_boundary',
    'fresh_head_refresh_required',
    'wall_clock_limit',
  ].includes(stopReason)) {
    throw new Error(`R5 recovery burst made no progress: ${stopReason}`)
  }

  const evidence = {
    schemaVersion: 2,
    purpose: 'r5-supabase-active-recovery-burst-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    requestedBatchLimit: batchLimit,
    wallSeconds,
    elapsedMilliseconds: Date.now() - startedAtMilliseconds,
    stopReason,
    transientRetries,
    before: {
      status: before.status,
      completedBatches: before.completedBatches,
      committedLedgers: before.committedLedgers,
      currentWatermark: before.currentWatermark,
    },
    cycles,
    adoptions,
    batches,
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
      pendingCount: requiredInteger(boundary.pendingCount, 'boundary.pendingCount'),
      leasedCount: requiredInteger(boundary.leasedCount, 'boundary.leasedCount'),
      retryCount: requiredInteger(boundary.retryCount, 'boundary.retryCount'),
      inflightWorkCount: requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount'),
    },
    checks: {
      firstBatchPreviouslyVerified: before.completedBatches >= 1,
      boundedBatchLimit: batchLimit <= 64 && batches.length <= batchLimit,
      boundedWallClock: wallSeconds <= 1800,
      everyTriggerAdvanceVerified: cycles.every((cycle) => cycle.advancedBatches >= 1),
      adoptionRecordsBoundToExactCycles:
        adoptions.length === cycles.reduce(
          (sum, cycle) => sum + cycle.adoptionSequences.length,
          0,
        ),
      exactBatchAdvance: advancedBatches === batches.length,
      exactLedgerAdvance: advancedLedgers === summedLedgers,
      onePendingScanAfterBurst: requiredInteger(boundary.pendingCount, 'boundary.pendingCount') === 1,
      noLeasedOrRetryMessagesAfterBurst:
        requiredInteger(boundary.leasedCount, 'boundary.leasedCount') === 0
        && requiredInteger(boundary.retryCount, 'boundary.retryCount') === 0,
      noInflightWorkAfterBurst: requiredInteger(boundary.inflightWorkCount, 'boundary.inflightWorkCount') === 0,
      activeRecoveryStarted: after.status === 'running',
      lagZero: after.status === 'caught_up',
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/verified-r5-recovery-burst.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 2,
    purpose: 'r5-supabase-active-recovery-burst-verification',
    verifiedAt: new Date().toISOString(),
    sourceRunId: Number(process.env.GITHUB_RUN_ID ?? 0) || null,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    issueNumber: 1175,
    recoveryRunId,
    requestedBatchLimit: batchLimit,
    wallSeconds,
    error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    checks: {
      burstCompleted: false,
      everyTriggerAdvanceFailClosed: true,
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
