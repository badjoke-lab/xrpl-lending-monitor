import {
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

export const SUPABASE_REVISION4_G10_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_G10_RESULT_SCHEMA_VERSION = 1 as const

export const SUPABASE_REVISION4_PRESELECTION_GATE_IDS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G7',
  'G8',
  'G9',
] as const

export type SupabaseRevision4PreselectionGateId =
  (typeof SUPABASE_REVISION4_PRESELECTION_GATE_IDS)[number]
export type SupabaseRevision4GateStatus = 'pass' | 'fail' | 'unresolved'
export type SupabaseRevision4SelectionOutcome =
  | 'not_selected'
  | 'selected'
  | 'rejected'
export type SupabaseRevision4G10EvidenceClass =
  | 'synthetic_test_only'
  | 'formal_selection_decision'

export interface SupabaseRevision4SelectionGateEvidence {
  gateId: SupabaseRevision4PreselectionGateId
  status: SupabaseRevision4GateStatus
  evidenceDigest: string
}

export interface SupabaseRevision4SelectionDecisionInput {
  schemaVersion: typeof SUPABASE_REVISION4_G10_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4G10EvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  evaluatedAt: string
  sourceCommit: string
  gateEvidence: SupabaseRevision4SelectionGateEvidence[]
  convergence: {
    steadyConvergenceProved: boolean
    catchupConvergenceProved: boolean
    boundedProofUnitPassed: boolean
    g5EvidenceDigest: string
    g6EvidenceDigest: string
    g9EvidenceDigest: string
  }
  policy: {
    rollingEgressHaltBytes: number
    invocationHalt: number
    memoryHaltBytes: number
    claimCapLedgers: number
  }
  decision: {
    outcome: SupabaseRevision4SelectionOutcome
    decisionRationaleDigest: string
    rejectedGateIds: SupabaseRevision4PreselectionGateId[]
    nextStep:
      | 'continue_r4f_qualification'
      | 'r5_owner_authorization_required'
      | 'return_to_architecture_selection'
    r5RecoveryMutationAuthorized: boolean
  }
  safety: {
    publicReaderUnchanged: boolean
    mainnetDisabled: boolean
    stabilizationAuthorized: boolean
    soakAuthorized: boolean
    retiredCloudflareCollectorRestarted: boolean
    transactionSubmissionPerformed: boolean
  }
}

