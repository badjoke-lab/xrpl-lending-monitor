import {
  buildSupabaseRevision4DirectionalAccountingEvidence,
  SupabaseRevision4DirectionalMeter,
  type SupabaseRevision4DirectionalAccountingEvidence,
} from './supabase-revision4-directional-meter'

export const SUPABASE_REVISION4_R5_RUNTIME_LIMITS = {
  selectedMaximumLedgersPerClaim: 12,
  steadyClaimsPerMinute: 2,
  catchupClaimsPerMinute: 3,
  requiredSteadyLedgersPerMinute: 21,
  requiredCatchupLedgersPerMinute: 30,
} as const

export const SUPABASE_REVISION4_R5_FRAMING_RESERVES = {
  invokerRequestBytes: 512,
  edgeToXrplRequestBytes: 512,
  xrplToEdgeResponseBytes: 1024,
  edgeToDatabaseRequestBytes: 2048,
  databaseToEdgeResponseBytes: 2048,
  edgeToInvokerResponseBytes: 1024,
} as const

export interface SupabaseRevision4R5RuntimeWireInput {
  observationId: string
  attemptId: string
  observedAt: string
  invokerRequestBytes: number
  xrplRequestBytes: number
  xrplResponseBytes: number
  databaseRequestBytes: number
  databaseResponseBytes: number
  invokerResponseBytes: number
  canonicalJsonBytes: number
  payloadBytes: number
  normalizedObjectOverheadBytes: number
  allocatorReserveBytes: number
  unexplainedDirectionalDeltaReserveBytes: number
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

export function evaluateSupabaseRevision4R5Cadence(): {
  steadyLedgersPerMinute: number
  catchupLedgersPerMinute: number
  steadyQualified: boolean
  catchupQualified: boolean
} {
  const steadyLedgersPerMinute =
    SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim
    * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.steadyClaimsPerMinute
  const catchupLedgersPerMinute =
    SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim
    * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.catchupClaimsPerMinute
  return {
    steadyLedgersPerMinute,
    catchupLedgersPerMinute,
    steadyQualified:
      steadyLedgersPerMinute
      > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.requiredSteadyLedgersPerMinute,
    catchupQualified:
      catchupLedgersPerMinute
      > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.requiredCatchupLedgersPerMinute,
  }
}

export async function buildSupabaseRevision4R5RuntimeAccounting(
  input: SupabaseRevision4R5RuntimeWireInput,
): Promise<SupabaseRevision4DirectionalAccountingEvidence> {
  const meter = new SupabaseRevision4DirectionalMeter()
  meter.recordBytes({
    operationId: 'r5.invoker.edge.request',
    boundaryId: 'invoker_to_edge_request',
    bodyBytes: nonNegativeInteger(input.invokerRequestBytes, 'invokerRequestBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.invokerRequestBytes,
  })
  meter.recordBytes({
    operationId: 'r5.edge.xrpl.requests',
    boundaryId: 'edge_to_xrpl_request',
    bodyBytes: nonNegativeInteger(input.xrplRequestBytes, 'xrplRequestBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToXrplRequestBytes,
  })
  meter.recordBytes({
    operationId: 'r5.xrpl.edge.responses',
    boundaryId: 'xrpl_to_edge_response',
    bodyBytes: nonNegativeInteger(input.xrplResponseBytes, 'xrplResponseBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.xrplToEdgeResponseBytes,
  })
  meter.recordBytes({
    operationId: 'r5.edge.database.requests',
    boundaryId: 'edge_to_database_request',
    bodyBytes: nonNegativeInteger(input.databaseRequestBytes, 'databaseRequestBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToDatabaseRequestBytes,
  })
  meter.recordBytes({
    operationId: 'r5.database.edge.responses',
    boundaryId: 'database_to_edge_response',
    bodyBytes: nonNegativeInteger(input.databaseResponseBytes, 'databaseResponseBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.databaseToEdgeResponseBytes,
  })
  meter.recordBytes({
    operationId: 'r5.edge.invoker.response',
    boundaryId: 'edge_to_invoker_response',
    bodyBytes: nonNegativeInteger(input.invokerResponseBytes, 'invokerResponseBytes'),
    framingReserveBytes: SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToInvokerResponseBytes,
  })

  return buildSupabaseRevision4DirectionalAccountingEvidence({
    schemaVersion: 1,
    observationId: input.observationId,
    attemptId: input.attemptId,
    observedAt: input.observedAt,
    disposition: 'shadow_completed',
    observations: meter.snapshot(),
    memorySupplemental: {
      canonicalJsonBytes: nonNegativeInteger(input.canonicalJsonBytes, 'canonicalJsonBytes'),
      payloadBytes: nonNegativeInteger(input.payloadBytes, 'payloadBytes'),
      normalizedObjectOverheadBytes: nonNegativeInteger(input.normalizedObjectOverheadBytes, 'normalizedObjectOverheadBytes'),
      allocatorReserveBytes: nonNegativeInteger(input.allocatorReserveBytes, 'allocatorReserveBytes'),
    },
    unexplainedDirectionalDeltaReserveBytes: nonNegativeInteger(input.unexplainedDirectionalDeltaReserveBytes, 'unexplainedDirectionalDeltaReserveBytes'),
    recoveryMutationCommitted: false,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
  })
}
