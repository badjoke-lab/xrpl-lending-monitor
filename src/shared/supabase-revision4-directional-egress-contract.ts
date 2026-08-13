export const SUPABASE_REVISION4_PROFILE = {
  schemaVersion: 1,
  profileId: 'supabase_free_postgres_pgcron_edge',
  revision: 4,
  label:
    'Supabase Free Postgres plus pg_cron and Edge Functions with directional billable-egress and independent memory/transport accounting',
  components: {
    storage: 'Supabase Free Postgres committed seven-class state and history',
    scheduler: 'Supabase pg_cron one-minute internal successor scheduling',
    execution:
      'Supabase Edge Functions plus security-definer transactional RPCs with directional billable-egress and independent memory/transport accounting',
    publication: 'separate immutable Git-backed publication',
    maintenance: 'publication-gated bounded Supabase maintenance',
    completeStateTransfer:
      'canonical export, typed empty-target restore, and post-restore continuation',
  },
} as const

export const SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'

export const SUPABASE_REVISION4_G3_SOURCE_BACKED_BILLING_AMENDMENT = {
  schemaVersion: 1,
  qualificationIssue: 1261,
  authorityDate: '2026-08-13',
  providerMeasurementResult: 'provider_surface_unqualifiable',
  sourceBackedClassification:
    'same-project Edge Function to Database/PostgREST/Supavisor traffic remains internal to the Supabase platform and is excluded from rolling billable egress while remaining fully counted by memory and transport guards',
  inferenceBoundary:
    'Supabase does not explicitly document this exact Edge-to-PostgREST path; the classification follows the current connected-client/platform-exit egress definition and the documented internal Database-to-Realtime non-egress example',
  unchangedGuards: true,
} as const

const MIB = 1024 * 1024
const GIB = 1024 * MIB

export const SUPABASE_REVISION4_FIXED_GUARDS = {
  providerMemoryHardBytes: 256 * MIB,
  projectMemoryHaltBytes: 224 * MIB,
  providerEgressHard31dBytes: 5 * GIB,
  projectEgressHalt31dBytes: 4 * GIB,
  providerInvocationHard31d: 500_000,
  projectInvocationHalt31d: 400_000,
  selectedMaximumLedgersPerClaim: 12,
} as const

export type SupabaseRevision4BoundaryId =
  | 'invoker_to_edge_request'
  | 'edge_to_invoker_response'
  | 'edge_to_xrpl_request'
  | 'xrpl_to_edge_response'
  | 'edge_to_database_request'
  | 'database_to_edge_response'
  | 'edge_to_edge_request'
  | 'edge_to_edge_response'

export type SupabaseRevision4PlatformDirection =
  | 'inbound_to_supabase'
  | 'outbound_from_supabase'
  | 'internal_or_unresolved'

export type SupabaseRevision4RollingEgressTreatment =
  | 'exclude_inbound'
  | 'exclude_provider_internal_source_backed'
  | 'include_documented_outbound'
  | 'include_conservative_until_g3'

export interface SupabaseRevision4ByteBoundaryContract {
  id: SupabaseRevision4BoundaryId
  source: string
  destination: string
  platformDirection: SupabaseRevision4PlatformDirection
  rollingEgressTreatment: SupabaseRevision4RollingEgressTreatment
  countsTowardMemoryTransport: true
  countsTowardRollingBillableEgressUpperBound: boolean
  qualificationState:
    | 'locked_g1'
    | 'requires_g3_reconciliation'
    | 'resolved_source_backed_after_g3_unqualifiable'
  rationale: string
}

export const SUPABASE_REVISION4_BYTE_BOUNDARIES: Record<
  SupabaseRevision4BoundaryId,
  SupabaseRevision4ByteBoundaryContract
