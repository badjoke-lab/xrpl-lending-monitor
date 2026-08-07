import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'
import {
  SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  SUPABASE_REVISION4_INVOCATION_HALT,
  SUPABASE_REVISION4_MEMORY_HALT_BYTES,
  SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
  SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
  SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
} from './supabase-revision4-steady-convergence'

export const SUPABASE_REVISION4_CATCHUP_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_CATCHUP_RESULT_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_MINIMUM_CATCHUP_LEDGERS_PER_MINUTE = 30
export const SUPABASE_REVISION4_MINIMUM_CATCHUP_MINUTES = 6

export type SupabaseRevision4CatchupEvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_moving_head_catchup'

export interface SupabaseRevision4CatchupMinuteInput {
  minuteStart: string
  sourceHeadStartLedgerIndex: number
  sourceHeadEndLedgerIndex: number
  committedWatermarkStartLedgerIndex: number
  committedWatermarkEndLedgerIndex: number
  committedLedgers: number
  invocationCount: number
  applicationBillableEgressUpperBoundBytes: number
  maximumPeakMemoryBytes: number
  maximumClaimLedgers: number
  accountingDigests: string[]
  committed: boolean
  parentHashContinuityVerified: boolean
  duplicateLedgerCount: number
  skippedLedgerCount: number
}

export interface SupabaseRevision4CatchupConvergenceInput {
  schemaVersion: typeof SUPABASE_REVISION4_CATCHUP_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4CatchupEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  capturedAt: string
  sourceCommit: string
  prerequisites: {
    g3ProviderReconciliationPassed: boolean
    g5SteadyConvergencePassed: boolean
    providerCaptureDigest: string
    g5SteadyEvidenceDigest: string
    selectedUnexplainedDeltaReserveBytesPerMinute: number
    interventionReserveApproved: boolean
    interventionReserveBytes: number
    interventionReserveRationaleDigest: string
    g5SteadyBillableEgressUpperBoundBytesPerMinute: number
    g5SteadyInvocationsPerMinute: number
  }
  policy: {
    rollingEgressHaltBytes: number
    rollingWindowMinutes: number
    steadyRequiredLedgersPerMinute: number
    catchupMinimumLedgersPerMinute: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
    minimumConsecutiveMinutes: number
  }
  minutes: SupabaseRevision4CatchupMinuteInput[]
  safety: {
    productionCredentialsUsed: boolean
    productionMutationPerformed: boolean
    recoveryMutationCommitted: boolean
    transactionSubmissionPerformed: boolean
    publicReaderUnchanged: boolean
    mainnetDisabled: boolean
    stabilizationAuthorized: boolean
    soakAuthorized: boolean
  }
}

export interface SupabaseRevision4CatchupConvergenceResult {
  schemaVersion: typeof SUPABASE_REVISION4_CATCHUP_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4CatchupEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  machineSummary: {
    sampleMinutes: number
    totalCommittedLedgers: number | null
    minimumCommittedLedgersPerMinute: number | null
    initialBacklogLedgers: number | null
    finalBacklogLedgers: number | null
    minimumSourceHeadAdvancePerMinute: number | null
    minimumBacklogReductionPerMinute: number | null
    maximumApplicationBillableEgressUpperBoundBytesPerMinute: number | null
    selectedUnexplainedDeltaReserveBytesPerMinute: number
    catchupBillableEgressUpperBoundBytesPerMinute: number | null
    projectedCatchupMinutes: number | null
    catchupMinutesWithinRollingWindow: number | null
    projectedRollingEgressUpperBoundBytes: number | null
    rollingEgressHeadroomBytes: number | null
    maximumInvocationsPerMinute: number | null
    projectedRollingInvocations: number | null
    invocationHeadroom: number | null
    maximumPeakMemoryBytes: number | null
    minimumMemoryHeadroomBytes: number | null
    maximumClaimLedgers: number | null
    movingHeadSequenceVerified: boolean
    watermarkContinuityVerified: boolean
    backlogConvergenceVerified: boolean
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu
const SECRET_VALUE_PATTERN = /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/u

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason)
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function canonicalTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}

