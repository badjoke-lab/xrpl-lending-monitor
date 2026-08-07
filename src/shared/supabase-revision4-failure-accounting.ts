import {
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'
import type { SupabaseRevision4AccountingDisposition } from './supabase-revision4-directional-meter'

export const SUPABASE_REVISION4_FAILURE_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_FAILURE_RESULT_SCHEMA_VERSION = 1 as const

export type SupabaseRevision4FailureEvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_failure_accounting_replay'

export type SupabaseRevision4FailureScenarioKind =
  | 'failed_retry'
  | 'rollback_retry'
  | 'lease_reclaim_retry'
  | 'adopted_descendant'
  | 'repair_separation'

export type SupabaseRevision4FailureAttemptRole =
  | 'ordinary_success'
  | 'failed'
  | 'retry_success'
  | 'rolled_back'
  | 'reclaimed_source'
  | 'reclaim_success'
  | 'source_committed'
  | 'adoption'
  | 'repair_only'

export interface SupabaseRevision4FailureAttemptInput {
  attemptId: string
  role: SupabaseRevision4FailureAttemptRole
  disposition: SupabaseRevision4AccountingDisposition
  accountingDigest: string
  measuredBillableEgressUpperBoundBytes: number
  failureReservationUpperBoundBytes: number
  retainedBillableEgressUpperBoundBytes: number
  invocationCount: number
  maximumPeakMemoryBytes: number
  maximumClaimLedgers: number
}

export interface SupabaseRevision4FailureScenarioInput {
  scenarioId: string
  kind: SupabaseRevision4FailureScenarioKind
  pathEvidenceDigest: string
  attempts: SupabaseRevision4FailureAttemptInput[]
  retainedHistoricalBillableEgressUpperBoundBytes: number
  ordinarySuccessfulBillableEgressUpperBoundBytes: number
  failurePathRetainedBillableEgressUpperBoundBytes: number
  repairOnlyRetainedBillableEgressUpperBoundBytes: number
  adoptionOperationBillableEgressUpperBoundBytes: number
}

export interface SupabaseRevision4FailureAccountingInput {
  schemaVersion: typeof SUPABASE_REVISION4_FAILURE_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4FailureEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  capturedAt: string
  sourceCommit: string
  prerequisites: {
    g3ProviderReconciliationPassed: boolean
    g4MemoryRequalificationPassed: boolean
    g5SteadyConvergencePassed: boolean
    g6CatchupConvergencePassed: boolean
    providerCaptureDigest: string
    g4MemoryEvidenceDigest: string
    g5SteadyEvidenceDigest: string
    g6CatchupEvidenceDigest: string
  }
  policy: {
    rollingEgressHaltBytes: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
  }
  scenarios: SupabaseRevision4FailureScenarioInput[]
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

export interface SupabaseRevision4FailureAccountingResult {
  schemaVersion: typeof SUPABASE_REVISION4_FAILURE_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4FailureEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  machineSummary: {
    scenarioCount: number
    attemptCount: number
    retainedHistoricalBillableEgressUpperBoundBytes: number | null
    ordinarySuccessfulBillableEgressUpperBoundBytes: number | null
    failurePathRetainedBillableEgressUpperBoundBytes: number | null
    repairOnlyRetainedBillableEgressUpperBoundBytes: number | null
    adoptionOperationBillableEgressUpperBoundBytes: number | null
    totalInvocations: number | null
    maximumPeakMemoryBytes: number | null
    maximumClaimLedgers: number | null
    allRequiredScenarioKindsPresent: boolean
    failedReservationsPreserved: boolean
    retryAccountingAppended: boolean
    rollbackAccountingPreserved: boolean
    leaseReclaimAccountingPreserved: boolean
    adoptedSourceAccountingPreserved: boolean
    repairOnlySeparatedFromOrdinarySuccess: boolean
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/u
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu
const SECRET_VALUE_PATTERN = /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/u

const REQUIRED_SCENARIOS: readonly SupabaseRevision4FailureScenarioKind[] = [
  'failed_retry',
  'rollback_retry',
  'lease_reclaim_retry',
  'adopted_descendant',
  'repair_separation',
]

const ROLE_DISPOSITION: Record<
  SupabaseRevision4FailureAttemptRole,
  SupabaseRevision4AccountingDisposition
> = {
  ordinary_success: 'shadow_completed',
  failed: 'shadow_failed',
  retry_success: 'shadow_retry',
  rolled_back: 'shadow_failed',
  reclaimed_source: 'shadow_failed',
  reclaim_success: 'shadow_retry',
  source_committed: 'shadow_completed',
  adoption: 'shadow_adopted',
  repair_only: 'shadow_repair',
}

const FAILURE_RESERVATION_ROLES = new Set<SupabaseRevision4FailureAttemptRole>([
  'failed',
  'rolled_back',
  'reclaimed_source',
  'repair_only',
])

const ORDINARY_SUCCESS_ROLES = new Set<SupabaseRevision4FailureAttemptRole>([
  'ordinary_success',
  'retry_success',
  'reclaim_success',
  'source_committed',
])

const FAILURE_PATH_ROLES = new Set<SupabaseRevision4FailureAttemptRole>([
  'failed',
  'rolled_back',
  'reclaimed_source',
])

const EXPECTED_ROLES: Record<
  SupabaseRevision4FailureScenarioKind,
  readonly SupabaseRevision4FailureAttemptRole[]
> = {
  failed_retry: ['failed', 'retry_success'],
  rollback_retry: ['rolled_back', 'retry_success'],
  lease_reclaim_retry: ['reclaimed_source', 'reclaim_success'],
  adopted_descendant: ['source_committed', 'adoption'],
  repair_separation: ['ordinary_success', 'repair_only'],
}

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

function safeMax(values: readonly number[]): number | null {
  if (values.length === 0 || values.some((value) => !isNonNegativeSafeInteger(value))) {
    return null
  }
  return Math.max(...values)
}

function rolesExactlyMatch(
  attempts: readonly SupabaseRevision4FailureAttemptInput[],
  expected: readonly SupabaseRevision4FailureAttemptRole[],
): boolean {
  if (attempts.length !== expected.length) return false
  const roles = attempts.map((attempt) => attempt.role).sort()
  const expectedSorted = [...expected].sort()
  return roles.every((role, index) => role === expectedSorted[index])
}

function roleSum(
  attempts: readonly SupabaseRevision4FailureAttemptInput[],
  roles: ReadonlySet<SupabaseRevision4FailureAttemptRole>,
): number | null {
  return safeSum(
    attempts
      .filter((attempt) => roles.has(attempt.role))
      .map((attempt) => attempt.retainedBillableEgressUpperBoundBytes),
  )
}

export function verifySupabaseRevision4FailureAccounting(
  input: SupabaseRevision4FailureAccountingInput,
): SupabaseRevision4FailureAccountingResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_FAILURE_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_failure_accounting_replay') {
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
  if (!IDENTIFIER_PATTERN.test(input.evidenceId)) {
    addReason(blockingReasons, 'evidence_id_invalid')
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

  const prerequisiteStates = [
    ['g3_provider_reconciliation', input.prerequisites.g3ProviderReconciliationPassed],
    ['g4_memory_requalification', input.prerequisites.g4MemoryRequalificationPassed],
    ['g5_steady_convergence', input.prerequisites.g5SteadyConvergencePassed],
    ['g6_catchup_convergence', input.prerequisites.g6CatchupConvergencePassed],
  ] as const
  for (const [name, passed] of prerequisiteStates) {
    if (!passed) addReason(blockingReasons, `${name}_not_passed`)
  }

  for (const [name, digest] of [
    ['provider_capture', input.prerequisites.providerCaptureDigest],
    ['g4_memory_evidence', input.prerequisites.g4MemoryEvidenceDigest],
    ['g5_steady_evidence', input.prerequisites.g5SteadyEvidenceDigest],
    ['g6_catchup_evidence', input.prerequisites.g6CatchupEvidenceDigest],
  ] as const) {
    if (!SHA256_PATTERN.test(digest)) {
      addReason(blockingReasons, `${name}_digest_invalid`)
    }
  }

  const expectedPolicy = {
    rollingEgressHaltBytes: SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes,
    invocationHalt: SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d,
    memoryHaltBytes: SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes,
    claimCapLedgers: SUPABASE_REVISION4_FIXED_GUARDS.selectedMaximumLedgersPerClaim,
  }
  for (const [key, expected] of Object.entries(expectedPolicy)) {
    if (input.policy[key as keyof typeof input.policy] !== expected) {
      addReason(blockingReasons, `policy_changed:${key}`)
    }
  }

  const seenScenarioKinds = new Set<SupabaseRevision4FailureScenarioKind>()
  const seenScenarioIds = new Set<string>()
  const seenAttemptIds = new Set<string>()
  const seenAccountingDigests = new Set<string>()
  const allAttempts: SupabaseRevision4FailureAttemptInput[] = []

  let failedReservationsPreserved = true
  let retryAccountingAppended = true
  let rollbackAccountingPreserved = true
  let leaseReclaimAccountingPreserved = true
  let adoptedSourceAccountingPreserved = true
  let repairOnlySeparatedFromOrdinarySuccess = true

  for (const [scenarioIndex, scenario] of input.scenarios.entries()) {
    const scenarioRef = `scenario_${scenarioIndex}`
    if (!IDENTIFIER_PATTERN.test(scenario.scenarioId)) {
      addReason(blockingReasons, `scenario_id_invalid:${scenarioRef}`)
    } else if (seenScenarioIds.has(scenario.scenarioId)) {
      addReason(blockingReasons, `scenario_id_duplicated:${scenarioRef}`)
    }
    seenScenarioIds.add(scenario.scenarioId)

    if (!REQUIRED_SCENARIOS.includes(scenario.kind)) {
      addReason(blockingReasons, `scenario_kind_invalid:${scenarioRef}`)
    } else {
      if (seenScenarioKinds.has(scenario.kind)) {
        addReason(blockingReasons, `scenario_kind_duplicated:${scenario.kind}`)
      }
      seenScenarioKinds.add(scenario.kind)
    }
    if (!SHA256_PATTERN.test(scenario.pathEvidenceDigest)) {
      addReason(blockingReasons, `path_evidence_digest_invalid:${scenarioRef}`)
    }
    if (!rolesExactlyMatch(scenario.attempts, EXPECTED_ROLES[scenario.kind])) {
      addReason(blockingReasons, `scenario_role_shape_invalid:${scenarioRef}`)
    }

    for (const [attemptIndex, attempt] of scenario.attempts.entries()) {
      const attemptRef = `${scenarioRef}:attempt_${attemptIndex}`
      allAttempts.push(attempt)

      if (!IDENTIFIER_PATTERN.test(attempt.attemptId)) {
        addReason(blockingReasons, `attempt_id_invalid:${attemptRef}`)
      } else if (seenAttemptIds.has(attempt.attemptId)) {
        addReason(blockingReasons, `attempt_id_duplicated:${attemptRef}`)
      }
      seenAttemptIds.add(attempt.attemptId)

      if (!SHA256_PATTERN.test(attempt.accountingDigest)) {
        addReason(blockingReasons, `accounting_digest_invalid:${attemptRef}`)
      } else if (seenAccountingDigests.has(attempt.accountingDigest)) {
        addReason(blockingReasons, `accounting_digest_duplicated:${attemptRef}`)
      }
      seenAccountingDigests.add(attempt.accountingDigest)

      if (attempt.disposition !== ROLE_DISPOSITION[attempt.role]) {
        addReason(blockingReasons, `disposition_role_mismatch:${attemptRef}`)
      }
      if (!isNonNegativeSafeInteger(attempt.measuredBillableEgressUpperBoundBytes)) {
        addReason(blockingReasons, `measured_egress_invalid:${attemptRef}`)
      }
      if (!isNonNegativeSafeInteger(attempt.failureReservationUpperBoundBytes)) {
        addReason(blockingReasons, `failure_reservation_invalid:${attemptRef}`)
      }
      if (!isNonNegativeSafeInteger(attempt.retainedBillableEgressUpperBoundBytes)) {
        addReason(blockingReasons, `retained_egress_invalid:${attemptRef}`)
      }

      const requiresFailureReservation = FAILURE_RESERVATION_ROLES.has(attempt.role)
      if (requiresFailureReservation) {
        if (!isPositiveSafeInteger(attempt.failureReservationUpperBoundBytes)) {
          addReason(blockingReasons, `failure_reservation_missing:${attemptRef}`)
          failedReservationsPreserved = false
        }
        const expectedRetained = Math.max(
          attempt.measuredBillableEgressUpperBoundBytes,
          attempt.failureReservationUpperBoundBytes,
        )
        if (attempt.retainedBillableEgressUpperBoundBytes !== expectedRetained) {
          addReason(blockingReasons, `failure_reservation_not_preserved:${attemptRef}`)
          failedReservationsPreserved = false
        }
      } else {
        if (attempt.failureReservationUpperBoundBytes !== 0) {
          addReason(blockingReasons, `unexpected_failure_reservation:${attemptRef}`)
        }
        if (
          attempt.retainedBillableEgressUpperBoundBytes
          !== attempt.measuredBillableEgressUpperBoundBytes
        ) {
          addReason(blockingReasons, `successful_egress_not_exactly_retained:${attemptRef}`)
        }
      }

      if (!isPositiveSafeInteger(attempt.invocationCount)) {
        addReason(blockingReasons, `invocation_count_invalid:${attemptRef}`)
      }
      if (!isPositiveSafeInteger(attempt.maximumPeakMemoryBytes)) {
        addReason(blockingReasons, `peak_memory_invalid:${attemptRef}`)
      } else if (
        attempt.maximumPeakMemoryBytes
        >= SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes
      ) {
        addReason(blockingReasons, `memory_halt_reached:${attemptRef}`)
      }
      if (!isPositiveSafeInteger(attempt.maximumClaimLedgers)) {
        addReason(blockingReasons, `maximum_claim_invalid:${attemptRef}`)
      } else if (
        attempt.maximumClaimLedgers
        > SUPABASE_REVISION4_FIXED_GUARDS.selectedMaximumLedgersPerClaim
      ) {
        addReason(blockingReasons, `claim_cap_exceeded:${attemptRef}`)
      }
    }

    const retainedHistorical = safeSum(
      scenario.attempts.map((attempt) => attempt.retainedBillableEgressUpperBoundBytes),
    )
    const ordinarySuccessful = roleSum(scenario.attempts, ORDINARY_SUCCESS_ROLES)
    const failurePath = roleSum(scenario.attempts, FAILURE_PATH_ROLES)
    const repairOnly = roleSum(
      scenario.attempts,
      new Set<SupabaseRevision4FailureAttemptRole>(['repair_only']),
    )
    const adoptionOperation = roleSum(
      scenario.attempts,
      new Set<SupabaseRevision4FailureAttemptRole>(['adoption']),
    )

    for (const [name, actual, retained] of [
      ['historical', retainedHistorical, scenario.retainedHistoricalBillableEgressUpperBoundBytes],
      ['ordinary_success', ordinarySuccessful, scenario.ordinarySuccessfulBillableEgressUpperBoundBytes],
      ['failure_path', failurePath, scenario.failurePathRetainedBillableEgressUpperBoundBytes],
      ['repair_only', repairOnly, scenario.repairOnlyRetainedBillableEgressUpperBoundBytes],
      ['adoption_operation', adoptionOperation, scenario.adoptionOperationBillableEgressUpperBoundBytes],
    ] as const) {
      if (actual === null || retained !== actual) {
        addReason(blockingReasons, `scenario_summary_mismatch:${scenarioRef}:${name}`)
      }
    }

    if (scenario.kind === 'failed_retry') {
      const failed = scenario.attempts.find((attempt) => attempt.role === 'failed')
      const retry = scenario.attempts.find((attempt) => attempt.role === 'retry_success')
      if (
        !failed
        || !retry
        || failed.accountingDigest === retry.accountingDigest
        || scenario.retainedHistoricalBillableEgressUpperBoundBytes
          !== failed.retainedBillableEgressUpperBoundBytes
            + retry.retainedBillableEgressUpperBoundBytes
      ) {
        addReason(blockingReasons, 'failed_retry_accounting_not_appended')
        retryAccountingAppended = false
      }
    }

    if (scenario.kind === 'rollback_retry') {
      const rolledBack = scenario.attempts.find((attempt) => attempt.role === 'rolled_back')
      const retry = scenario.attempts.find((attempt) => attempt.role === 'retry_success')
      if (
        !rolledBack
        || !retry
        || rolledBack.retainedBillableEgressUpperBoundBytes <= 0
        || scenario.retainedHistoricalBillableEgressUpperBoundBytes
          !== rolledBack.retainedBillableEgressUpperBoundBytes
            + retry.retainedBillableEgressUpperBoundBytes
      ) {
        addReason(blockingReasons, 'rollback_accounting_erased')
        rollbackAccountingPreserved = false
      }
    }

    if (scenario.kind === 'lease_reclaim_retry') {
      const reclaimed = scenario.attempts.find((attempt) => attempt.role === 'reclaimed_source')
      const successor = scenario.attempts.find((attempt) => attempt.role === 'reclaim_success')
      if (
        !reclaimed
        || !successor
        || reclaimed.retainedBillableEgressUpperBoundBytes <= 0
        || reclaimed.attemptId === successor.attemptId
        || scenario.retainedHistoricalBillableEgressUpperBoundBytes
          !== reclaimed.retainedBillableEgressUpperBoundBytes
            + successor.retainedBillableEgressUpperBoundBytes
      ) {
        addReason(blockingReasons, 'lease_reclaim_prior_accounting_erased')
        leaseReclaimAccountingPreserved = false
      }
    }

    if (scenario.kind === 'adopted_descendant') {
      const source = scenario.attempts.find((attempt) => attempt.role === 'source_committed')
      const adoption = scenario.attempts.find((attempt) => attempt.role === 'adoption')
      if (
        !source
        || !adoption
        || source.retainedBillableEgressUpperBoundBytes <= 0
        || scenario.retainedHistoricalBillableEgressUpperBoundBytes
          !== source.retainedBillableEgressUpperBoundBytes
            + adoption.retainedBillableEgressUpperBoundBytes
      ) {
        addReason(blockingReasons, 'adopted_source_accounting_not_preserved')
        adoptedSourceAccountingPreserved = false
      }
    }

    if (scenario.kind === 'repair_separation') {
      const ordinary = scenario.attempts.find((attempt) => attempt.role === 'ordinary_success')
      const repair = scenario.attempts.find((attempt) => attempt.role === 'repair_only')
      if (
        !ordinary
        || !repair
        || ordinary.retainedBillableEgressUpperBoundBytes <= 0
        || repair.retainedBillableEgressUpperBoundBytes <= 0
        || scenario.ordinarySuccessfulBillableEgressUpperBoundBytes
          !== ordinary.retainedBillableEgressUpperBoundBytes
        || scenario.repairOnlyRetainedBillableEgressUpperBoundBytes
          !== repair.retainedBillableEgressUpperBoundBytes
        || scenario.retainedHistoricalBillableEgressUpperBoundBytes
          !== ordinary.retainedBillableEgressUpperBoundBytes
            + repair.retainedBillableEgressUpperBoundBytes
      ) {
        addReason(blockingReasons, 'repair_only_not_separated_from_ordinary_success')
        repairOnlySeparatedFromOrdinarySuccess = false
      }
    }
  }

  const allRequiredScenarioKindsPresent = REQUIRED_SCENARIOS.every((kind) =>
    seenScenarioKinds.has(kind),
  )
  if (!allRequiredScenarioKindsPresent || seenScenarioKinds.size !== REQUIRED_SCENARIOS.length) {
    addReason(blockingReasons, 'required_failure_scenarios_incomplete')
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

  return {
    schemaVersion: SUPABASE_REVISION4_FAILURE_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    machineSummary: {
      scenarioCount: input.scenarios.length,
      attemptCount: allAttempts.length,
      retainedHistoricalBillableEgressUpperBoundBytes: safeSum(
        allAttempts.map((attempt) => attempt.retainedBillableEgressUpperBoundBytes),
      ),
      ordinarySuccessfulBillableEgressUpperBoundBytes: roleSum(
        allAttempts,
        ORDINARY_SUCCESS_ROLES,
      ),
      failurePathRetainedBillableEgressUpperBoundBytes: roleSum(
        allAttempts,
        FAILURE_PATH_ROLES,
      ),
      repairOnlyRetainedBillableEgressUpperBoundBytes: roleSum(
        allAttempts,
        new Set<SupabaseRevision4FailureAttemptRole>(['repair_only']),
      ),
      adoptionOperationBillableEgressUpperBoundBytes: roleSum(
        allAttempts,
        new Set<SupabaseRevision4FailureAttemptRole>(['adoption']),
      ),
      totalInvocations: safeSum(allAttempts.map((attempt) => attempt.invocationCount)),
      maximumPeakMemoryBytes: safeMax(
        allAttempts.map((attempt) => attempt.maximumPeakMemoryBytes),
      ),
      maximumClaimLedgers: safeMax(
        allAttempts.map((attempt) => attempt.maximumClaimLedgers),
      ),
      allRequiredScenarioKindsPresent,
      failedReservationsPreserved,
      retryAccountingAppended,
      rollbackAccountingPreserved,
      leaseReclaimAccountingPreserved,
      adoptedSourceAccountingPreserved,
      repairOnlySeparatedFromOrdinarySuccess,
    },
  }
}
