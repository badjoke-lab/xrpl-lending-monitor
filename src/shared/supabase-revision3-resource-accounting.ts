export const SUPABASE_REVISION3_PROFILE = {
  schemaVersion: 1,
  profileId: 'supabase_free_postgres_pgcron_edge',
  revision: 3,
  label:
    'Supabase Free Postgres plus pg_cron and Edge Functions with conservative application-owned resource accounting',
  components: {
    storage: 'Supabase Free Postgres committed seven-class state and history',
    scheduler: 'Supabase pg_cron one-minute internal successor scheduling',
    execution:
      'Supabase Edge Functions plus security-definer transactional RPCs with conservative application-owned resource accounting',
    publication: 'separate immutable Git-backed publication',
    maintenance: 'publication-gated bounded Supabase maintenance',
    completeStateTransfer:
      'canonical export, typed empty-target restore, and post-restore continuation',
  },
} as const

export const SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST =
  '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'

const MIB = 1024 * 1024
const GIB = 1024 * MIB

export const SUPABASE_REVISION3_RESOURCE_LIMITS = {
  providerMemoryHardBytes: 256 * MIB,
  projectMemoryHaltBytes: 224 * MIB,
  fixedRuntimeMemoryReserveBytes: 192 * MIB,
  serializedLiveByteMultiplier: 8,
  networkRequestOverheadBytes: 16 * 1024,
  databaseRequestOverheadBytes: 8 * 1024,
  tickFixedEgressOverheadBytes: 64 * 1024,
  wireByteMultiplier: 4,
  providerEgressHard31dBytes: 5 * GIB,
  projectEgressHalt31dBytes: 4 * GIB,
  projectTickEgressHaltBytes: 32 * MIB,
  providerInvocationHard31d: 500_000,
  projectInvocationHalt31d: 400_000,
  maximumLedgersPerTick: 24,
  maximumNetworkRequestsPerTick: 64,
  maximumDatabaseRequestsPerTick: 16,
  maximumTransactionsPerTick: 4_096,
  maximumMetadataNodesPerTick: 32_768,
  maximumNormalizedRecordsPerTick: 16_384,
  maximumPayloadChunksPerTick: 1_024,
  maximumRelationshipsPerTick: 65_536,
  ledgerObjectOverheadBytes: 32 * 1024,
  transactionObjectOverheadBytes: 8 * 1024,
  metadataNodeOverheadBytes: 4 * 1024,
  normalizedRecordOverheadBytes: 8 * 1024,
  payloadChunkOverheadBytes: 64 * 1024,
  relationshipOverheadBytes: 1024,
} as const

export type SupabaseRevision3ResourceFailure =
  | 'ledger_count_limit'
  | 'network_request_count_limit'
  | 'database_request_count_limit'
  | 'transaction_count_limit'
  | 'metadata_node_count_limit'
  | 'normalized_record_count_limit'
  | 'payload_chunk_count_limit'
  | 'relationship_count_limit'
  | 'memory_upper_bound_halt'
  | 'tick_egress_upper_bound_halt'
  | 'monthly_egress_upper_bound_halt'
  | 'monthly_invocation_halt'

export interface SupabaseRevision3ResourceAccountingInput {
  ledgerCount: number
  networkRequestCount: number
  networkRequestBytes: number
  networkResponseBytes: number
  databaseRequestCount: number
  databaseRequestBytes: number
  databaseResponseBytes: number
  functionResponseBytes: number
  transactionCount: number
  metadataNodeCount: number
  normalizedRecordCount: number
  payloadChunkCount: number
  relationshipCount: number
  canonicalJsonBytes: number
  payloadBytes: number
  priorConservativeEgress31dBytes: number
  priorInvocations31d: number
}

