import { rewriteR5CollectorContentionResponse } from './r5-collector-contention-retry.mjs'

const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const purpose = 'r5-first-active-recovery-batch'
const exactWatermarkDrift = 'r5_recovery_batch_watermark_drift'
const originalFetch = globalThis.fetch.bind(globalThis)
let preclaimFinalizationUsed = false

function parseObjectBody(body) {
  if (typeof body !== 'string') return null
  try {
    const parsed = JSON.parse(body)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

async function parseResponseObject(response) {
  try {
    const parsed = await response.clone().json()
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : null
  } catch {
    return null
  }
}

function isExactUncommittedWatermarkDrift(response, body, requestBody) {
  const executor = body?.executor
  return response.status === 500
    && requestBody?.run_id === recoveryRunId
    && requestBody?.mode !== 'finalize_boundary'
    && body?.purpose === purpose
    && body?.operationMode === 'execute_batch'
    && executor?.ok === false
    && executor?.transient === false
    && executor?.runId === recoveryRunId
    && executor?.batchId === null
    && executor?.activeMutationCommitted === false
    && typeof executor?.error === 'string'
    && executor.error.includes(exactWatermarkDrift)
}

function exactPositiveRunId() {
  const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? '')
  if (!Number.isSafeInteger(sourceRunId) || sourceRunId < 1) {
    throw new Error('GITHUB_RUN_ID must be a positive integer for R5 preclaim finalization')
  }
  return sourceRunId
}

async function finalizeBoundaryBeforeClaim(input, init) {
  const finalizationResponse = await originalFetch(input, {
    ...init,
    body: JSON.stringify({
      source: 'github_actions',
      run_id: recoveryRunId,
      mode: 'finalize_boundary',
      source_run_id: exactPositiveRunId(),
    }),
    signal: AbortSignal.timeout(90_000),
  })
  const finalizationBody = await parseResponseObject(finalizationResponse)
  const finalization = finalizationBody?.finalization
  const trigger = finalizationBody?.trigger

  if (
    !finalizationResponse.ok
    || finalizationBody?.schemaVersion !== 1
    || finalizationBody?.purpose !== purpose
    || finalizationBody?.operationMode !== 'finalize_boundary'
    || finalization?.finalized !== true
    || finalization?.runId !== recoveryRunId
    || finalization?.sourceRunId !== exactPositiveRunId()
    || finalization?.noScanExecuted !== true
    || finalization?.publicReaderUnchanged !== true
    || finalization?.mainnetDisabled !== true
    || finalization?.stabilizationAuthorized !== false
    || finalization?.soakAuthorized !== false
    || trigger?.combinedProxyBytesWithinFixedReserve !== true
    || trigger?.twoInvocationReservationUsed !== true
    || trigger?.serviceKeyNotReturned !== true
    || trigger?.noLedgerScanInFinalizationMode !== true
  ) {
    throw new Error(
      `R5 preclaim finalization failed closed: ${JSON.stringify(finalizationBody).slice(0, 2_000)}`,
    )
  }

  console.log(JSON.stringify({
    event: 'r5_preclaim_watermark_drift_finalized',
    sourceRunId: finalization.sourceRunId,
    currentWatermarkLedgerIndex: finalization.currentWatermarkLedgerIndex,
    drainedStepCount: finalization.drainedStepCount,
    noScanExecuted: true,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  }))
}

globalThis.fetch = async (input, init) => {
  const response = await originalFetch(input, init)
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.href
      : input.url
  const requestBody = parseObjectBody(init?.body)
  const responseBody = await parseResponseObject(response)

  if (
    !preclaimFinalizationUsed
    && url.includes('/functions/v1/xrpl-r5-recovery-batch-trigger')
    && isExactUncommittedWatermarkDrift(response, responseBody, requestBody)
  ) {
    preclaimFinalizationUsed = true
    await finalizeBoundaryBeforeClaim(input, init)
    const retriedResponse = await originalFetch(input, init)
    return rewriteR5CollectorContentionResponse(url, retriedResponse)
  }

  return rewriteR5CollectorContentionResponse(url, response)
}

try {
  await import('./run-supabase-r5-recovery-burst-adoption-aware.mjs')
} finally {
  globalThis.fetch = originalFetch
}
