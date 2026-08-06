import { describe, expect, it } from 'vitest'
import {
  attributeR5RecoveryBatchEgress,
  deterministicR5ExecutorEgressFloor,
  summarizeR5RecoveryEgressAttribution,
} from './r5-retained-egress-attribution'

describe('R5 retained egress attribution', () => {
  it('reconstructs the deterministic floor for a 12-ledger executor batch', () => {
    expect(deterministicR5ExecutorEgressFloor(12)).toEqual({
      networkRequestCount: 13,
      databaseRequestCount: 3,
      deterministicExactWireReserveBytes: 2_375_680,
      deterministicRequestOverheadBytes: 303_104,
      deterministicConservativeFloorBytes: 9_805_824,
    })
  })

  it('separates deterministic and unretained wire contributions', () => {
    expect(attributeR5RecoveryBatchEgress({
      batchId: 'r5-batch-sample-260',
      status: 'completed',
      ledgerCount: 12,
      reservedBytes: 134_217_728,
      finalizedBytes: 10_658_256,
      effectiveBytes: 10_658_256,
    })).toEqual({
      mode: 'executor',
      batchId: 'r5-batch-sample-260',
      ledgerCount: 12,
      effectiveBytes: 10_658_256,
      networkRequestCount: 13,
      databaseRequestCount: 3,
      deterministicExactWireReserveBytes: 2_375_680,
      deterministicRequestOverheadBytes: 303_104,
      deterministicConservativeFloorBytes: 9_805_824,
      unretainedExactWireBytes: 213_108,
      unretainedConservativeBytes: 852_432,
      deterministicFloorShare: 9_805_824 / 10_658_256,
      effectiveBytesPerLedger: 10_658_256 / 12,
    })
  })

  it('classifies adopted descendants as zero-egress committed ledgers', () => {
    expect(attributeR5RecoveryBatchEgress({
      batchId: 'r5-adopted-sample',
      status: 'completed',
      ledgerCount: 24,
      reservedBytes: 134_217_728,
      finalizedBytes: 0,
      effectiveBytes: 0,
    })).toEqual({
      mode: 'adopted_zero_egress',
      batchId: 'r5-adopted-sample',
      ledgerCount: 24,
      effectiveBytes: 0,
    })
  })

  it('retains the full reservation for a failed batch', () => {
    expect(attributeR5RecoveryBatchEgress({
      batchId: 'r5-failed-sample',
      status: 'halted',
      ledgerCount: 12,
      reservedBytes: 134_217_728,
      finalizedBytes: null,
      effectiveBytes: 134_217_728,
    })).toEqual({
      mode: 'full_reservation',
      batchId: 'r5-failed-sample',
      ledgerCount: 12,
      effectiveBytes: 134_217_728,
      reservedBytes: 134_217_728,
      status: 'halted',
    })
  })

  it('reconciles executor, adoption, and full-reservation contributions', () => {
    const summary = summarizeR5RecoveryEgressAttribution([
      {
        batchId: 'executor',
        status: 'completed',
        ledgerCount: 12,
        reservedBytes: 134_217_728,
        finalizedBytes: 10_658_256,
        effectiveBytes: 10_658_256,
      },
      {
        batchId: 'adopted',
        status: 'completed',
        ledgerCount: 24,
        reservedBytes: 134_217_728,
        finalizedBytes: 0,
        effectiveBytes: 0,
      },
      {
        batchId: 'failed',
        status: 'halted',
        ledgerCount: 12,
        reservedBytes: 134_217_728,
        finalizedBytes: null,
        effectiveBytes: 134_217_728,
      },
    ])

    expect(summary).toMatchObject({
      batchCount: 3,
      completedExecutorBatchCount: 1,
      adoptedBatchCount: 1,
      fullReservationBatchCount: 1,
      executorLedgerCount: 12,
      adoptedLedgerCount: 24,
      effectiveBytes: 144_875_984,
      deterministicConservativeFloorBytes: 9_805_824,
      unretainedConservativeBytes: 852_432,
      fullReservationBytes: 134_217_728,
      reconciled: true,
    })
    expect(summary.deterministicFloorShareOfExecutorBytes).toBeCloseTo(
      9_805_824 / 10_658_256,
    )
  })

  it('rejects totals that cannot come from the revision-3 formula', () => {
    expect(() => attributeR5RecoveryBatchEgress({
      batchId: 'invalid',
      status: 'completed',
      ledgerCount: 12,
      reservedBytes: 134_217_728,
      finalizedBytes: 9_805_825,
      effectiveBytes: 9_805_825,
    })).toThrow('wire multiplier')
  })
})
