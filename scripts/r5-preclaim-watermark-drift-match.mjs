const recoveryRunId = 'r5-recovery-selected-revision3-entry'
const purpose = 'r5-first-active-recovery-batch'
const exactWatermarkDrift = 'r5_recovery_batch_watermark_drift'

export function isExactUncommittedWatermarkDrift(response, body) {
  const executor = body?.executor
  return response?.status === 500
    && body?.schemaVersion === 1
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

export const r5PreclaimWatermarkDriftBoundary = Object.freeze({
  recoveryRunId,
  purpose,
  exactWatermarkDrift,
})