export interface SupabaseRevision4SelectionDecisionResult {
  schemaVersion: typeof SUPABASE_REVISION4_G10_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4G10EvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  decisionReady: boolean
  blockingReasons: string[]
  machineSummary: {
    passedGateCount: number
    failedGateCount: number
    unresolvedGateCount: number
    failedGateIds: SupabaseRevision4PreselectionGateId[]
    unresolvedGateIds: SupabaseRevision4PreselectionGateId[]
    allGateEvidenceExactAndUnique: boolean
    convergenceEvidenceConsistent: boolean
    selectionEligible: boolean
    rejectionRequired: boolean
    outcomeConsistent: boolean
    r5RequiresSeparateOwnerAuthorization: boolean
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

function canonicalTimestamp(value: string): boolean {
  return ISO_TIMESTAMP_PATTERN.test(value) && Number.isFinite(Date.parse(value))
}

function sameGateSet(
  actual: readonly SupabaseRevision4PreselectionGateId[],
  expected: readonly SupabaseRevision4PreselectionGateId[],
): boolean {
  if (actual.length !== expected.length) return false
  const left = [...actual].sort()
  const right = [...expected].sort()
  return left.every((gate, index) => gate === right[index])
}

export function verifySupabaseRevision4SelectionDecision(
  input: SupabaseRevision4SelectionDecisionInput,
): SupabaseRevision4SelectionDecisionResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_G10_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'formal_selection_decision') {
    addReason(blockingReasons, 'synthetic_or_nonfinal_decision_not_qualifying')
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
  if (!canonicalTimestamp(input.evaluatedAt)) {
    addReason(blockingReasons, 'evaluated_at_invalid')
  }
  if (!COMMIT_PATTERN.test(input.sourceCommit)) {
    addReason(blockingReasons, 'source_commit_invalid')
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

  const seen = new Set<SupabaseRevision4PreselectionGateId>()
  const statuses = new Map<
    SupabaseRevision4PreselectionGateId,
    SupabaseRevision4GateStatus
  >()
  let allGateEvidenceExactAndUnique =
    input.gateEvidence.length === SUPABASE_REVISION4_PRESELECTION_GATE_IDS.length

  for (const [index, gate] of input.gateEvidence.entries()) {
    if (!SUPABASE_REVISION4_PRESELECTION_GATE_IDS.includes(gate.gateId)) {
      addReason(blockingReasons, `gate_id_invalid:index_${index}`)
      allGateEvidenceExactAndUnique = false
      continue
    }
    if (seen.has(gate.gateId)) {
      addReason(blockingReasons, `gate_evidence_duplicated:${gate.gateId}`)
      allGateEvidenceExactAndUnique = false
    }
    seen.add(gate.gateId)
    statuses.set(gate.gateId, gate.status)
    if (!['pass', 'fail', 'unresolved'].includes(gate.status)) {
      addReason(blockingReasons, `gate_status_invalid:${gate.gateId}`)
      allGateEvidenceExactAndUnique = false
    }
    if (!SHA256_PATTERN.test(gate.evidenceDigest)) {
      addReason(blockingReasons, `gate_evidence_digest_invalid:${gate.gateId}`)
      allGateEvidenceExactAndUnique = false
    }
  }

  for (const gateId of SUPABASE_REVISION4_PRESELECTION_GATE_IDS) {
    if (!seen.has(gateId)) {
      addReason(blockingReasons, `gate_evidence_missing:${gateId}`)
      allGateEvidenceExactAndUnique = false
    }
  }

  const passedGateIds = SUPABASE_REVISION4_PRESELECTION_GATE_IDS.filter(
    (gateId) => statuses.get(gateId) === 'pass',
  )
  const failedGateIds = SUPABASE_REVISION4_PRESELECTION_GATE_IDS.filter(
    (gateId) => statuses.get(gateId) === 'fail',
  )
  const unresolvedGateIds = SUPABASE_REVISION4_PRESELECTION_GATE_IDS.filter(
    (gateId) => statuses.get(gateId) === 'unresolved',
  )

  for (const [name, digest] of [
    ['g5', input.convergence.g5EvidenceDigest],
    ['g6', input.convergence.g6EvidenceDigest],
    ['g9', input.convergence.g9EvidenceDigest],
  ] as const) {
    if (!SHA256_PATTERN.test(digest)) {
      addReason(blockingReasons, `${name}_convergence_evidence_digest_invalid`)
    }
  }

  let convergenceEvidenceConsistent = true
  const convergenceBindings = [
    ['G5', input.convergence.steadyConvergenceProved, 'steady'],
    ['G6', input.convergence.catchupConvergenceProved, 'catchup'],
    ['G9', input.convergence.boundedProofUnitPassed, 'bounded_proof_unit'],
  ] as const
  for (const [gateId, proved, label] of convergenceBindings) {
    const status = statuses.get(gateId)
    if ((status === 'pass') !== proved) {
      addReason(blockingReasons, `${label}_status_inconsistent`)
      convergenceEvidenceConsistent = false
    }
  }

  const selectionEligible =
    allGateEvidenceExactAndUnique
    && passedGateIds.length === SUPABASE_REVISION4_PRESELECTION_GATE_IDS.length
    && failedGateIds.length === 0
    && unresolvedGateIds.length === 0
    && input.convergence.steadyConvergenceProved
    && input.convergence.catchupConvergenceProved
    && input.convergence.boundedProofUnitPassed
    && convergenceEvidenceConsistent

  const rejectionRequired = failedGateIds.length > 0 && unresolvedGateIds.length === 0
  const qualificationStillOpen = unresolvedGateIds.length > 0
  let outcomeConsistent = false
  let decisionReady = false

  if (input.decision.outcome === 'selected') {
    outcomeConsistent =
      selectionEligible
      && input.decision.rejectedGateIds.length === 0
      && input.decision.nextStep === 'r5_owner_authorization_required'
    decisionReady = outcomeConsistent
    if (!selectionEligible) addReason(blockingReasons, 'selection_without_all_hard_gates')
    if (input.decision.rejectedGateIds.length !== 0) {
      addReason(blockingReasons, 'selected_decision_has_rejected_gates')
    }
    if (input.decision.nextStep !== 'r5_owner_authorization_required') {
      addReason(blockingReasons, 'selected_decision_next_step_invalid')
    }
  } else if (input.decision.outcome === 'rejected') {
    outcomeConsistent =
      rejectionRequired
      && sameGateSet(input.decision.rejectedGateIds, failedGateIds)
      && input.decision.nextStep === 'return_to_architecture_selection'
    decisionReady = outcomeConsistent
    if (!rejectionRequired) addReason(blockingReasons, 'rejection_without_terminal_failed_gate')
    if (!sameGateSet(input.decision.rejectedGateIds, failedGateIds)) {
      addReason(blockingReasons, 'rejected_gate_set_mismatch')
    }
    if (input.decision.nextStep !== 'return_to_architecture_selection') {
      addReason(blockingReasons, 'rejected_decision_next_step_invalid')
    }
  } else {
    outcomeConsistent =
      qualificationStillOpen
      && input.decision.rejectedGateIds.length === 0
      && input.decision.nextStep === 'continue_r4f_qualification'
    if (!qualificationStillOpen) {
      addReason(blockingReasons, 'not_selected_without_unresolved_gate')
    }
    if (input.decision.rejectedGateIds.length !== 0) {
      addReason(blockingReasons, 'not_selected_has_rejected_gates')
    }
    if (input.decision.nextStep !== 'continue_r4f_qualification') {
      addReason(blockingReasons, 'not_selected_next_step_invalid')
    }
    addReason(blockingReasons, 'qualification_still_unresolved')
  }

  if (!SHA256_PATTERN.test(input.decision.decisionRationaleDigest)) {
    addReason(blockingReasons, 'decision_rationale_digest_invalid')
  }
  if (input.decision.r5RecoveryMutationAuthorized) {
    addReason(blockingReasons, 'g10_cannot_authorize_r5_mutation')
  }

  if (!input.safety.publicReaderUnchanged) addReason(blockingReasons, 'public_reader_changed')
  if (!input.safety.mainnetDisabled) addReason(blockingReasons, 'mainnet_not_disabled')
  if (input.safety.stabilizationAuthorized) addReason(blockingReasons, 'stabilization_authorized')
  if (input.safety.soakAuthorized) addReason(blockingReasons, 'soak_authorized')
  if (input.safety.retiredCloudflareCollectorRestarted) {
    addReason(blockingReasons, 'retired_cloudflare_collector_restarted')
  }
  if (input.safety.transactionSubmissionPerformed) {
    addReason(blockingReasons, 'transaction_submission_performed')
  }

  const releaseBoundaryClosed =
    input.safety.publicReaderUnchanged
    && input.safety.mainnetDisabled
    && !input.safety.stabilizationAuthorized
    && !input.safety.soakAuthorized
    && !input.safety.retiredCloudflareCollectorRestarted
    && !input.safety.transactionSubmissionPerformed
    && !input.decision.r5RecoveryMutationAuthorized

  const r5RequiresSeparateOwnerAuthorization =
    input.decision.r5RecoveryMutationAuthorized === false
    && (input.decision.outcome !== 'selected'
      || input.decision.nextStep === 'r5_owner_authorization_required')

  return {
    schemaVersion: SUPABASE_REVISION4_G10_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: decisionReady && blockingReasons.length === 0,
    decisionReady,
    blockingReasons,
    machineSummary: {
      passedGateCount: passedGateIds.length,
      failedGateCount: failedGateIds.length,
      unresolvedGateCount: unresolvedGateIds.length,
      failedGateIds,
      unresolvedGateIds,
      allGateEvidenceExactAndUnique,
      convergenceEvidenceConsistent,
      selectionEligible,
      rejectionRequired,
      outcomeConsistent,
      r5RequiresSeparateOwnerAuthorization,
      releaseBoundaryClosed,
    },
  }
}
