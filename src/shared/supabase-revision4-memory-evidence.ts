export const SUPABASE_REVISION4_MEMORY_EVIDENCE_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_MEMORY_EVIDENCE_RESULT_SCHEMA_VERSION = 1 as const
export const SUPABASE_REVISION4_MEMORY_HALT_BYTES = 224 * 1024 * 1024
export const SUPABASE_REVISION4_CLAIM_CAP_LEDGERS = 12
export const SUPABASE_REVISION4_PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
export const SUPABASE_REVISION4_PROFILE_REVISION = 4
export const SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'

export type SupabaseRevision4MemoryEvidenceClass =
  | 'synthetic_test_only'
  | 'bounded_offline_replay'

export type SupabaseRevision4MemorySampleShape =
  | 'exact_12_ledger_halt_shape'
  | 'heavier_retained_sample'

export interface SupabaseRevision4MemoryEvidenceInput {
  schemaVersion: typeof SUPABASE_REVISION4_MEMORY_EVIDENCE_SCHEMA_VERSION
  evidenceClass: SupabaseRevision4MemoryEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  evidenceId: string
  capturedAt: string
  authorization: {
    issueNumber: number
    commentId: number | null
    actor: string
    scope: 'r4f_g4_memory_replay'
  }
  policy: {
    memoryMetric: 'process_rss_bytes'
    memoryHaltBytes: number
    claimCapLedgers: number
  }
  samples: SupabaseRevision4MemorySampleInput[]
  artifacts: {
    harnessSha256: string
    environmentSha256: string
    outputSha256: string
    sourceCommit: string
  }
  safety: {
    productionCredentialsUsed: boolean
    productionMutationPerformed: boolean
    recoveryMutationCommitted: boolean
    publicReaderUnchanged: boolean
    mainnetDisabled: boolean
    stabilizationAuthorized: boolean
    soakAuthorized: boolean
  }
}

export interface SupabaseRevision4MemorySampleInput {
  sampleId: string
  shape: SupabaseRevision4MemorySampleShape
  backgroundRecovery: boolean
  ledgersClaimed: number
  retainedLedgerCount: number
  baselineMemoryBytes: number
  peakMemoryBytes: number
  completedWithoutMemoryHalt: boolean
  claimCapOverrideUsed: boolean
  traceSha256: string
  diagnosticsSha256: string
}

export interface SupabaseRevision4MemorySampleResult
  extends SupabaseRevision4MemorySampleInput {
  peakAboveBaselineBytes: number
  headroomBytes: number
  strictlyBelowMemoryHalt: boolean
}

export interface SupabaseRevision4MemoryEvidenceResult {
  schemaVersion: typeof SUPABASE_REVISION4_MEMORY_EVIDENCE_RESULT_SCHEMA_VERSION
  evidenceId: string
  evidenceClass: SupabaseRevision4MemoryEvidenceClass
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  proofReady: boolean
  blockingReasons: string[]
  samples: SupabaseRevision4MemorySampleResult[]
  machineSummary: {
    memoryMetric: 'process_rss_bytes'
    memoryHaltBytes: number
    claimCapLedgers: number
    requiredShapesPresent: boolean
    exact12LedgerShapeCount: number
    heavierRetainedShapeCount: number
    minimumHeadroomBytes: number | null
    maximumPeakMemoryBytes: number | null
  }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const COMMIT_PATTERN = /^[0-9a-f]{40}$/
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const SECRET_KEY_PATTERN =
  /(?:password|private[_-]?key|service[_-]?role|access[_-]?token|refresh[_-]?token|api[_-]?key)/i
const SECRET_VALUE_PATTERN = /(?:sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,})/

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason)
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
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