> = {
  invoker_to_edge_request: {
    id: 'invoker_to_edge_request',
    source: 'workflow, pg_cron, or another connected caller',
    destination: 'Supabase Edge Function',
    platformDirection: 'inbound_to_supabase',
    rollingEgressTreatment: 'exclude_inbound',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: false,
    qualificationState: 'locked_g1',
    rationale:
      'The request enters Supabase. It remains relevant to memory and transport safety but is not outbound data sent from Supabase to a connected client.',
  },
  edge_to_invoker_response: {
    id: 'edge_to_invoker_response',
    source: 'Supabase Edge Function',
    destination: 'workflow, pg_cron, or another connected caller',
    platformDirection: 'outbound_from_supabase',
    rollingEgressTreatment: 'include_documented_outbound',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: true,
    qualificationState: 'locked_g1',
    rationale:
      'Supabase documents Edge Function data sent to a client as egress.',
  },
  edge_to_xrpl_request: {
    id: 'edge_to_xrpl_request',
    source: 'Supabase Edge Function',
    destination: 'external XRPL endpoint',
    platformDirection: 'outbound_from_supabase',
    rollingEgressTreatment: 'include_conservative_until_g3',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: true,
    qualificationState: 'requires_g3_reconciliation',
    rationale:
      'The request leaves Supabase. It is conservatively included until isolated provider reconciliation proves the billing treatment.',
  },
  xrpl_to_edge_response: {
    id: 'xrpl_to_edge_response',
    source: 'external XRPL endpoint',
    destination: 'Supabase Edge Function',
    platformDirection: 'inbound_to_supabase',
    rollingEgressTreatment: 'exclude_inbound',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: false,
    qualificationState: 'locked_g1',
    rationale:
      'The XRPL response enters Supabase. Its bytes remain fully counted by memory and transport guards but are excluded from the rolling billable-egress upper bound.',
  },
  edge_to_database_request: {
    id: 'edge_to_database_request',
    source: 'Supabase Edge Function',
    destination: 'Supabase Database, PostgREST, or Supavisor',
    platformDirection: 'internal_or_unresolved',
    rollingEgressTreatment: 'exclude_provider_internal_source_backed',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: false,
    qualificationState: 'resolved_source_backed_after_g3_unqualifiable',
    rationale:
      'G3 could not isolate provider billing counters. Under the current Supabase connected-client/platform-exit egress definition, this same-project provider-internal request is excluded from rolling billable egress; its full bytes remain in memory and transport accounting.',
  },
  database_to_edge_response: {
    id: 'database_to_edge_response',
    source: 'Supabase Database, PostgREST, or Supavisor',
    destination: 'Supabase Edge Function',
    platformDirection: 'internal_or_unresolved',
    rollingEgressTreatment: 'exclude_provider_internal_source_backed',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: false,
    qualificationState: 'resolved_source_backed_after_g3_unqualifiable',
    rationale:
      'G3 could not isolate provider billing counters. Under the current Supabase connected-client/platform-exit egress definition, this same-project provider-internal response is excluded from rolling billable egress; its full bytes remain in memory and transport accounting.',
  },
  edge_to_edge_request: {
    id: 'edge_to_edge_request',
    source: 'Supabase Edge Function',
    destination: 'another Supabase Edge Function',
    platformDirection: 'internal_or_unresolved',
    rollingEgressTreatment: 'include_conservative_until_g3',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: true,
    qualificationState: 'requires_g3_reconciliation',
    rationale:
      'Function-to-function request treatment remains unresolved and is conservatively included until G3.',
  },
  edge_to_edge_response: {
    id: 'edge_to_edge_response',
    source: 'Supabase Edge Function',
    destination: 'another Supabase Edge Function',
    platformDirection: 'internal_or_unresolved',
    rollingEgressTreatment: 'include_conservative_until_g3',
    countsTowardMemoryTransport: true,
    countsTowardRollingBillableEgressUpperBound: true,
    qualificationState: 'requires_g3_reconciliation',
    rationale:
      'Function-to-function response treatment remains unresolved and is conservatively included until G3.',
  },
}

export const SUPABASE_REVISION4_G1_CONTRACT = {
  schemaVersion: 1,
  profileRevision: 4,
  qualificationIssue: 1261,
  selection: 'not_selected',
  recoveryMutationAuthorized: false,
  accountingModel: {
    rollingEgress:
      'sum only documented outbound and conservatively unresolved outbound/internal byte classes plus source-backed directional framing reserves',
    memoryTransport:
      'count every inbound, outbound, internal, serialized-live, object-overhead, and retained-payload class required by the unchanged memory guard',
    blanketAllDirectionWireMultiplierAllowed: false,
    providerCountersClaimedAsAvailable: false,
    unexplainedDeltaReserveRequired: true,
  },
  fixedGuards: SUPABASE_REVISION4_FIXED_GUARDS,
  requiredGatesBeforeSelection: [
    'G2_instrumentation',
    'G3_provider_reconciliation',
    'G4_memory_requalification',
    'G5_steady_convergence',
    'G6_catch_up_convergence',
    'G7_failure_accounting',
    'G8_restore_and_operator_independence',
    'G9_bounded_proof_unit',
    'G10_selection_decision',
  ],
} as const

export interface SupabaseRevision4DirectionalByteObservation {
  boundaryId: SupabaseRevision4BoundaryId
  bodyBytes: number
  framingReserveBytes: number
}

export interface SupabaseRevision4DirectionalByteSummary {
  rollingBillableEgressUpperBoundBytes: number
  memoryTransportBytes: number
  byBoundary: Array<{
    boundaryId: SupabaseRevision4BoundaryId
    totalBytes: number
    rollingBillableEgressBytes: number
    memoryTransportBytes: number
  }>
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function safeAdd(name: string, left: number, right: number): number {
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return value
}

export function summarizeSupabaseRevision4DirectionalBytes(
  observations: readonly SupabaseRevision4DirectionalByteObservation[],
): SupabaseRevision4DirectionalByteSummary {
  let rollingBillableEgressUpperBoundBytes = 0
  let memoryTransportBytes = 0
  const byBoundary = observations.map((observation, index) => {
    const bodyBytes = nonNegativeInteger(
      observation.bodyBytes,
      `observations[${index}].bodyBytes`,
    )
    const framingReserveBytes = nonNegativeInteger(
      observation.framingReserveBytes,
      `observations[${index}].framingReserveBytes`,
    )
    const boundary = SUPABASE_REVISION4_BYTE_BOUNDARIES[observation.boundaryId]
    if (!boundary) {
      throw new Error(`observations[${index}].boundaryId is unsupported`)
    }
    const totalBytes = safeAdd('boundary total bytes', bodyBytes, framingReserveBytes)
    const rollingBillableEgressBytes =
      boundary.countsTowardRollingBillableEgressUpperBound ? totalBytes : 0
    rollingBillableEgressUpperBoundBytes = safeAdd(
      'rolling billable egress upper bound',
      rollingBillableEgressUpperBoundBytes,
      rollingBillableEgressBytes,
    )
    memoryTransportBytes = safeAdd(
      'memory transport bytes',
      memoryTransportBytes,
      totalBytes,
    )
    return {
      boundaryId: observation.boundaryId,
      totalBytes,
      rollingBillableEgressBytes,
      memoryTransportBytes: totalBytes,
    }
  })

  return {
    rollingBillableEgressUpperBoundBytes,
    memoryTransportBytes,
    byBoundary,
  }
}
