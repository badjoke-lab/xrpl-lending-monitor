const r5PreclaimRecoveryRunId = 'r5-recovery-selected-revision3-entry'
const r5PreclaimPurpose = 'r5-first-active-recovery-batch'
const r5PreclaimExactWatermarkDrift = 'r5_recovery_batch_watermark_drift'

export function isExactUncommittedWatermarkDriftFailure(error) {
  const body = error?.response
  const executor = body?.executor
  return error?.name === 'TriggerError'
    && error?.transient === false
    && typeof error?.message === 'string'
    && error.message.startsWith('R5 trigger failed (500): ')
    && body?.schemaVersion === 1
    && body?.purpose === r5PreclaimPurpose
    && body?.operationMode === 'execute_batch'
    && executor?.ok === false
    && executor?.transient === false
    && executor?.runId === r5PreclaimRecoveryRunId
    && executor?.batchId === null
    && executor?.activeMutationCommitted === false
    && typeof executor?.error === 'string'
    && executor.error.includes(r5PreclaimExactWatermarkDrift)
}
