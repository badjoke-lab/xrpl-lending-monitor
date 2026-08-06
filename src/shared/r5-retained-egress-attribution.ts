export const R5_EGRESS_WIRE_MULTIPLIER = 4
export const R5_NETWORK_REQUEST_OVERHEAD_BYTES = 16 * 1024
export const R5_DATABASE_REQUEST_OVERHEAD_BYTES = 8 * 1024
export const R5_FIXED_TICK_OVERHEAD_BYTES = 64 * 1024
export const R5_COMPLETION_REQUEST_RESERVE_BYTES = 2 * 1024 * 1024
export const R5_FAILURE_REQUEST_RESERVE_BYTES = 16 * 1024
export const R5_DATABASE_RESPONSE_RESERVE_BYTES = 2 * 64 * 1024
export const R5_FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024
export const R5_DATABASE_REQUEST_COUNT = 3
export const R5_HEAD_REQUEST_COUNT = 1

export interface R5RecoveryEgressContributionInput {
  batchId: string
  status: string
  ledgerCount: number
  reservedBytes: number
  finalizedBytes: number | null
  effectiveBytes: number
}

export interface R5ExecutorBatchEgressAttribution {
  mode: 'executor'
  batchId: string
  ledgerCount: number
  effectiveBytes: number
  networkRequestCount: number
  databaseRequestCount: number
  deterministicExactWireReserveBytes: number
  deterministicRequestOverheadBytes: number
  deterministicConservativeFloorBytes: number
  unretainedExactWireBytes: number
  unretainedConservativeBytes: number
  deterministicFloorShare: number
  effectiveBytesPerLedger: number
}

export interface R5AdoptedBatchEgressAttribution {
  mode: 'adopted_zero_egress'
  batchId: string
  ledgerCount: number
  effectiveBytes: 0
}

export interface R5FullReservationEgressAttribution {
  mode: 'full_reservation'
  batchId: string
  ledgerCount: number
  effectiveBytes: number
  reservedBytes: number
  status: string
}

export type R5RecoveryBatchEgressAttribution =
  | R5ExecutorBatchEgressAttribution
  | R5AdoptedBatchEgressAttribution
  | R5FullReservationEgressAttribution

export interface R5RecoveryEgressAttributionSummary {
  batchCount: number
  completedExecutorBatchCount: number
  adoptedBatchCount: number
  fullReservationBatchCount: number
  executorLedgerCount: number
  adoptedLedgerCount: number
  effectiveBytes: number
  deterministicConservativeFloorBytes: number
  unretainedConservativeBytes: number
  fullReservationBytes: number
  deterministicFloorShareOfExecutorBytes: number | null
  reconciled: boolean
  batches: R5RecoveryBatchEgressAttribution[]
}

function requireInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function requireBatchId(value: string): string {
  if (value.trim().length === 0) throw new Error('batchId must be non-empty')
  return value
}

export function deterministicR5ExecutorEgressFloor(ledgerCount: number): {
  networkRequestCount: number
  databaseRequestCount: number
  deterministicExactWireReserveBytes: number
  deterministicRequestOverheadBytes: number
  deterministicConservativeFloorBytes: number
} {
  requireInteger(ledgerCount, 'ledgerCount')
  if (ledgerCount < 1 || ledgerCount > 24) {
    throw new Error('ledgerCount must be between 1 and 24')
  }

  const networkRequestCount = ledgerCount + R5_HEAD_REQUEST_COUNT
  const deterministicExactWireReserveBytes =
    R5_COMPLETION_REQUEST_RESERVE_BYTES +
    R5_FAILURE_REQUEST_RESERVE_BYTES +
    R5_DATABASE_RESPONSE_RESERVE_BYTES +
    R5_FUNCTION_RESPONSE_RESERVE_BYTES
  const deterministicRequestOverheadBytes =
    networkRequestCount * R5_NETWORK_REQUEST_OVERHEAD_BYTES +
    R5_DATABASE_REQUEST_COUNT * R5_DATABASE_REQUEST_OVERHEAD_BYTES +
    R5_FIXED_TICK_OVERHEAD_BYTES
  const deterministicConservativeFloorBytes =
    deterministicExactWireReserveBytes * R5_EGRESS_WIRE_MULTIPLIER +
    deterministicRequestOverheadBytes

  return {
    networkRequestCount,
    databaseRequestCount: R5_DATABASE_REQUEST_COUNT,
    deterministicExactWireReserveBytes,
    deterministicRequestOverheadBytes,
    deterministicConservativeFloorBytes,
  }
}

