import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export const SUPABASE_REVISION4_STEADY_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_STEADY_RESULT_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES = 4 * 1024 * 1024 * 1024
export const SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES = 31 * 24 * 60
export const SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE = 21
export const SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_WINDOW =
  SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES
  * SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE
export const SUPABASE_REVISION4_INVOCATION_HALT = 400_000
export const SUPABASE_REVISION4_MEMORY_HALT_BYTES = 224 * 1024 * 1024
export const SUPABASE_REVISION4_CLAIM_CAP_LEDGERS = 12
export const SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES = 6

export type SupabaseRevision4SteadyEvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_steady_replay'

export interface SupabaseRevision4SteadyMinuteInput {
  minuteStart: string
  startLedgerIndex: number
  endLedgerIndex: number
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

export interface SupabaseRevision4SteadyConvergenceInput {
  schemaVersion: typeof SUPABASE_REVISION4_STEADY_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4SteadyEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  capturedAt: string
  sourceCommit: string
  prerequisites: {
    g3ProviderReconciliationPassed: boolean
    providerCaptureDigest: string
    selectedUnexplainedDeltaReserveBytesPerMinute: number
    interventionReserveApproved: boolean
    interventionReserveBytes: number
    interventionReserveRationaleDigest: string
  }
  policy: {
    rollingEgressHaltBytes: number
    rollingWindowMinutes: number
    requiredLedgersPerMinute: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
    minimumConsecutiveMinutes: number
  }
  minutes: SupabaseRevision4SteadyMinuteInput[]
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

export interface SupabaseRevision4SteadyConvergenceResult {
  schemaVersion: typeof SUPABASE_REVISION4_STEADY_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4SteadyEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  machineSummary: {
    sampleMinutes: number
    totalCommittedLedgers: number
    averageCommittedLedgersPerMinute: number | null
    minimumCommittedLedgersPerMinute: number | null
    requiredLedgersPerMinute: number
    requiredLedgersPerWindow: number
    totalApplicationBillableEgressUpperBoundBytes: number
    totalSelectedUnexplainedDeltaReserveBytes: number
    observedBillableEgressUpperBoundBytes: number
    projectedApplicationBillableEgressUpperBoundBytes: number | null
    projectedUnexplainedDeltaReserveBytes: number | null
    interventionReserveBytes: number
    projectedRollingEgressUpperBoundBytes: number | null
    rollingEgressHeadroomBytes: number | null
    observedAverageBillableEgressUpperBoundBytesPerLedger: number | null
    maximumAverageBytesPerRequiredLedgerAfterInterventionReserve: number | null
    totalInvocations: number
    projectedInvocations: number | null
    invocationHeadroom: number | null
    maximumPeakMemoryBytes: number | null
    minimumMemoryHeadroomBytes: number | null
    maximumClaimLedgers: number | null
    consecutiveMinuteSequenceVerified: boolean
    ledgerContinuityVerified: boolean
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu
const SECRET_VALUE_PATTERN = /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/u

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason)
  }
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function safeSum(values: readonly number[]): number | null {
  let total = 0
  for (const value of values) {
    if (!isNonNegativeSafeInteger(value)) {
      return null
    }
    total += value
    if (!Number.isSafeInteger(total)) {
      return null
    }
  }
  return total
}

function scaledProjection(total: number, sampleMinutes: number): number | null {
  if (!isNonNegativeSafeInteger(total) || !isPositiveSafeInteger(sampleMinutes)) {
    return null
  }
  const projected = Math.ceil(
    (total * SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES) / sampleMinutes,
  )
  return Number.isSafeInteger(projected) ? projected : null
}

function canonicalTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}

function containsSecret(value: unknown, key = ''): boolean {
  if (SECRET_KEY_PATTERN.test(key)) {
    return true
  }
  if (typeof value === 'string') {
    return SECRET_VALUE_PATTERN.test(value)
  }
  if (Array.isArray(value)) {
    return value.some((item) => containsSecret(item))
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([entryKey, entryValue]) =>
      containsSecret(entryValue, entryKey),
    )
  }
  return false
}

