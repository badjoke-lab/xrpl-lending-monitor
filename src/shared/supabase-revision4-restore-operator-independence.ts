import {
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export const SUPABASE_REVISION4_G8_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_G8_RESULT_SCHEMA_VERSION = 1 as const

export type SupabaseRevision4G8EvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_restore_operator_reproof'

export interface SupabaseRevision4BoundProofIdentity {
  evidenceDigest: string
  sourceCommit: string
  profileRevision: number
  profileIdentityDigest: string
}

export interface SupabaseRevision4RestoreOperatorInput {
  schemaVersion: typeof SUPABASE_REVISION4_G8_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4G8EvidenceClass
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
    g7FailureAccountingPassed: boolean
    providerCaptureDigest: string
    g4MemoryEvidenceDigest: string
    g5SteadyEvidenceDigest: string
    g6CatchupEvidenceDigest: string
    g7FailureEvidenceDigest: string
  }
  policy: {
    rollingEgressHaltBytes: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
  }
  exportRestore: SupabaseRevision4BoundProofIdentity & {
    collectionStateIncluded: boolean
    schedulerStateIncluded: boolean
    publicationStateIncluded: boolean
    maintenanceStateIncluded: boolean
    emptyTargetRestoreObserved: boolean
    canonicalTextParity: boolean
    digestParity: boolean
    duplicateRestoreConverged: boolean
    digestTamperRejected: boolean
    activeProfileIsolated: boolean
  }
  continuation: SupabaseRevision4BoundProofIdentity & {
    watermarkAdvancedExactlyOne: boolean
    watermarkMatchesDurableSource: boolean
    workCommitted: boolean
    committedRowsOnly: boolean
    rowCountParity: boolean
    rowDigestParity: boolean
    sourceReboundExplicitly: boolean
    duplicatePhaseReplayConverged: boolean
    activeProfileIsolated: boolean
  }
  credentialRotation: SupabaseRevision4BoundProofIdentity & {
    readerTokenRotatedExactlyOnce: boolean
    recoveryTokenRotatedExactlyOnce: boolean
    exactlyTwoTokensGenerated: boolean
    readerTokenMasked: boolean
    recoveryTokenMasked: boolean
    tokensScopedToExactProject: boolean
    oldTokensRejectedAfterRotation: boolean
    credentialMaterialRetained: boolean
  }
  rollback: SupabaseRevision4BoundProofIdentity & {
    interruptionRollbackProved: boolean
    noPartialCommitVisible: boolean
    failedAttemptAccountingRetained: boolean
    retryConvergedAfterRollback: boolean
  }
  halt: SupabaseRevision4BoundProofIdentity & {
    terminalFailClosedHaltProved: boolean
    noSuccessorAfterHalt: boolean
    haltedStateDurable: boolean
    failedAttemptAccountingRetained: boolean
  }
  evidencePublication: SupabaseRevision4BoundProofIdentity & {
    sanitizedArtifactUploaded: boolean
    issueLocatorPublished: boolean
    successPathPublished: boolean
    failurePathPublished: boolean
    secretMaterialAbsent: boolean
    artifactPublicationAutomatic: boolean
  }
  operatorIndependence: SupabaseRevision4BoundProofIdentity & {
    singleGuardedWorkflow: boolean
    noRoutineDashboardStep: boolean
    noScheduledCollectionWorkflow: boolean
    exactScriptedDeploymentSet: boolean
    migrationApplicationScripted: boolean
    credentialRotationScripted: boolean
    exportRestoreScripted: boolean
    continuationScripted: boolean
    rollbackScripted: boolean
    haltScripted: boolean
    evidencePublicationScripted: boolean
  }
  safety: {
    recoveryMutationCommitted: boolean
    transactionSubmissionPerformed: boolean
    publicReaderUnchanged: boolean
    mainnetDisabled: boolean
    stabilizationAuthorized: boolean
    soakAuthorized: boolean
  }
}

