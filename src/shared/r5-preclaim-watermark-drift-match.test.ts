import { describe, expect, it } from 'vitest'

import { isExactUncommittedWatermarkDrift } from '../../scripts/r5-preclaim-watermark-drift-match.mjs'

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

describe('R5 exact uncommitted watermark drift matcher', () => {
  it('matches the exact production response from run 31015285563', () => {
    expect(
      isExactUncommittedWatermarkDrift(
        new Response(JSON.stringify(actualFailedRunResponse), { status: 500 }),
        actualFailedRunResponse,
      ),
    ).toBe(true)
  })

  it.each([
    ['status', 409, actualFailedRunResponse],
    [
      'schema version',
      500,
      { ...actualFailedRunResponse, schemaVersion: 2 },
    ],
    [
      'purpose',
      500,
      { ...actualFailedRunResponse, purpose: 'other-purpose' },
    ],
    [
      'operation mode',
      500,
      { ...actualFailedRunResponse, operationMode: 'finalize_boundary' },
    ],
    [
      'run id',
      500,
      {
        ...actualFailedRunResponse,
        executor: { ...actualFailedRunResponse.executor, runId: 'other-run' },
      },
    ],
    [
      'batch id',
      500,
      {
        ...actualFailedRunResponse,
        executor: { ...actualFailedRunResponse.executor, batchId: 'batch-1' },
      },
    ],
    [
      'committed mutation',
      500,
      {
        ...actualFailedRunResponse,
        executor: {
          ...actualFailedRunResponse.executor,
          activeMutationCommitted: true,
        },
      },
    ],
    [
      'transient error',
      500,
      {
        ...actualFailedRunResponse,
        executor: { ...actualFailedRunResponse.executor, transient: true },
      },
    ],
    [
      'different error',
      500,
      {
        ...actualFailedRunResponse,
        executor: {
          ...actualFailedRunResponse.executor,
          error: 'some_other_error',
        },
      },
    ],
  ])('rejects a changed %s boundary', (_name, status, body) => {
    expect(
      isExactUncommittedWatermarkDrift(
        new Response(JSON.stringify(body), { status }),
        body,
      ),
    ).toBe(false)
  })
})