export function verifySupabaseRevision4SteadyConvergence(
  input: SupabaseRevision4SteadyConvergenceInput,
): SupabaseRevision4SteadyConvergenceResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_STEADY_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_steady_replay') {
    addReason(blockingReasons, 'synthetic_or_unbounded_evidence_not_qualifying')
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
  if (!SHA256_PATTERN.test(input.prerequisites.providerCaptureDigest)) {
    addReason(blockingReasons, 'provider_capture_digest_invalid')
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
  }
  if (
    input.prerequisites.interventionReserveBytes
    >= SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
  ) {
    addReason(blockingReasons, 'intervention_reserve_exhausts_egress_halt')
  }
  if (!SHA256_PATTERN.test(input.prerequisites.interventionReserveRationaleDigest)) {
    addReason(blockingReasons, 'intervention_reserve_rationale_digest_invalid')
  }

  const expectedPolicy = {
    rollingEgressHaltBytes: SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
    rollingWindowMinutes: SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
    requiredLedgersPerMinute: SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
    invocationHalt: SUPABASE_REVISION4_INVOCATION_HALT,
    memoryHaltBytes: SUPABASE_REVISION4_MEMORY_HALT_BYTES,
    claimCapLedgers: SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
    minimumConsecutiveMinutes: SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES,
  }
  for (const [key, expected] of Object.entries(expectedPolicy)) {
    if (input.policy[key as keyof typeof input.policy] !== expected) {
      addReason(blockingReasons, `policy_changed:${key}`)
    }
  }

  if (input.minutes.length < SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES) {
    addReason(blockingReasons, 'insufficient_consecutive_minute_samples')
  }

  let consecutiveMinuteSequenceVerified = input.minutes.length > 0
  let ledgerContinuityVerified = input.minutes.length > 0
  let previousMinuteStart: number | null = null
  let previousEndLedger: number | null = null

  for (const [index, minute] of input.minutes.entries()) {
    const sampleId = `minute_${index}`
    if (!canonicalTimestamp(minute.minuteStart)) {
      addReason(blockingReasons, `minute_start_invalid:${sampleId}`)
      consecutiveMinuteSequenceVerified = false
    }
    const minuteStart = Date.parse(minute.minuteStart)
    if (
      previousMinuteStart !== null
      && (!Number.isFinite(minuteStart) || minuteStart - previousMinuteStart !== 60_000)
    ) {
      addReason(blockingReasons, `minute_sequence_not_consecutive:${sampleId}`)
      consecutiveMinuteSequenceVerified = false
    }
    previousMinuteStart = minuteStart

    if (
      !isPositiveSafeInteger(minute.startLedgerIndex)
      || !isPositiveSafeInteger(minute.endLedgerIndex)
      || minute.endLedgerIndex < minute.startLedgerIndex
    ) {
      addReason(blockingReasons, `ledger_range_invalid:${sampleId}`)
      ledgerContinuityVerified = false
    }
    const rangeCount = minute.endLedgerIndex - minute.startLedgerIndex + 1
    if (!isPositiveSafeInteger(minute.committedLedgers)) {
      addReason(blockingReasons, `committed_ledgers_invalid:${sampleId}`)
    } else if (minute.committedLedgers !== rangeCount) {
      addReason(blockingReasons, `committed_ledgers_range_mismatch:${sampleId}`)
      ledgerContinuityVerified = false
    }
    if (minute.committedLedgers < SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE) {
      addReason(blockingReasons, `minute_below_required_rate:${sampleId}`)
    }
    if (
      previousEndLedger !== null
      && minute.startLedgerIndex !== previousEndLedger + 1
    ) {
      addReason(blockingReasons, `ledger_sequence_not_contiguous:${sampleId}`)
      ledgerContinuityVerified = false
    }
    previousEndLedger = minute.endLedgerIndex

    if (!isPositiveSafeInteger(minute.invocationCount)) {
      addReason(blockingReasons, `invocation_count_invalid:${sampleId}`)
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
      ledgerContinuityVerified = false
    }
    if (minute.duplicateLedgerCount !== 0) {
      addReason(blockingReasons, `duplicate_ledgers_present:${sampleId}`)
      ledgerContinuityVerified = false
    }
    if (minute.skippedLedgerCount !== 0) {
      addReason(blockingReasons, `skipped_ledgers_present:${sampleId}`)
      ledgerContinuityVerified = false
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
  const totalApplicationEgress = safeSum(
    input.minutes.map((minute) => minute.applicationBillableEgressUpperBoundBytes),
  )
  const totalInvocations = safeSum(
    input.minutes.map((minute) => minute.invocationCount),
  )
  const reservePerMinute =
    input.prerequisites.selectedUnexplainedDeltaReserveBytesPerMinute
  const totalSelectedReserve = safeSum(
    input.minutes.map(() => reservePerMinute),
  )
  const observedEgress =
    totalApplicationEgress === null || totalSelectedReserve === null
      ? null
      : safeSum([totalApplicationEgress, totalSelectedReserve])

  const projectedApplicationEgress =
    totalApplicationEgress === null
      ? null
      : scaledProjection(totalApplicationEgress, sampleMinutes)
  const projectedUnexplainedReserve =
    totalSelectedReserve === null
      ? null
      : scaledProjection(totalSelectedReserve, sampleMinutes)
  const projectedInvocations =
    totalInvocations === null
      ? null
      : scaledProjection(totalInvocations, sampleMinutes)
  const projectedRollingEgress =
    projectedApplicationEgress === null || projectedUnexplainedReserve === null
      ? null
      : safeSum([
          projectedApplicationEgress,
          projectedUnexplainedReserve,
          input.prerequisites.interventionReserveBytes,
        ])

  if (totalCommittedLedgers === null) {
    addReason(blockingReasons, 'total_committed_ledgers_invalid')
  }
  if (totalApplicationEgress === null || totalSelectedReserve === null) {
    addReason(blockingReasons, 'total_egress_upper_bound_invalid')
  }
  if (totalInvocations === null) {
    addReason(blockingReasons, 'total_invocations_invalid')
  }
  if (projectedRollingEgress === null) {
    addReason(blockingReasons, 'projected_rolling_egress_invalid')
  } else if (projectedRollingEgress >= SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES) {
    addReason(blockingReasons, 'projected_rolling_egress_not_below_halt')
  }
  if (projectedInvocations === null) {
    addReason(blockingReasons, 'projected_invocations_invalid')
  } else if (projectedInvocations >= SUPABASE_REVISION4_INVOCATION_HALT) {
    addReason(blockingReasons, 'projected_invocations_not_below_halt')
  }

  const minimumCommittedLedgersPerMinute = input.minutes.length > 0
    ? Math.min(...input.minutes.map((minute) => minute.committedLedgers))
    : null
  const averageCommittedLedgersPerMinute =
    totalCommittedLedgers === null || sampleMinutes === 0
      ? null
      : totalCommittedLedgers / sampleMinutes
  if (
    averageCommittedLedgersPerMinute === null
    || averageCommittedLedgersPerMinute < SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE
  ) {
    addReason(blockingReasons, 'average_steady_rate_below_requirement')
  }

  const maximumPeakMemoryBytes = input.minutes.length > 0
    ? Math.max(...input.minutes.map((minute) => minute.maximumPeakMemoryBytes))
    : null
  const maximumClaimLedgers = input.minutes.length > 0
    ? Math.max(...input.minutes.map((minute) => minute.maximumClaimLedgers))
    : null
  const observedAverageBytesPerLedger =
    observedEgress === null || totalCommittedLedgers === null || totalCommittedLedgers === 0
      ? null
      : Math.ceil(observedEgress / totalCommittedLedgers)
  const maximumAverageBytesPerRequiredLedger =
    isPositiveSafeInteger(input.prerequisites.interventionReserveBytes)
    && input.prerequisites.interventionReserveBytes
      < SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
      ? Math.floor(
          (SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES
            - input.prerequisites.interventionReserveBytes)
          / SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_WINDOW,
        )
      : null

  return {
    schemaVersion: SUPABASE_REVISION4_STEADY_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    machineSummary: {
      sampleMinutes,
      totalCommittedLedgers: totalCommittedLedgers ?? 0,
      averageCommittedLedgersPerMinute,
      minimumCommittedLedgersPerMinute,
      requiredLedgersPerMinute: SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
      requiredLedgersPerWindow: SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_WINDOW,
      totalApplicationBillableEgressUpperBoundBytes: totalApplicationEgress ?? 0,
      totalSelectedUnexplainedDeltaReserveBytes: totalSelectedReserve ?? 0,
      observedBillableEgressUpperBoundBytes: observedEgress ?? 0,
      projectedApplicationBillableEgressUpperBoundBytes: projectedApplicationEgress,
      projectedUnexplainedDeltaReserveBytes: projectedUnexplainedReserve,
      interventionReserveBytes: input.prerequisites.interventionReserveBytes,
      projectedRollingEgressUpperBoundBytes: projectedRollingEgress,
      rollingEgressHeadroomBytes:
        projectedRollingEgress === null
          ? null
          : SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES - projectedRollingEgress,
      observedAverageBillableEgressUpperBoundBytesPerLedger: observedAverageBytesPerLedger,
      maximumAverageBytesPerRequiredLedgerAfterInterventionReserve:
        maximumAverageBytesPerRequiredLedger,
      totalInvocations: totalInvocations ?? 0,
      projectedInvocations,
      invocationHeadroom:
        projectedInvocations === null
          ? null
          : SUPABASE_REVISION4_INVOCATION_HALT - projectedInvocations,
      maximumPeakMemoryBytes,
      minimumMemoryHeadroomBytes:
        maximumPeakMemoryBytes === null
          ? null
          : SUPABASE_REVISION4_MEMORY_HALT_BYTES - maximumPeakMemoryBytes,
      maximumClaimLedgers,
      consecutiveMinuteSequenceVerified,
      ledgerContinuityVerified,
    },
  }
}