export interface SupabaseRevision3ResourceAccountingResult {
  schemaVersion: 1
  profileRevision: 3
  allowed: boolean
  failures: SupabaseRevision3ResourceFailure[]
  exactWireBytes: number
  serializedLiveBytes: number
  objectOverheadBytes: number
  dynamicMemoryUpperBoundBytes: number
  conservativeMemoryUpperBoundBytes: number
  conservativeTickEgressUpperBoundBytes: number
  conservativeEgress31dUpperBoundBytes: number
  projectedInvocations31d: number
  thresholds: {
    projectMemoryHaltBytes: number
    providerMemoryHardBytes: number
    projectTickEgressHaltBytes: number
    projectEgressHalt31dBytes: number
    providerEgressHard31dBytes: number
    projectInvocationHalt31d: number
    providerInvocationHard31d: number
  }
  checks: {
    unavailableProviderMemoryNotClaimed: true
    unavailableProviderEgressNotClaimed: true
    fixedRuntimeReserveApplied: true
    serializedBytesAmplified: true
    objectOverheadApplied: true
    allNetworkDirectionsCounted: true
    preMutationDecision: true
  }
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function safeAdd(name: string, ...values: number[]): number {
  const result = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return result
}

function safeMultiply(value: number, multiplier: number, name: string): number {
  const result = value * multiplier
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return result
}

function pushLimitFailure(
  failures: SupabaseRevision3ResourceFailure[],
  value: number,
  maximum: number,
  failure: SupabaseRevision3ResourceFailure,
): void {
  if (value > maximum) failures.push(failure)
}

export function evaluateSupabaseRevision3ResourceAccounting(
  input: SupabaseRevision3ResourceAccountingInput,
): SupabaseRevision3ResourceAccountingResult {
  const values = Object.fromEntries(
    Object.entries(input).map(([name, value]) => [name, nonNegativeInteger(value, name)]),
  ) as unknown as SupabaseRevision3ResourceAccountingInput
  const limits = SUPABASE_REVISION3_RESOURCE_LIMITS
  const failures: SupabaseRevision3ResourceFailure[] = []

  pushLimitFailure(
    failures,
    values.ledgerCount,
    limits.maximumLedgersPerTick,
    'ledger_count_limit',
  )
  pushLimitFailure(
    failures,
    values.networkRequestCount,
    limits.maximumNetworkRequestsPerTick,
    'network_request_count_limit',
  )
  pushLimitFailure(
    failures,
    values.databaseRequestCount,
    limits.maximumDatabaseRequestsPerTick,
    'database_request_count_limit',
  )
  pushLimitFailure(
    failures,
    values.transactionCount,
    limits.maximumTransactionsPerTick,
    'transaction_count_limit',
  )
  pushLimitFailure(
    failures,
    values.metadataNodeCount,
    limits.maximumMetadataNodesPerTick,
    'metadata_node_count_limit',
  )
  pushLimitFailure(
    failures,
    values.normalizedRecordCount,
    limits.maximumNormalizedRecordsPerTick,
    'normalized_record_count_limit',
  )
  pushLimitFailure(
    failures,
    values.payloadChunkCount,
    limits.maximumPayloadChunksPerTick,
    'payload_chunk_count_limit',
  )
  pushLimitFailure(
    failures,
    values.relationshipCount,
    limits.maximumRelationshipsPerTick,
    'relationship_count_limit',
  )

  const exactWireBytes = safeAdd(
    'exactWireBytes',
    values.networkRequestBytes,
    values.networkResponseBytes,
    values.databaseRequestBytes,
    values.databaseResponseBytes,
    values.functionResponseBytes,
  )
  const serializedLiveBytes = safeAdd(
    'serializedLiveBytes',
    values.networkResponseBytes,
    values.databaseRequestBytes,
    values.databaseResponseBytes,
    values.canonicalJsonBytes,
    values.payloadBytes,
  )
  const objectOverheadBytes = safeAdd(
    'objectOverheadBytes',
    safeMultiply(
      values.ledgerCount,
      limits.ledgerObjectOverheadBytes,
      'ledgerObjectOverheadBytes',
    ),
    safeMultiply(
      values.transactionCount,
      limits.transactionObjectOverheadBytes,
      'transactionObjectOverheadBytes',
    ),
    safeMultiply(
      values.metadataNodeCount,
      limits.metadataNodeOverheadBytes,
      'metadataNodeOverheadBytes',
    ),
    safeMultiply(
      values.normalizedRecordCount,
      limits.normalizedRecordOverheadBytes,
      'normalizedRecordOverheadBytes',
    ),
    safeMultiply(
      values.payloadChunkCount,
      limits.payloadChunkOverheadBytes,
      'payloadChunkOverheadBytes',
    ),
    safeMultiply(
      values.relationshipCount,
      limits.relationshipOverheadBytes,
      'relationshipOverheadBytes',
    ),
  )
  const dynamicMemoryUpperBoundBytes = safeAdd(
    'dynamicMemoryUpperBoundBytes',
    safeMultiply(
      serializedLiveBytes,
      limits.serializedLiveByteMultiplier,
      'serializedLiveByteUpperBoundBytes',
    ),
    objectOverheadBytes,
  )
  const conservativeMemoryUpperBoundBytes = safeAdd(
    'conservativeMemoryUpperBoundBytes',
    limits.fixedRuntimeMemoryReserveBytes,
    dynamicMemoryUpperBoundBytes,
  )

  const conservativeTickEgressUpperBoundBytes = safeAdd(
    'conservativeTickEgressUpperBoundBytes',
    safeMultiply(exactWireBytes, limits.wireByteMultiplier, 'wireByteUpperBoundBytes'),
    safeMultiply(
      values.networkRequestCount,
      limits.networkRequestOverheadBytes,
      'networkRequestOverheadBytes',
    ),
    safeMultiply(
      values.databaseRequestCount,
      limits.databaseRequestOverheadBytes,
      'databaseRequestOverheadBytes',
    ),
    limits.tickFixedEgressOverheadBytes,
  )
  const conservativeEgress31dUpperBoundBytes = safeAdd(
    'conservativeEgress31dUpperBoundBytes',
    values.priorConservativeEgress31dBytes,
    conservativeTickEgressUpperBoundBytes,
  )
  const projectedInvocations31d = safeAdd(
    'projectedInvocations31d',
    values.priorInvocations31d,
    1,
  )

  if (conservativeMemoryUpperBoundBytes >= limits.projectMemoryHaltBytes) {
    failures.push('memory_upper_bound_halt')
  }
  if (conservativeTickEgressUpperBoundBytes >= limits.projectTickEgressHaltBytes) {
    failures.push('tick_egress_upper_bound_halt')
  }
  if (conservativeEgress31dUpperBoundBytes >= limits.projectEgressHalt31dBytes) {
    failures.push('monthly_egress_upper_bound_halt')
  }
  if (projectedInvocations31d >= limits.projectInvocationHalt31d) {
    failures.push('monthly_invocation_halt')
  }

  return {
    schemaVersion: 1,
    profileRevision: 3,
    allowed: failures.length === 0,
    failures,
    exactWireBytes,
    serializedLiveBytes,
    objectOverheadBytes,
    dynamicMemoryUpperBoundBytes,
    conservativeMemoryUpperBoundBytes,
    conservativeTickEgressUpperBoundBytes,
    conservativeEgress31dUpperBoundBytes,
    projectedInvocations31d,
    thresholds: {
      projectMemoryHaltBytes: limits.projectMemoryHaltBytes,
      providerMemoryHardBytes: limits.providerMemoryHardBytes,
      projectTickEgressHaltBytes: limits.projectTickEgressHaltBytes,
      projectEgressHalt31dBytes: limits.projectEgressHalt31dBytes,
      providerEgressHard31dBytes: limits.providerEgressHard31dBytes,
      projectInvocationHalt31d: limits.projectInvocationHalt31d,
      providerInvocationHard31d: limits.providerInvocationHard31d,
    },
    checks: {
      unavailableProviderMemoryNotClaimed: true,
      unavailableProviderEgressNotClaimed: true,
      fixedRuntimeReserveApplied: true,
      serializedBytesAmplified: true,
      objectOverheadApplied: true,
      allNetworkDirectionsCounted: true,
      preMutationDecision: true,
    },
  }
}