export function attributeR5RecoveryBatchEgress(
  input: R5RecoveryEgressContributionInput,
): R5RecoveryBatchEgressAttribution {
  const batchId = requireBatchId(input.batchId)
  const ledgerCount = requireInteger(input.ledgerCount, `${batchId}.ledgerCount`)
  const reservedBytes = requireInteger(input.reservedBytes, `${batchId}.reservedBytes`)
  const effectiveBytes = requireInteger(input.effectiveBytes, `${batchId}.effectiveBytes`)
  const finalizedBytes =
    input.finalizedBytes === null
      ? null
      : requireInteger(input.finalizedBytes, `${batchId}.finalizedBytes`)

  if (input.status !== 'completed') {
    if (effectiveBytes !== reservedBytes) {
      throw new Error(`${batchId} noncompleted effective bytes must retain the reservation`)
    }
    return {
      mode: 'full_reservation',
      batchId,
      ledgerCount,
      effectiveBytes,
      reservedBytes,
      status: input.status,
    }
  }

  if (finalizedBytes === null || finalizedBytes !== effectiveBytes) {
    throw new Error(`${batchId} completed finalized bytes must equal effective bytes`)
  }
  if (effectiveBytes === 0) {
    return {
      mode: 'adopted_zero_egress',
      batchId,
      ledgerCount,
      effectiveBytes: 0,
    }
  }

  const floor = deterministicR5ExecutorEgressFloor(ledgerCount)
  if (effectiveBytes < floor.deterministicConservativeFloorBytes) {
    throw new Error(`${batchId} finalized bytes are below the deterministic executor floor`)
  }

  const exactWireNumerator =
    effectiveBytes - floor.deterministicRequestOverheadBytes
  if (exactWireNumerator % R5_EGRESS_WIRE_MULTIPLIER !== 0) {
    throw new Error(`${batchId} finalized bytes do not reconcile with the wire multiplier`)
  }
  const exactWireBytes = exactWireNumerator / R5_EGRESS_WIRE_MULTIPLIER
  const unretainedExactWireBytes =
    exactWireBytes - floor.deterministicExactWireReserveBytes
  if (unretainedExactWireBytes < 0) {
    throw new Error(`${batchId} exact wire bytes are below retained fixed reserves`)
  }
  const unretainedConservativeBytes =
    unretainedExactWireBytes * R5_EGRESS_WIRE_MULTIPLIER

  return {
    mode: 'executor',
    batchId,
    ledgerCount,
    effectiveBytes,
    networkRequestCount: floor.networkRequestCount,
    databaseRequestCount: floor.databaseRequestCount,
    deterministicExactWireReserveBytes:
      floor.deterministicExactWireReserveBytes,
    deterministicRequestOverheadBytes:
      floor.deterministicRequestOverheadBytes,
    deterministicConservativeFloorBytes:
      floor.deterministicConservativeFloorBytes,
    unretainedExactWireBytes,
    unretainedConservativeBytes,
    deterministicFloorShare:
      floor.deterministicConservativeFloorBytes / effectiveBytes,
    effectiveBytesPerLedger: effectiveBytes / ledgerCount,
  }
}

export function summarizeR5RecoveryEgressAttribution(
  inputs: readonly R5RecoveryEgressContributionInput[],
): R5RecoveryEgressAttributionSummary {
  const batches = inputs.map(attributeR5RecoveryBatchEgress)
  let completedExecutorBatchCount = 0
  let adoptedBatchCount = 0
  let fullReservationBatchCount = 0
  let executorLedgerCount = 0
  let adoptedLedgerCount = 0
  let effectiveBytes = 0
  let executorBytes = 0
  let deterministicConservativeFloorBytes = 0
  let unretainedConservativeBytes = 0
  let fullReservationBytes = 0

  for (const batch of batches) {
    effectiveBytes += batch.effectiveBytes
    if (batch.mode === 'executor') {
      completedExecutorBatchCount += 1
      executorLedgerCount += batch.ledgerCount
      executorBytes += batch.effectiveBytes
      deterministicConservativeFloorBytes +=
        batch.deterministicConservativeFloorBytes
      unretainedConservativeBytes += batch.unretainedConservativeBytes
    } else if (batch.mode === 'adopted_zero_egress') {
      adoptedBatchCount += 1
      adoptedLedgerCount += batch.ledgerCount
    } else {
      fullReservationBatchCount += 1
      fullReservationBytes += batch.effectiveBytes
    }
  }

  const attributedBytes =
    deterministicConservativeFloorBytes +
    unretainedConservativeBytes +
    fullReservationBytes

  return {
    batchCount: batches.length,
    completedExecutorBatchCount,
    adoptedBatchCount,
    fullReservationBatchCount,
    executorLedgerCount,
    adoptedLedgerCount,
    effectiveBytes,
    deterministicConservativeFloorBytes,
    unretainedConservativeBytes,
    fullReservationBytes,
    deterministicFloorShareOfExecutorBytes:
      executorBytes === 0
        ? null
        : deterministicConservativeFloorBytes / executorBytes,
    reconciled: attributedBytes === effectiveBytes,
    batches,
  }
}
