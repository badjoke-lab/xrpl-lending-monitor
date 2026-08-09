import { canonicalPortableJson } from './portable-collector-reference-store'
import {
  SupabaseRevision4DirectionalMeter,
  utf8ByteLength,
  type SupabaseRevision4MeterObservation,
} from './supabase-revision4-directional-meter'
import {
  summarizeSupabaseRevision4DirectionalBytes,
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

const MINUTES_PER_31_DAYS = 31 * 24 * 60
const TEXT_ENCODER = new TextEncoder()

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
  invokerRequestCount: number
  xrplRequestBytes: number
  xrplRequestCount: number
  xrplResponseBytes: number
  xrplResponseCount: number
  databaseRequestBytes: number
  databaseRequestCount: number
  databaseResponseBytes: number
  databaseResponseCount: number
  invokerResponseBytes: number
  invokerResponseCount: number
  canonicalJsonBytes: number
  payloadBytes: number
  normalizedObjectOverheadBytes: number
  allocatorReserveBytes: number
  unexplainedDirectionalDeltaReserveBytes: number
}

export interface SupabaseRevision4R5RuntimeAccounting {
  schemaVersion: 1
  profileId: typeof SUPABASE_REVISION4_PROFILE.profileId
  profileRevision: typeof SUPABASE_REVISION4_PROFILE.revision
  profileIdentityDigest: typeof SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  observationId: string
  attemptId: string
  observedAt: string
  disposition: 'runtime_precommit_completed'
  observations: SupabaseRevision4MeterObservation[]
  directionalSummary: ReturnType<typeof summarizeSupabaseRevision4DirectionalBytes>
  memorySupplemental: {
    canonicalJsonBytes: number
    payloadBytes: number
    normalizedObjectOverheadBytes: number
    allocatorReserveBytes: number
  }
  unexplainedDirectionalDeltaReserveBytes: number
  rollingBillableEgressUpperBoundBytes: number
  memoryTransportUpperBoundBytes: number
  checks: {
    exactProfileIdentityBound: true
    everyObservationDirectionBoundByContract: true
    inboundBytesRemainInMemoryTransport: true
    blanketAllDirectionMultiplierUsed: false
    accountingPreparedBeforeAtomicCompletion: true
    accountingMustCommitAtomicallyWithWork: true
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
}

export interface SupabaseRevision4R5RuntimeAccountingEvidence {
  accounting: SupabaseRevision4R5RuntimeAccounting
  accountingJson: string
  accountingDigest: string
}

export interface SupabaseRevision4R5CompletionFixedPointInput
  extends Omit<
    SupabaseRevision4R5RuntimeWireInput,
    'databaseRequestBytes' | 'databaseRequestCount'
  > {
  databaseRequestBytesBeforeCompletion: number
  databaseRequestCountBeforeCompletion: number
}

export interface SupabaseRevision4R5CompletionFixedPointResult {
  accountingEvidence: SupabaseRevision4R5RuntimeAccountingEvidence
  completionRequestBody: string
  completionRequestBytes: number
  fixedPointIterations: number
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return value
}

function safeAdd(left: number, right: number, name: string): number {
  nonNegativeInteger(left, `${name}.left`)
  nonNegativeInteger(right, `${name}.right`)
  const value = left + right
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return value
}

function safeAddMany(values: readonly number[], name: string): number {
  return values.reduce((sum, value, index) => safeAdd(sum, value, `${name}[${index}]`), 0)
}

function safeMultiply(left: number, right: number, name: string): number {
  nonNegativeInteger(left, `${name}.left`)
  nonNegativeInteger(right, `${name}.right`)
  const value = left * right
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} exceeds the safe integer range`)
  }
  return value
}

function exactIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/u.test(normalized)) {
    throw new Error(`${name} must be a stable non-secret identifier`)
  }
  return normalized
}

function exactObservedAt(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) {
    throw new Error('observedAt must be a canonical UTC timestamp')
  }
  if (!Number.isFinite(Date.parse(value))) throw new Error('observedAt must be valid')
  return value
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = TEXT_ENCODER.encode(value)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function evaluateSupabaseRevision4R5Cadence(): {
  steadyLedgersPerMinute: number
  catchupLedgersPerMinute: number
  steadyInvocations31d: number
  catchupInvocations31d: number
  steadyQualified: boolean
  catchupQualified: boolean
  steadyInvocationGuardQualified: boolean
  catchupInvocationGuardQualified: boolean
  maximumAverageBillableEgressBytesPerLedgerAtRequiredSteadyDemand: number
} {
  const steadyLedgersPerMinute =
    SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim
    * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.steadyClaimsPerMinute
  const catchupLedgersPerMinute =
    SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim
    * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.catchupClaimsPerMinute
  const steadyInvocations31d =
    MINUTES_PER_31_DAYS * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.steadyClaimsPerMinute
  const catchupInvocations31d =
    MINUTES_PER_31_DAYS * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.catchupClaimsPerMinute
  const requiredSteadyLedgers31d =
    MINUTES_PER_31_DAYS * SUPABASE_REVISION4_R5_RUNTIME_LIMITS.requiredSteadyLedgersPerMinute

  return {
    steadyLedgersPerMinute,
    catchupLedgersPerMinute,
    steadyInvocations31d,
    catchupInvocations31d,
    steadyQualified:
      steadyLedgersPerMinute
      > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.requiredSteadyLedgersPerMinute,
    catchupQualified:
      catchupLedgersPerMinute
      > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.requiredCatchupLedgersPerMinute,
    steadyInvocationGuardQualified:
      steadyInvocations31d < SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d,
    catchupInvocationGuardQualified:
      catchupInvocations31d < SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d,
    maximumAverageBillableEgressBytesPerLedgerAtRequiredSteadyDemand:
      Math.floor(
        SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes
        / requiredSteadyLedgers31d,
      ),
  }
}

export async function buildSupabaseRevision4R5RuntimeAccounting(
  input: SupabaseRevision4R5RuntimeWireInput,
): Promise<SupabaseRevision4R5RuntimeAccountingEvidence> {
  const meter = new SupabaseRevision4DirectionalMeter()
  meter.recordBytes({
    operationId: 'r5.invoker.edge.requests',
    boundaryId: 'invoker_to_edge_request',
    bodyBytes: nonNegativeInteger(input.invokerRequestBytes, 'invokerRequestBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.invokerRequestCount, 'invokerRequestCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.invokerRequestBytes,
      'invokerRequestFramingReserveBytes',
    ),
  })
  meter.recordBytes({
    operationId: 'r5.edge.xrpl.requests',
    boundaryId: 'edge_to_xrpl_request',
    bodyBytes: nonNegativeInteger(input.xrplRequestBytes, 'xrplRequestBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.xrplRequestCount, 'xrplRequestCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToXrplRequestBytes,
      'xrplRequestFramingReserveBytes',
    ),
  })
  meter.recordBytes({
    operationId: 'r5.xrpl.edge.responses',
    boundaryId: 'xrpl_to_edge_response',
    bodyBytes: nonNegativeInteger(input.xrplResponseBytes, 'xrplResponseBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.xrplResponseCount, 'xrplResponseCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.xrplToEdgeResponseBytes,
      'xrplResponseFramingReserveBytes',
    ),
  })
  meter.recordBytes({
    operationId: 'r5.edge.database.requests',
    boundaryId: 'edge_to_database_request',
    bodyBytes: nonNegativeInteger(input.databaseRequestBytes, 'databaseRequestBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.databaseRequestCount, 'databaseRequestCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToDatabaseRequestBytes,
      'databaseRequestFramingReserveBytes',
    ),
  })
  meter.recordBytes({
    operationId: 'r5.database.edge.responses',
    boundaryId: 'database_to_edge_response',
    bodyBytes: nonNegativeInteger(input.databaseResponseBytes, 'databaseResponseBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.databaseResponseCount, 'databaseResponseCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.databaseToEdgeResponseBytes,
      'databaseResponseFramingReserveBytes',
    ),
  })
  meter.recordBytes({
    operationId: 'r5.edge.invoker.responses',
    boundaryId: 'edge_to_invoker_response',
    bodyBytes: nonNegativeInteger(input.invokerResponseBytes, 'invokerResponseBytes'),
    framingReserveBytes: safeMultiply(
      nonNegativeInteger(input.invokerResponseCount, 'invokerResponseCount'),
      SUPABASE_REVISION4_R5_FRAMING_RESERVES.edgeToInvokerResponseBytes,
      'invokerResponseFramingReserveBytes',
    ),
  })

  const observations = meter.snapshot()
  const directionalSummary = summarizeSupabaseRevision4DirectionalBytes(observations)
  const memorySupplemental = {
    canonicalJsonBytes: nonNegativeInteger(input.canonicalJsonBytes, 'canonicalJsonBytes'),
    payloadBytes: nonNegativeInteger(input.payloadBytes, 'payloadBytes'),
    normalizedObjectOverheadBytes: nonNegativeInteger(
      input.normalizedObjectOverheadBytes,
      'normalizedObjectOverheadBytes',
    ),
    allocatorReserveBytes: nonNegativeInteger(input.allocatorReserveBytes, 'allocatorReserveBytes'),
  }
  const unexplainedDirectionalDeltaReserveBytes = nonNegativeInteger(
    input.unexplainedDirectionalDeltaReserveBytes,
    'unexplainedDirectionalDeltaReserveBytes',
  )
  const accounting: SupabaseRevision4R5RuntimeAccounting = {
    schemaVersion: 1,
    profileId: SUPABASE_REVISION4_PROFILE.profileId,
    profileRevision: SUPABASE_REVISION4_PROFILE.revision,
    profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    observationId: exactIdentifier(input.observationId, 'observationId'),
    attemptId: exactIdentifier(input.attemptId, 'attemptId'),
    observedAt: exactObservedAt(input.observedAt),
    disposition: 'runtime_precommit_completed',
    observations,
    directionalSummary,
    memorySupplemental,
    unexplainedDirectionalDeltaReserveBytes,
    rollingBillableEgressUpperBoundBytes: safeAdd(
      directionalSummary.rollingBillableEgressUpperBoundBytes,
      unexplainedDirectionalDeltaReserveBytes,
      'rollingBillableEgressUpperBoundBytes',
    ),
    memoryTransportUpperBoundBytes: safeAddMany([
      directionalSummary.memoryTransportBytes,
      memorySupplemental.canonicalJsonBytes,
      memorySupplemental.payloadBytes,
      memorySupplemental.normalizedObjectOverheadBytes,
      memorySupplemental.allocatorReserveBytes,
    ], 'memoryTransportUpperBoundBytes'),
    checks: {
      exactProfileIdentityBound: true,
      everyObservationDirectionBoundByContract: true,
      inboundBytesRemainInMemoryTransport: true,
      blanketAllDirectionMultiplierUsed: false,
      accountingPreparedBeforeAtomicCompletion: true,
      accountingMustCommitAtomicallyWithWork: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  const accountingJson = canonicalPortableJson(accounting)
  return {
    accounting,
    accountingJson,
    accountingDigest: await sha256Hex(accountingJson),
  }
}

export async function resolveSupabaseRevision4R5CompletionFixedPoint(
  input: SupabaseRevision4R5CompletionFixedPointInput,
  buildCompletionBody: (accounting: {
    accountingJson: string
    accountingDigest: string
    finalizedEgressUpperBoundBytes: number
  }) => Record<string, unknown>,
): Promise<SupabaseRevision4R5CompletionFixedPointResult> {
  const databaseRequestBytesBeforeCompletion = nonNegativeInteger(
    input.databaseRequestBytesBeforeCompletion,
    'databaseRequestBytesBeforeCompletion',
  )
  const databaseRequestCountBeforeCompletion = nonNegativeInteger(
    input.databaseRequestCountBeforeCompletion,
    'databaseRequestCountBeforeCompletion',
  )
  let completionRequestBytes = 0

  for (let fixedPointIterations = 1; fixedPointIterations <= 32; fixedPointIterations += 1) {
    const accountingEvidence = await buildSupabaseRevision4R5RuntimeAccounting({
      ...input,
      databaseRequestBytes: safeAdd(
        databaseRequestBytesBeforeCompletion,
        completionRequestBytes,
        'databaseRequestBytesIncludingCompletion',
      ),
      databaseRequestCount: safeAdd(
        databaseRequestCountBeforeCompletion,
        1,
        'databaseRequestCountIncludingCompletion',
      ),
    })
    const completionRequestBody = JSON.stringify(buildCompletionBody({
      accountingJson: accountingEvidence.accountingJson,
      accountingDigest: accountingEvidence.accountingDigest,
      finalizedEgressUpperBoundBytes:
        accountingEvidence.accounting.rollingBillableEgressUpperBoundBytes,
    }))
    const nextCompletionRequestBytes = utf8ByteLength(completionRequestBody)

    if (nextCompletionRequestBytes === completionRequestBytes) {
      return {
        accountingEvidence,
        completionRequestBody,
        completionRequestBytes,
        fixedPointIterations,
      }
    }
    completionRequestBytes = nextCompletionRequestBytes
  }

  throw new Error('revision-4 R5 completion request byte fixed point did not converge')
}