function isUtcMinuteBoundary(value: string): boolean {
  const timestamp = Date.parse(value)
  return canonicalTimestamp(value) && timestamp % 60_000 === 0
}

function containsSecret(value: unknown, key = ''): boolean {
  if (SECRET_KEY_PATTERN.test(key)) return true
  if (typeof value === 'string') return SECRET_VALUE_PATTERN.test(value)
  if (Array.isArray(value)) return value.some((item) => containsSecret(item))
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsSecret(entryValue, entryKey),
    )
  }
  return false
}

function safeSum(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    if (!isNonNegativeSafeInteger(value)) return null
    total += value
    if (!Number.isSafeInteger(total)) return null
  }
  return total
}

function safeMultiply(left: number, right: number): number | null {
  if (!isNonNegativeSafeInteger(left) || !isNonNegativeSafeInteger(right)) {
    return null
  }
  const product = left * right
  return Number.isSafeInteger(product) ? product : null
}

function safeMax(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !isNonNegativeSafeInteger(value))) {
    return null
  }
  return Math.max(...values)
}

function safeMin(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !isNonNegativeSafeInteger(value))) {
    return null
  }
  return Math.min(...values)
}

function safeCeilDivide(numerator: number, denominator: number): number | null {
  if (!isNonNegativeSafeInteger(numerator) || !isPositiveSafeInteger(denominator)) {
    return null
  }
  const value = Math.ceil(numerator / denominator)
  return Number.isSafeInteger(value) ? value : null
}

