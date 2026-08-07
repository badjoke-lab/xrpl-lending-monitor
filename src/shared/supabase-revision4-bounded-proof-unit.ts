import {
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export const SUPABASE_REVISION4_G9_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_G9_RESULT_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_G9_ISSUE_NUMBER = 1261 as const
export const SUPABASE_REVISION4_G9_OWNER_LOGIN = 'badjoke-lab' as const

export type SupabaseRevision4G9EvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_proof_unit_execution'

export interface SupabaseRevision4G9Input {
  schemaVersion: typeof SUPABASE_REVISION4_G9_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4G9EvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  capturedAt: string
  sourceCommit: string
  prerequisites: {
    g1Passed: boolean
    g2Passed: boolean
    g3Passed: boolean
    g4Passed: boolean
    g5Passed: boolean
    g6Passed: boolean
    g7Passed: boolean
    g8Passed: boolean
    g1Digest: string
    g2Digest: string
    g3Digest: string
    g4Digest: string
    g5Digest: string
    g6Digest: string
    g7Digest: string
    g8Digest: string
  }
  policy: {
    rollingEgressHaltBytes: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
  }
  authorization: {
    authorized: boolean
    issueNumber: number
    authorizedBy: string
    authorizationCommentId: number
    authorizationDigest: string
    authorizedAt: string
    expiresAt: string
    sourceCommit: string
    profileRevision: number
    profileIdentityDigest: string
    proofUnitCount: number
    startLedgerIndex: number
    endLedgerIndex: number
    invocationBudget: number
    billableEgressBudgetBytes: number
    memoryBudgetBytes: number
    claimCapLedgers: number
  }
  execution: {
    evidenceDigest: string
    attempted: boolean
    completed: boolean
    proofUnitCount: number
    startLedgerIndex: number
    endLedgerIndex: number
    invocationsUsed: number
    billableEgressUpperBoundBytes: number
    maximumPeakMemoryBytes: number
    maximumClaimLedgers: number
    parentHashContinuityVerified: boolean
    duplicateLedgerCount: number
    skippedLedgerCount: number
    committedRowsOnly: boolean
    noPartialCommitVisible: boolean
    authorizationConsumedExactlyOnce: boolean
    duplicateExecutionRejected: boolean
    successorNotAuthorized: boolean
  }
  safety: {
    publicReaderUnchanged: boolean
    mainnetDisabled: boolean
    stabilizationAuthorized: boolean
    soakAuthorized: boolean
    transactionSubmissionPerformed: boolean
  }
}

export interface SupabaseRevision4G9Result {
  schemaVersion: typeof SUPABASE_REVISION4_G9_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4G9EvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  machineSummary: {
    allEightPrerequisitesPassed: boolean
    authorizationValid: boolean
    authorizationBoundToExactRevision4Source: boolean
    authorizationWindowValid: boolean
    proofUnitBounded: boolean
    executionMatchesAuthorization: boolean
    executionWithinBudgets: boolean
    ledgerIntegrityProved: boolean
    oneShotConsumptionProved: boolean
    releaseBoundaryClosed: boolean
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/u

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason)
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function canonicalTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}

export function verifySupabaseRevision4BoundedProofUnit(
  input: SupabaseRevision4G9Input,
): SupabaseRevision4G9Result {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_G9_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_proof_unit_execution') {
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

  const prerequisiteStates = [
    input.prerequisites.g1Passed,
    input.prerequisites.g2Passed,
    input.prerequisites.g3Passed,
    input.prerequisites.g4Passed,
    input.prerequisites.g5Passed,
    input.prerequisites.g6Passed,
    input.prerequisites.g7Passed,
    input.prerequisites.g8Passed,
  ]
  prerequisiteStates.forEach((passed, index) => {
    if (!passed) addReason(blockingReasons, `g${index + 1}_not_passed`)
  })
  for (let gate = 1; gate <= 8; gate += 1) {
    const digest = input.prerequisites[`g${gate}Digest` as keyof typeof input.prerequisites]
    if (typeof digest !== 'string' || !SHA256_PATTERN.test(digest)) {
      addReason(blockingReasons, `g${gate}_digest_invalid`)
    }
  }
  const allEightPrerequisitesPassed = prerequisiteStates.every((passed) => passed === true)

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

  const authorization = input.authorization
  if (!authorization.authorized) addReason(blockingReasons, 'owner_authorization_missing')
  if (authorization.issueNumber !== SUPABASE_REVISION4_G9_ISSUE_NUMBER) {
    addReason(blockingReasons, 'authorization_issue_mismatch')
  }
  if (authorization.authorizedBy !== SUPABASE_REVISION4_G9_OWNER_LOGIN) {
    addReason(blockingReasons, 'authorization_owner_mismatch')
  }
  if (!isPositiveSafeInteger(authorization.authorizationCommentId)) {
    addReason(blockingReasons, 'authorization_comment_invalid')
  }
  if (!SHA256_PATTERN.test(authorization.authorizationDigest)) {
    addReason(blockingReasons, 'authorization_digest_invalid')
  }
  if (!canonicalTimestamp(authorization.authorizedAt)) {
    addReason(blockingReasons, 'authorization_time_invalid')
  }
  if (!canonicalTimestamp(authorization.expiresAt)) {
    addReason(blockingReasons, 'authorization_expiry_invalid')
  }

  const authorizationBoundToExactRevision4Source =
    authorization.sourceCommit === input.sourceCommit
    && COMMIT_PATTERN.test(authorization.sourceCommit)
    && authorization.profileRevision === SUPABASE_REVISION4_PROFILE.revision
    && authorization.profileIdentityDigest === SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST
  if (!authorizationBoundToExactRevision4Source) {
    addReason(blockingReasons, 'authorization_source_or_identity_mismatch')
  }

  const capturedAt = Date.parse(input.capturedAt)
  const authorizedAt = Date.parse(authorization.authorizedAt)
  const expiresAt = Date.parse(authorization.expiresAt)
  const authorizationWindowValid =
    Number.isFinite(capturedAt)
    && Number.isFinite(authorizedAt)
    && Number.isFinite(expiresAt)
    && authorizedAt <= capturedAt
    && capturedAt <= expiresAt
    && expiresAt > authorizedAt
  if (!authorizationWindowValid) addReason(blockingReasons, 'authorization_window_invalid')

  const authorizedLedgerCount =
    authorization.endLedgerIndex - authorization.startLedgerIndex + 1
  const proofUnitBounded =
    authorization.proofUnitCount === 1
    && isPositiveSafeInteger(authorization.startLedgerIndex)
    && isPositiveSafeInteger(authorization.endLedgerIndex)
    && authorization.endLedgerIndex >= authorization.startLedgerIndex
    && isPositiveSafeInteger(authorizedLedgerCount)
    && authorizedLedgerCount <= SUPABASE_REVISION4_FIXED_GUARDS.selectedMaximumLedgersPerClaim
    && isPositiveSafeInteger(authorization.invocationBudget)
    && authorization.invocationBudget < SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d
    && isPositiveSafeInteger(authorization.billableEgressBudgetBytes)
    && authorization.billableEgressBudgetBytes < SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes
    && isPositiveSafeInteger(authorization.memoryBudgetBytes)
    && authorization.memoryBudgetBytes < SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes
    && authorization.claimCapLedgers === SUPABASE_REVISION4_FIXED_GUARDS.selectedMaximumLedgersPerClaim
  if (!proofUnitBounded) addReason(blockingReasons, 'proof_unit_authorization_not_bounded')

  const execution = input.execution
  if (!SHA256_PATTERN.test(execution.evidenceDigest)) {
    addReason(blockingReasons, 'execution_evidence_digest_invalid')
  }
  if (!execution.attempted || !execution.completed) {
    addReason(blockingReasons, 'proof_unit_execution_not_completed')
  }
  const executionMatchesAuthorization =
    execution.proofUnitCount === 1
    && execution.startLedgerIndex === authorization.startLedgerIndex
    && execution.endLedgerIndex === authorization.endLedgerIndex
  if (!executionMatchesAuthorization) {
    addReason(blockingReasons, 'execution_does_not_match_authorization')
  }

  const executionWithinBudgets =
    isPositiveSafeInteger(execution.invocationsUsed)
    && execution.invocationsUsed <= authorization.invocationBudget
    && isNonNegativeSafeInteger(execution.billableEgressUpperBoundBytes)
    && execution.billableEgressUpperBoundBytes <= authorization.billableEgressBudgetBytes
    && isPositiveSafeInteger(execution.maximumPeakMemoryBytes)
    && execution.maximumPeakMemoryBytes <= authorization.memoryBudgetBytes
    && isPositiveSafeInteger(execution.maximumClaimLedgers)
    && execution.maximumClaimLedgers <= authorization.claimCapLedgers
  if (!executionWithinBudgets) addReason(blockingReasons, 'execution_budget_exceeded')

  const ledgerIntegrityProved =
    execution.parentHashContinuityVerified
    && execution.duplicateLedgerCount === 0
    && execution.skippedLedgerCount === 0
    && execution.committedRowsOnly
    && execution.noPartialCommitVisible
  if (!ledgerIntegrityProved) addReason(blockingReasons, 'proof_unit_ledger_integrity_not_proved')

  const oneShotConsumptionProved =
    execution.authorizationConsumedExactlyOnce
    && execution.duplicateExecutionRejected
    && execution.successorNotAuthorized
  if (!oneShotConsumptionProved) addReason(blockingReasons, 'one_shot_consumption_not_proved')

  if (!input.safety.publicReaderUnchanged) addReason(blockingReasons, 'public_reader_changed')
  if (!input.safety.mainnetDisabled) addReason(blockingReasons, 'mainnet_not_disabled')
  if (input.safety.stabilizationAuthorized) addReason(blockingReasons, 'stabilization_authorized')
  if (input.safety.soakAuthorized) addReason(blockingReasons, 'soak_authorized')
  if (input.safety.transactionSubmissionPerformed) {
    addReason(blockingReasons, 'transaction_submission_performed')
  }
  const releaseBoundaryClosed =
    input.safety.publicReaderUnchanged
    && input.safety.mainnetDisabled
    && !input.safety.stabilizationAuthorized
    && !input.safety.soakAuthorized
    && !input.safety.transactionSubmissionPerformed

  const authorizationValid =
    authorization.authorized
    && authorization.issueNumber === SUPABASE_REVISION4_G9_ISSUE_NUMBER
    && authorization.authorizedBy === SUPABASE_REVISION4_G9_OWNER_LOGIN
    && isPositiveSafeInteger(authorization.authorizationCommentId)
    && SHA256_PATTERN.test(authorization.authorizationDigest)
    && authorizationBoundToExactRevision4Source
    && authorizationWindowValid
    && proofUnitBounded

  return {
    schemaVersion: SUPABASE_REVISION4_G9_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    machineSummary: {
      allEightPrerequisitesPassed,
      authorizationValid,
      authorizationBoundToExactRevision4Source,
      authorizationWindowValid,
      proofUnitBounded,
      executionMatchesAuthorization,
      executionWithinBudgets,
      ledgerIntegrityProved,
      oneShotConsumptionProved,
      releaseBoundaryClosed,
    },
  }
}