export interface SupabaseRevision4RestoreOperatorResult {
  schemaVersion: typeof SUPABASE_REVISION4_G8_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4G8EvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  machineSummary: {
    boundProofCount: number
    allProofsBoundToRevision4Identity: boolean
    completeStateTransferProved: boolean
    postRestoreContinuationProved: boolean
    credentialRotationProved: boolean
    rollbackProved: boolean
    terminalHaltProved: boolean
    evidencePublicationProved: boolean
    operatorIndependenceProved: boolean
    releaseBoundaryClosed: boolean
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,159}$/u
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key)/iu
const SECRET_VALUE_PATTERN = /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/u

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason)
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

function allTrue(values: readonly boolean[]): boolean {
  return values.every((value) => value === true)
}

function verifyBoundProof(
  proof: SupabaseRevision4BoundProofIdentity,
  name: string,
  reasons: string[],
): boolean {
  let valid = true
  if (!SHA256_PATTERN.test(proof.evidenceDigest)) {
    addReason(reasons, `${name}_evidence_digest_invalid`)
    valid = false
  }
  if (!COMMIT_PATTERN.test(proof.sourceCommit)) {
    addReason(reasons, `${name}_source_commit_invalid`)
    valid = false
  }
  if (proof.profileRevision !== SUPABASE_REVISION4_PROFILE.revision) {
    addReason(reasons, `${name}_profile_revision_mismatch`)
    valid = false
  }
  if (proof.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST) {
    addReason(reasons, `${name}_profile_identity_digest_mismatch`)
    valid = false
  }
  return valid
}