function validateSample(
  sample: SupabaseRevision4MemorySampleInput,
  memoryHaltBytes: number,
  claimCapLedgers: number,
  reasons: string[],
): SupabaseRevision4MemorySampleResult {
  if (sample.sampleId.trim().length === 0) {
    addReason(reasons, 'sample_id_missing')
  }
  if (!sample.backgroundRecovery) {
    addReason(reasons, `sample_not_background_recovery:${sample.sampleId}`)
  }
  if (!isPositiveSafeInteger(sample.ledgersClaimed)) {
    addReason(reasons, `sample_ledgers_claimed_invalid:${sample.sampleId}`)
  } else if (sample.ledgersClaimed > claimCapLedgers) {
    addReason(reasons, `sample_claim_cap_exceeded:${sample.sampleId}`)
  }
  if (!isPositiveSafeInteger(sample.retainedLedgerCount)) {
    addReason(reasons, `sample_retained_ledger_count_invalid:${sample.sampleId}`)
  }
  if (!Number.isSafeInteger(sample.baselineMemoryBytes) || sample.baselineMemoryBytes < 0) {
    addReason(reasons, `sample_baseline_memory_invalid:${sample.sampleId}`)
  }
  if (!isPositiveSafeInteger(sample.peakMemoryBytes)) {
    addReason(reasons, `sample_peak_memory_invalid:${sample.sampleId}`)
  }
  if (sample.peakMemoryBytes < sample.baselineMemoryBytes) {
    addReason(reasons, `sample_peak_below_baseline:${sample.sampleId}`)
  }
  if (sample.peakMemoryBytes >= memoryHaltBytes) {
    addReason(reasons, `sample_not_strictly_below_memory_halt:${sample.sampleId}`)
  }
  if (!sample.completedWithoutMemoryHalt) {
    addReason(reasons, `sample_memory_halt_recurred:${sample.sampleId}`)
  }
  if (sample.claimCapOverrideUsed) {
    addReason(reasons, `sample_claim_cap_override_used:${sample.sampleId}`)
  }
  if (!SHA256_PATTERN.test(sample.traceSha256)) {
    addReason(reasons, `sample_trace_digest_invalid:${sample.sampleId}`)
  }
  if (!SHA256_PATTERN.test(sample.diagnosticsSha256)) {
    addReason(reasons, `sample_diagnostics_digest_invalid:${sample.sampleId}`)
  }

  return {
    ...sample,
    peakAboveBaselineBytes: sample.peakMemoryBytes - sample.baselineMemoryBytes,
    headroomBytes: memoryHaltBytes - sample.peakMemoryBytes,
    strictlyBelowMemoryHalt: sample.peakMemoryBytes < memoryHaltBytes,
  }
}