export function verifySupabaseRevision4CatchupConvergence(
  input: SupabaseRevision4CatchupConvergenceInput,
): SupabaseRevision4CatchupConvergenceResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_CATCHUP_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_moving_head_catchup') {
    addReason(blockingReasons, 'synthetic_or_static_evidence_not_qualifying')
  }
  if (input.profileId !== SUPABASE_REVISION4_PROFILE.profileId) {
    addReason(blockingReasons, 'profile_id_mismatch')
  }
  if (input.profileRevision !== SUPABASE_REVISION4_PROFILE.revision) {
    addReason(blockingReasons, 'profile_revision_mismatch')
  }
  if (input.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST) {
    addReason(blockingReasons, 'profile_identity_digest_mismatch')
  }
  if (input.evidenceId.trim().length === 0) {
    addReason(blockingReasons, 'evidence_id_missing')
  }
  if (!canonicalTimestamp(input.capturedAt)) {
    addReason(blockingReasons, 'captured_at_invalid')
  }
  if (!COMMIT_PATTERN.test(input.sourceCommit)) {
    addReason(blockingReasons, 'source_commit_invalid')
  }
  if (containsSecret(input)) {
    addReason(blockingReasons, 'secret_material_present')
  }

  if (!input.prerequisites.g3ProviderReconciliationPassed) {
    addReason(blockingReasons, 'g3_provider_reconciliation_not_passed')
  }
  if (!input.prerequisites.g5SteadyConvergencePassed) {
    addReason(blockingReasons, 'g5_steady_convergence_not_passed')
  }
  for (const [name, digest] of [
    ['provider_capture', input.prerequisites.providerCaptureDigest],
    ['g5_steady_evidence', input.prerequisites.g5SteadyEvidenceDigest],
    ['intervention_reserve_rationale', input.prerequisites.interventionReserveRationaleDigest],
  ] as const) {
    if (!SHA256_PATTERN.test(digest)) {
      addReason(blockingReasons, `${name}_digest_invalid`)
    }
  }
  if (
    !isNonNegativeSafeInteger(
      input.prerequisites.selectedUnexplainedDeltaReserveBytesPerMinute,
    )
  ) {
    addReason(blockingReasons, 'selected_unexplained_delta_reserve_invalid')
  }
  if (!input.prerequisites.interventionReserveApproved) {
    addReason(blockingReasons, 'intervention_reserve_not_approved')
  }
  if (!isPositiveSafeInteger(input.prerequisites.interventionReserveBytes)) {
    addReason(blockingReasons, 'intervention_reserve_invalid')
  } else if (
    input.prerequisites.interventionReserveBytes
    >= SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
  ) {
    addReason(blockingReasons, 'intervention_reserve_exhausts_egress_halt')
  }
  if (
    !isNonNegativeSafeInteger(
      input.prerequisites.g5SteadyBillableEgressUpperBoundBytesPerMinute,
    )
  ) {
    addReason(blockingReasons, 'g5_steady_egress_upper_bound_invalid')
  }
  if (!isPositiveSafeInteger(input.prerequisites.g5SteadyInvocationsPerMinute)) {
    addReason(blockingReasons, 'g5_steady_invocations_invalid')
  }

  const expectedPolicy = {
    rollingEgressHaltBytes: SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
    rollingWindowMinutes: SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
    steadyRequiredLedgersPerMinute: SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
    catchupMinimumLedgersPerMinute: SUPABASE_REVISION4_MINIMUM_CATCHUP_LEDGERS_PER_MINUTE,
    invocationHalt: SUPABASE_REVISION4_INVOCATION_HALT,
    memoryHaltBytes: SUPABASE_REVISION4_MEMORY_HALT_BYTES,
    claimCapLedgers: SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
    minimumConsecutiveMinutes: SUPABASE_REVISION4_MINIMUM_CATCHUP_MINUTES,
  }
  for (const [key, expected] of Object.entries(expectedPolicy)) {
    if (input.policy[key as keyof typeof input.policy] !== expected) {
      addReason(blockingReasons, `policy_changed:${key}`)
    }
  }

  if (input.minutes.length < SUPABASE_REVISION4_MINIMUM_CATCHUP_MINUTES) {
    addReason(blockingReasons, 'insufficient_consecutive_minute_samples')
  }

  let movingHeadSequenceVerified = input.minutes.length > 0
  let watermarkContinuityVerified = input.minutes.length > 0
  let backlogConvergenceVerified = input.minutes.length > 0
  let previousMinuteStart: number | null = null
  let previousSourceHeadEnd: number | null = null
  let previousWatermarkEnd: number | null = null
  const backlogStarts: number[] = []
  const backlogEnds: number[] = []
  const headAdvances: number[] = []
  const backlogReductions: number[] = []

  for (const [index, minute] of input.minutes.entries()) {
    const sampleId = `minute_${index}`

    if (!isUtcMinuteBoundary(minute.minuteStart)) {
      addReason(blockingReasons, `minute_not_utc_boundary:${sampleId}`)
      movingHeadSequenceVerified = false
    }
    const minuteStart = Date.parse(minute.minuteStart)
    if (
      previousMinuteStart !== null
      && (!Number.isFinite(minuteStart) || minuteStart - previousMinuteStart !== 60_000)
    ) {
      addReason(blockingReasons, `minute_sequence_not_consecutive:${sampleId}`)
      movingHeadSequenceVerified = false
    }
    previousMinuteStart = minuteStart

    const headIndexesValid =
      isPositiveSafeInteger(minute.sourceHeadStartLedgerIndex)
      && isPositiveSafeInteger(minute.sourceHeadEndLedgerIndex)
      && minute.sourceHeadEndLedgerIndex > minute.sourceHeadStartLedgerIndex
    if (!headIndexesValid) {
      addReason(blockingReasons, `source_head_not_advancing:${sampleId}`)
      movingHeadSequenceVerified = false
    }

    const watermarkIndexesValid =
      isPositiveSafeInteger(minute.committedWatermarkStartLedgerIndex)
      && isPositiveSafeInteger(minute.committedWatermarkEndLedgerIndex)
      && minute.committedWatermarkEndLedgerIndex > minute.committedWatermarkStartLedgerIndex
    if (!watermarkIndexesValid) {
      addReason(blockingReasons, `committed_watermark_not_advancing:${sampleId}`)
      watermarkContinuityVerified = false
    }

    if (
      previousSourceHeadEnd !== null
      && minute.sourceHeadStartLedgerIndex !== previousSourceHeadEnd
    ) {
      addReason(blockingReasons, `source_head_sequence_discontinuous:${sampleId}`)
      movingHeadSequenceVerified = false
    }
    if (
      previousWatermarkEnd !== null
      && minute.committedWatermarkStartLedgerIndex !== previousWatermarkEnd
    ) {
      addReason(blockingReasons, `watermark_sequence_discontinuous:${sampleId}`)
      watermarkContinuityVerified = false
    }
    previousSourceHeadEnd = minute.sourceHeadEndLedgerIndex
    previousWatermarkEnd = minute.committedWatermarkEndLedgerIndex

    if (!isPositiveSafeInteger(minute.committedLedgers)) {
      addReason(blockingReasons, `committed_ledgers_invalid:${sampleId}`)
    } else {
      const watermarkAdvance =
        minute.committedWatermarkEndLedgerIndex
        - minute.committedWatermarkStartLedgerIndex
      if (!watermarkIndexesValid || minute.committedLedgers !== watermarkAdvance) {
        addReason(blockingReasons, `committed_ledgers_watermark_mismatch:${sampleId}`)
        watermarkContinuityVerified = false
      }
      if (minute.committedLedgers < SUPABASE_REVISION4_MINIMUM_CATCHUP_LEDGERS_PER_MINUTE) {
        addReason(blockingReasons, `minute_below_catchup_rate:${sampleId}`)
      }
    }

    if (headIndexesValid && watermarkIndexesValid) {
      const backlogStart =
        minute.sourceHeadStartLedgerIndex - minute.committedWatermarkStartLedgerIndex
      const backlogEnd =
        minute.sourceHeadEndLedgerIndex - minute.committedWatermarkEndLedgerIndex
      const headAdvance =
        minute.sourceHeadEndLedgerIndex - minute.sourceHeadStartLedgerIndex
      const backlogReduction = backlogStart - backlogEnd

      if (!isPositiveSafeInteger(backlogStart)) {
        addReason(blockingReasons, `catchup_backlog_missing:${sampleId}`)
        backlogConvergenceVerified = false
      }
      if (!isNonNegativeSafeInteger(backlogEnd)) {
        addReason(blockingReasons, `watermark_ahead_of_source_head:${sampleId}`)
        backlogConvergenceVerified = false
      }
      if (!isPositiveSafeInteger(backlogReduction)) {
        addReason(blockingReasons, `backlog_not_decreasing:${sampleId}`)
        backlogConvergenceVerified = false
      }
      if (
        isPositiveSafeInteger(minute.committedLedgers)
        && minute.committedLedgers <= headAdvance
      ) {
        addReason(blockingReasons, `catchup_not_faster_than_head:${sampleId}`)
        backlogConvergenceVerified = false
      }

      if (isNonNegativeSafeInteger(backlogStart)) backlogStarts.push(backlogStart)
      if (isNonNegativeSafeInteger(backlogEnd)) backlogEnds.push(backlogEnd)
      if (isNonNegativeSafeInteger(headAdvance)) headAdvances.push(headAdvance)
      if (isNonNegativeSafeInteger(backlogReduction)) {
        backlogReductions.push(backlogReduction)
      }
    }

    if (!isPositiveSafeInteger(minute.invocationCount)) {
      addReason(blockingReasons, `invocation_count_invalid:${sampleId}`)
    } else if (
      isPositiveSafeInteger(minute.committedLedgers)
      && isPositiveSafeInteger(minute.maximumClaimLedgers)
    ) {
      const effectiveClaim = Math.min(
        minute.maximumClaimLedgers,
        SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
      )
      const minimumInvocations = Math.ceil(minute.committedLedgers / effectiveClaim)
      if (minute.invocationCount < minimumInvocations) {
        addReason(blockingReasons, `invocation_count_below_claim_coverage:${sampleId}`)
      }
    }

    if (!isNonNegativeSafeInteger(minute.applicationBillableEgressUpperBoundBytes)) {
      addReason(blockingReasons, `application_egress_upper_bound_invalid:${sampleId}`)
    }
    if (!isPositiveSafeInteger(minute.maximumPeakMemoryBytes)) {
      addReason(blockingReasons, `peak_memory_invalid:${sampleId}`)
    } else if (minute.maximumPeakMemoryBytes >= SUPABASE_REVISION4_MEMORY_HALT_BYTES) {
      addReason(blockingReasons, `memory_halt_reached:${sampleId}`)
    }
    if (!isPositiveSafeInteger(minute.maximumClaimLedgers)) {
      addReason(blockingReasons, `maximum_claim_invalid:${sampleId}`)
    } else if (minute.maximumClaimLedgers > SUPABASE_REVISION4_CLAIM_CAP_LEDGERS) {
      addReason(blockingReasons, `claim_cap_exceeded:${sampleId}`)
    }
    if (minute.accountingDigests.length === 0) {
      addReason(blockingReasons, `accounting_digest_missing:${sampleId}`)
    }
    for (const digest of minute.accountingDigests) {
      if (!SHA256_PATTERN.test(digest)) {
        addReason(blockingReasons, `accounting_digest_invalid:${sampleId}`)
      }
    }
    if (!minute.committed) {
      addReason(blockingReasons, `minute_not_committed:${sampleId}`)
    }
    if (!minute.parentHashContinuityVerified) {
      addReason(blockingReasons, `parent_hash_continuity_not_verified:${sampleId}`)
      watermarkContinuityVerified = false
    }
    if (minute.duplicateLedgerCount !== 0) {
      addReason(blockingReasons, `duplicate_ledgers_present:${sampleId}`)
      watermarkContinuityVerified = false
    }
    if (minute.skippedLedgerCount !== 0) {
      addReason(blockingReasons, `skipped_ledgers_present:${sampleId}`)
      watermarkContinuityVerified = false
    }
  }

  if (input.safety.productionCredentialsUsed) {
    addReason(blockingReasons, 'production_credentials_used')
  }
  if (input.safety.productionMutationPerformed) {
    addReason(blockingReasons, 'production_mutation_performed')
  }
  if (input.safety.recoveryMutationCommitted) {
    addReason(blockingReasons, 'recovery_mutation_committed')
  }
  if (input.safety.transactionSubmissionPerformed) {
    addReason(blockingReasons, 'transaction_submission_performed')
  }
  if (!input.safety.publicReaderUnchanged) {
    addReason(blockingReasons, 'public_reader_changed')
  }
  if (!input.safety.mainnetDisabled) {
    addReason(blockingReasons, 'mainnet_not_disabled')
  }
  if (input.safety.stabilizationAuthorized) {
    addReason(blockingReasons, 'stabilization_authorized')
  }
  if (input.safety.soakAuthorized) {
    addReason(blockingReasons, 'soak_authorized')
  }

  const sampleMinutes = input.minutes.length
  const totalCommittedLedgers = safeSum(
    input.minutes.map((minute) => minute.committedLedgers),
  )
  const minimumCommittedLedgersPerMinute = safeMin(
    input.minutes.map((minute) => minute.committedLedgers),
  )
  const initialBacklogLedgers = backlogStarts.length > 0 ? backlogStarts[0] : null
  const finalBacklogLedgers = backlogEnds.length > 0
    ? backlogEnds[backlogEnds.length - 1]
    : null
  const minimumSourceHeadAdvancePerMinute = safeMin(headAdvances)
  const minimumBacklogReductionPerMinute = safeMin(backlogReductions)
  const maximumApplicationBillableEgressUpperBoundBytesPerMinute = safeMax(
    input.minutes.map((minute) => minute.applicationBillableEgressUpperBoundBytes),
  )
  const maximumInvocationsPerMinute = safeMax(
    input.minutes.map((minute) => minute.invocationCount),
  )
  const maximumPeakMemoryBytes = safeMax(
    input.minutes.map((minute) => minute.maximumPeakMemoryBytes),
  )
  const maximumClaimLedgers = safeMax(
    input.minutes.map((minute) => minute.maximumClaimLedgers),
  )

  const catchupBillableEgressUpperBoundBytesPerMinute =
    maximumApplicationBillableEgressUpperBoundBytesPerMinute === null
      ? null
      : safeSum([
          maximumApplicationBillableEgressUpperBoundBytesPerMinute,
          input.prerequisites.selectedUnexplainedDeltaReserveBytesPerMinute,
        ])

  const projectedCatchupMinutes =
    initialBacklogLedgers === null || minimumBacklogReductionPerMinute === null
      ? null
      : safeCeilDivide(initialBacklogLedgers, minimumBacklogReductionPerMinute)
  const catchupMinutesWithinRollingWindow = projectedCatchupMinutes === null
    ? null
    : Math.min(projectedCatchupMinutes, SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES)

  let projectedRollingEgressUpperBoundBytes: number | null = null
  let projectedRollingInvocations: number | null = null
  if (catchupMinutesWithinRollingWindow !== null) {
    const steadyMinutes =
      SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES - catchupMinutesWithinRollingWindow
    const catchupEgress = catchupBillableEgressUpperBoundBytesPerMinute === null
      ? null
      : safeMultiply(
          catchupBillableEgressUpperBoundBytesPerMinute,
          catchupMinutesWithinRollingWindow,
        )
    const steadyEgress = safeMultiply(
      input.prerequisites.g5SteadyBillableEgressUpperBoundBytesPerMinute,
      steadyMinutes,
    )
    if (catchupEgress !== null && steadyEgress !== null) {
      projectedRollingEgressUpperBoundBytes = safeSum([
        catchupEgress,
        steadyEgress,
        input.prerequisites.interventionReserveBytes,
      ])
    }

    const catchupInvocations = maximumInvocationsPerMinute === null
      ? null
      : safeMultiply(maximumInvocationsPerMinute, catchupMinutesWithinRollingWindow)
    const steadyInvocations = safeMultiply(
      input.prerequisites.g5SteadyInvocationsPerMinute,
      steadyMinutes,
    )
    if (catchupInvocations !== null && steadyInvocations !== null) {
      projectedRollingInvocations = safeSum([
        catchupInvocations,
        steadyInvocations,
      ])
    }
  }

  if (projectedRollingEgressUpperBoundBytes === null) {
    addReason(blockingReasons, 'rolling_egress_projection_invalid')
  } else if (
    projectedRollingEgressUpperBoundBytes
    >= SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
  ) {
    addReason(blockingReasons, 'rolling_egress_halt_reached')
  }
  if (projectedRollingInvocations === null) {
    addReason(blockingReasons, 'rolling_invocation_projection_invalid')
  } else if (projectedRollingInvocations >= SUPABASE_REVISION4_INVOCATION_HALT) {
    addReason(blockingReasons, 'rolling_invocation_halt_reached')
  }

  const rollingEgressHeadroomBytes = projectedRollingEgressUpperBoundBytes === null
    ? null
    : SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
      - projectedRollingEgressUpperBoundBytes
  const invocationHeadroom = projectedRollingInvocations === null
    ? null
    : SUPABASE_REVISION4_INVOCATION_HALT - projectedRollingInvocations
  const minimumMemoryHeadroomBytes = maximumPeakMemoryBytes === null
    ? null
    : SUPABASE_REVISION4_MEMORY_HALT_BYTES - maximumPeakMemoryBytes

  return {
    schemaVersion: SUPABASE_REVISION4_CATCHUP_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    machineSummary: {
      sampleMinutes,
      totalCommittedLedgers,
      minimumCommittedLedgersPerMinute,
      initialBacklogLedgers,
      finalBacklogLedgers,
      minimumSourceHeadAdvancePerMinute,
      minimumBacklogReductionPerMinute,
      maximumApplicationBillableEgressUpperBoundBytesPerMinute,
      selectedUnexplainedDeltaReserveBytesPerMinute:
        input.prerequisites.selectedUnexplainedDeltaReserveBytesPerMinute,
      catchupBillableEgressUpperBoundBytesPerMinute,
      projectedCatchupMinutes,
      catchupMinutesWithinRollingWindow,
      projectedRollingEgressUpperBoundBytes,
      rollingEgressHeadroomBytes,
      maximumInvocationsPerMinute,
      projectedRollingInvocations,
      invocationHeadroom,
      maximumPeakMemoryBytes,
      minimumMemoryHeadroomBytes,
      maximumClaimLedgers,
      movingHeadSequenceVerified,
      watermarkContinuityVerified,
      backlogConvergenceVerified,
    },
  }
}