export function verifySupabaseRevision4RestoreOperatorIndependence(
  input: SupabaseRevision4RestoreOperatorInput,
): SupabaseRevision4RestoreOperatorResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_G8_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_restore_operator_reproof') {
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

  for (const [name, passed] of [
    ['g3_provider_reconciliation', input.prerequisites.g3ProviderReconciliationPassed],
    ['g4_memory_requalification', input.prerequisites.g4MemoryRequalificationPassed],
    ['g5_steady_convergence', input.prerequisites.g5SteadyConvergencePassed],
    ['g6_catchup_convergence', input.prerequisites.g6CatchupConvergencePassed],
    ['g7_failure_accounting', input.prerequisites.g7FailureAccountingPassed],
  ] as const) {
    if (!passed) addReason(blockingReasons, `${name}_not_passed`)
  }

  for (const [name, digest] of [
    ['provider_capture', input.prerequisites.providerCaptureDigest],
    ['g4_memory_evidence', input.prerequisites.g4MemoryEvidenceDigest],
    ['g5_steady_evidence', input.prerequisites.g5SteadyEvidenceDigest],
    ['g6_catchup_evidence', input.prerequisites.g6CatchupEvidenceDigest],
    ['g7_failure_evidence', input.prerequisites.g7FailureEvidenceDigest],
  ] as const) {
    if (!SHA256_PATTERN.test(digest)) addReason(blockingReasons, `${name}_digest_invalid`)
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

  const boundProofs = [
    ['export_restore', input.exportRestore],
    ['continuation', input.continuation],
    ['credential_rotation', input.credentialRotation],
    ['rollback', input.rollback],
    ['halt', input.halt],
    ['evidence_publication', input.evidencePublication],
    ['operator_independence', input.operatorIndependence],
  ] as const
  const allProofsBoundToRevision4Identity = boundProofs.every(([name, proof]) =>
    verifyBoundProof(proof, name, blockingReasons),
  )

  const completeStateTransferProved = allTrue([
    input.exportRestore.collectionStateIncluded,
    input.exportRestore.schedulerStateIncluded,
    input.exportRestore.publicationStateIncluded,
    input.exportRestore.maintenanceStateIncluded,
    input.exportRestore.emptyTargetRestoreObserved,
    input.exportRestore.canonicalTextParity,
    input.exportRestore.digestParity,
    input.exportRestore.duplicateRestoreConverged,
    input.exportRestore.digestTamperRejected,
    input.exportRestore.activeProfileIsolated,
  ])
  if (!completeStateTransferProved) {
    addReason(blockingReasons, 'complete_state_transfer_not_proved')
  }

  const postRestoreContinuationProved = allTrue([
    input.continuation.watermarkAdvancedExactlyOne,
    input.continuation.watermarkMatchesDurableSource,
    input.continuation.workCommitted,
    input.continuation.committedRowsOnly,
    input.continuation.rowCountParity,
    input.continuation.rowDigestParity,
    input.continuation.sourceReboundExplicitly,
    input.continuation.duplicatePhaseReplayConverged,
    input.continuation.activeProfileIsolated,
  ])
  if (!postRestoreContinuationProved) {
    addReason(blockingReasons, 'post_restore_continuation_not_proved')
  }

  const credentialRotationProved = allTrue([
    input.credentialRotation.readerTokenRotatedExactlyOnce,
    input.credentialRotation.recoveryTokenRotatedExactlyOnce,
    input.credentialRotation.exactlyTwoTokensGenerated,
    input.credentialRotation.readerTokenMasked,
    input.credentialRotation.recoveryTokenMasked,
    input.credentialRotation.tokensScopedToExactProject,
    input.credentialRotation.oldTokensRejectedAfterRotation,
    input.credentialRotation.credentialMaterialRetained === false,
  ])
  if (!credentialRotationProved) {
    addReason(blockingReasons, 'credential_rotation_not_proved')
  }

  const rollbackProved = allTrue([
    input.rollback.interruptionRollbackProved,
    input.rollback.noPartialCommitVisible,
    input.rollback.failedAttemptAccountingRetained,
    input.rollback.retryConvergedAfterRollback,
  ])
  if (!rollbackProved) addReason(blockingReasons, 'rollback_not_proved')

  const terminalHaltProved = allTrue([
    input.halt.terminalFailClosedHaltProved,
    input.halt.noSuccessorAfterHalt,
    input.halt.haltedStateDurable,
    input.halt.failedAttemptAccountingRetained,
  ])
  if (!terminalHaltProved) addReason(blockingReasons, 'terminal_halt_not_proved')

  const evidencePublicationProved = allTrue([
    input.evidencePublication.sanitizedArtifactUploaded,
    input.evidencePublication.issueLocatorPublished,
    input.evidencePublication.successPathPublished,
    input.evidencePublication.failurePathPublished,
    input.evidencePublication.secretMaterialAbsent,
    input.evidencePublication.artifactPublicationAutomatic,
  ])
  if (!evidencePublicationProved) {
    addReason(blockingReasons, 'evidence_publication_not_proved')
  }

  const operatorIndependenceProved = allTrue([
    input.operatorIndependence.singleGuardedWorkflow,
    input.operatorIndependence.noRoutineDashboardStep,
    input.operatorIndependence.noScheduledCollectionWorkflow,
    input.operatorIndependence.exactScriptedDeploymentSet,
    input.operatorIndependence.migrationApplicationScripted,
    input.operatorIndependence.credentialRotationScripted,
    input.operatorIndependence.exportRestoreScripted,
    input.operatorIndependence.continuationScripted,
    input.operatorIndependence.rollbackScripted,
    input.operatorIndependence.haltScripted,
    input.operatorIndependence.evidencePublicationScripted,
  ])
  if (!operatorIndependenceProved) {
    addReason(blockingReasons, 'operator_independence_not_proved')
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

  const releaseBoundaryClosed =
    input.safety.recoveryMutationCommitted === false
    && input.safety.transactionSubmissionPerformed === false
    && input.safety.publicReaderUnchanged === true
    && input.safety.mainnetDisabled === true
    && input.safety.stabilizationAuthorized === false
    && input.safety.soakAuthorized === false

  return {
    schemaVersion: SUPABASE_REVISION4_G8_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    machineSummary: {
      boundProofCount: boundProofs.length,
      allProofsBoundToRevision4Identity,
      completeStateTransferProved,
      postRestoreContinuationProved,
      credentialRotationProved,
      rollbackProved,
      terminalHaltProved,
      evidencePublicationProved,
      operatorIndependenceProved,
      releaseBoundaryClosed,
    },
  }
}