export function verifySupabaseRevision4MemoryEvidence(
  input: SupabaseRevision4MemoryEvidenceInput,
): SupabaseRevision4MemoryEvidenceResult {
  const blockingReasons: string[] = []

  if (input.schemaVersion !== SUPABASE_REVISION4_MEMORY_EVIDENCE_SCHEMA_VERSION) {
    addReason(blockingReasons, 'schema_version_mismatch')
  }
  if (input.evidenceClass !== 'bounded_offline_replay') {
    addReason(blockingReasons, 'synthetic_or_unbounded_evidence_not_qualifying')
  }
  if (input.profileId !== SUPABASE_REVISION4_PROFILE_ID) {
    addReason(blockingReasons, 'profile_id_mismatch')
  }
  if (input.profileRevision !== SUPABASE_REVISION4_PROFILE_REVISION) {
    addReason(blockingReasons, 'profile_revision_mismatch')
  }
  if (input.profileIdentityDigest !== SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST) {
    addReason(blockingReasons, 'profile_identity_digest_mismatch')
  }
  if (input.evidenceId.trim().length === 0) {
    addReason(blockingReasons, 'evidence_id_missing')
  }
  if (!ISO_TIMESTAMP_PATTERN.test(input.capturedAt)) {
    addReason(blockingReasons, 'captured_at_invalid')
  }
  if (input.authorization.issueNumber !== 1261) {
    addReason(blockingReasons, 'authorization_issue_mismatch')
  }
  if (!isPositiveSafeInteger(input.authorization.commentId ?? 0)) {
    addReason(blockingReasons, 'authorization_comment_missing')
  }
  if (input.authorization.actor.trim().length === 0) {
    addReason(blockingReasons, 'authorization_actor_missing')
  }
  if (input.authorization.scope !== 'r4f_g4_memory_replay') {
    addReason(blockingReasons, 'authorization_scope_mismatch')
  }
  if (input.policy.memoryMetric !== 'process_rss_bytes') {
    addReason(blockingReasons, 'memory_metric_mismatch')
  }
  if (input.policy.memoryHaltBytes !== SUPABASE_REVISION4_MEMORY_HALT_BYTES) {
    addReason(blockingReasons, 'memory_halt_guard_changed')
  }
  if (input.policy.claimCapLedgers !== SUPABASE_REVISION4_CLAIM_CAP_LEDGERS) {
    addReason(blockingReasons, 'claim_cap_changed')
  }
  if (containsSecret(input)) {
    addReason(blockingReasons, 'secret_material_present')
  }

  const samples = input.samples.map((sample) =>
    validateSample(
      sample,
      input.policy.memoryHaltBytes,
      input.policy.claimCapLedgers,
      blockingReasons,
    ),
  )
  const exactSamples = samples.filter(
    (sample) => sample.shape === 'exact_12_ledger_halt_shape',
  )
  const heavierSamples = samples.filter(
    (sample) => sample.shape === 'heavier_retained_sample',
  )
  const requiredShapesPresent = exactSamples.length === 1 && heavierSamples.length === 1

  if (exactSamples.length !== 1) {
    addReason(blockingReasons, 'exact_12_ledger_halt_shape_count_invalid')
  }
  if (heavierSamples.length !== 1) {
    addReason(blockingReasons, 'heavier_retained_sample_count_invalid')
  }
  const exactSample = exactSamples[0]
  const heavierSample = heavierSamples[0]
  if (exactSample && exactSample.ledgersClaimed !== SUPABASE_REVISION4_CLAIM_CAP_LEDGERS) {
    addReason(blockingReasons, 'exact_halt_shape_not_12_ledgers')
  }
  if (
    exactSample &&
    heavierSample &&
    heavierSample.retainedLedgerCount <= exactSample.retainedLedgerCount
  ) {
    addReason(blockingReasons, 'heavier_sample_not_more_retained')
  }

  if (!SHA256_PATTERN.test(input.artifacts.harnessSha256)) {
    addReason(blockingReasons, 'harness_digest_invalid')
  }
  if (!SHA256_PATTERN.test(input.artifacts.environmentSha256)) {
    addReason(blockingReasons, 'environment_digest_invalid')
  }
  if (!SHA256_PATTERN.test(input.artifacts.outputSha256)) {
    addReason(blockingReasons, 'output_digest_invalid')
  }
  if (!COMMIT_PATTERN.test(input.artifacts.sourceCommit)) {
    addReason(blockingReasons, 'source_commit_invalid')
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

  const headrooms = samples.map((sample) => sample.headroomBytes)
  const peaks = samples.map((sample) => sample.peakMemoryBytes)

  return {
    schemaVersion: SUPABASE_REVISION4_MEMORY_EVIDENCE_RESULT_SCHEMA_VERSION,
    evidenceId: input.evidenceId,
    evidenceClass: input.evidenceClass,
    profileId: input.profileId,
    profileRevision: input.profileRevision,
    profileIdentityDigest: input.profileIdentityDigest,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
    samples,
    machineSummary: {
      memoryMetric: input.policy.memoryMetric,
      memoryHaltBytes: input.policy.memoryHaltBytes,
      claimCapLedgers: input.policy.claimCapLedgers,
      requiredShapesPresent,
      exact12LedgerShapeCount: exactSamples.length,
      heavierRetainedShapeCount: heavierSamples.length,
      minimumHeadroomBytes: headrooms.length > 0 ? Math.min(...headrooms) : null,
      maximumPeakMemoryBytes: peaks.length > 0 ? Math.max(...peaks) : null,
    },
  }
}
