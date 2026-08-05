import { describe, expect, it } from 'vitest'

import { isExactUncommittedWatermarkDriftFailure } from '../../scripts/r5-preclaim-watermark-drift-match.mjs'

const actualFailedRunResponse = {
  schemaVersion: 1,
  purpose: 'r5-first-active-recovery-batch',
  operationMode: 'execute_batch',
  executor: {
    ok: false,
    transient: false,
    runId: 'r5-recovery-selected-revision3-entry',
    batchId: null,
    error:
      'xrpl_claim_r5_active_recovery_batch_from_prepared_head failed (400): {"code":"P0001","details":null,"hint":null,"message":"r5_recovery_batch_watermark_drift"}',
    activeMutationCommitted: false,
  },
  trigger: {
    noLedgerScanInFinalizationMode: false,
  },
}

function failure(response = actualFailedRunResponse, status = 500) {
  return {
    name: 'TriggerError',
    message: `R5 trigger failed (${status}): ${JSON.stringify(response)}`,
    transient: false,
    response,
  }
}

describe('R5 exact uncommitted watermark drift failure matcher', () => {
  it('matches the exact production TriggerError from run 31016519593', () => {
    expect(
      isExactUncommittedWatermarkDriftFailure(
        failure(actualFailedRunResponse, 500),
      ),
    ).toBe(true)
  })

  it.each([
    ['status', failure(actualFailedRunResponse, 409)],
    [
      'error name',
      { ...failure(), name: 'Error' },
    ],
    [
      'transient boundary',
      { ...failure(), transient: true },
    ],
    [
      'schema version',
      failure({ ...actualFailedRunResponse, schemaVersion: 2 }),
    ],
    [
      'purpose',
      failure({ ...actualFailedRunResponse, purpose: 'other-purpose' }),
    ],
    [
      'operation mode',
      failure({ ...actualFailedRunResponse, operationMode: 'finalize_boundary' }),
    ],
    [
      'run id',
      failure({
        ...actualFailedRunResponse,
        executor: { ...actualFailedRunResponse.executor, runId: 'other-run' },
      }),
    ],
    [
      'batch id',
      failure({
        ...actualFailedRunResponse,
        executor: { ...actualFailedRunResponse.executor, batchId: 'batch-1' },
      }),
    ],
    [
      'committed mutation',
      failure({
        ...actualFailedRunResponse,
        executor: {
          ...actualFailedRunResponse.executor,
          activeMutationCommitted: true,
        },
      }),
    ],
    [
      'different error',
      failure({
        ...actualFailedRunResponse,
        executor: {
          ...actualFailedRunResponse.executor,
          error: 'some_other_error',
        },
      }),
    ],
  ])('rejects a changed %s boundary', (_name, changedFailure) => {
    expect(isExactUncommittedWatermarkDriftFailure(changedFailure)).toBe(false)
  })
})
