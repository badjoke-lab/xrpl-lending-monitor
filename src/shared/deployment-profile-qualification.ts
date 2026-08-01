import { canonicalPortableJson } from './portable-collector-reference-store'

export const DEPLOYMENT_PROFILE_HARD_GATE_IDS = [
  'G1',
  'G2',
  'G3',
  'G4',
  'G5',
  'G6',
  'G7',
  'G8',
  'G9',
  'G10',
] as const

export const DEPLOYMENT_PROFILE_SCORE_DIMENSIONS = [
  'cost_safety_headroom',
  'scheduler_durability',
  'transaction_fidelity',
  'resource_headroom',
  'complete_state_portability',
  'observability_evidence',
  'deployment_rollback_automation',
  'operator_independence',
  'public_read_integration_safety',
  'maintenance_burden',
] as const

export type DeploymentProfileHardGateId =
  (typeof DEPLOYMENT_PROFILE_HARD_GATE_IDS)[number]
export type DeploymentProfileScoreDimension =
  (typeof DEPLOYMENT_PROFILE_SCORE_DIMENSIONS)[number]
export type DeploymentProfileGateStatus = 'pass' | 'fail' | 'unresolved'

export interface DeploymentProfileIdentityV1 {
  schemaVersion: 1
  profileId: string
  revision: number
  label: string
  components: {
    storage: string
    scheduler: string
    execution: string
    publication: string
    maintenance: string
    completeStateTransfer: string
  }
}

export interface DeploymentProfileGateEvidenceV1 {
  schemaVersion: 1
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  gateId: DeploymentProfileHardGateId
  status: DeploymentProfileGateStatus
  sourceType:
    | 'official_documentation'
    | 'local_conformance'
    | 'read_only_shadow'
    | 'account_verification'
    | 'operator_constraint'
  summary: string
  observedAt: string
  artifacts: string[]
}

export interface DeploymentProfileScoreV1 {
  dimension: DeploymentProfileScoreDimension
  score: number
  summary: string
}

export interface DeploymentProfileScorecardV1 {
  schemaVersion: 1
  profileIdentityDigest: string
  scores: DeploymentProfileScoreV1[]
}

export interface DeploymentProfileQualificationInputV1 {
  schemaVersion: 1
  evaluatedAt: string
  profile: DeploymentProfileIdentityV1
  profileIdentityDigest: string
  gateEvidence: DeploymentProfileGateEvidenceV1[]
  scorecard: DeploymentProfileScorecardV1 | null
}

export interface DeploymentProfileQualificationDecisionV1 {
  schemaVersion: 1
  decisionDigest: string
  evaluatedAt: string
  profile: DeploymentProfileIdentityV1
  profileIdentityDigest: string
  classification: 'rejected' | 'conditional_candidate' | 'qualified_candidate'
  selection: 'not_selected'
  eligibleForScoring: boolean
  gateSummary: {
    passed: number
    failed: number
    unresolved: number
  }
  failedGates: DeploymentProfileHardGateId[]
  unresolvedGates: DeploymentProfileHardGateId[]
  evidence: DeploymentProfileGateEvidenceV1[]
  scoreSummary: {
    total: number
    maximum: 50
    average: number
    scores: DeploymentProfileScoreV1[]
  } | null
}

export class DeploymentProfileQualificationError extends Error {
  constructor(
    readonly code:
      | 'invalid_input'
      | 'unsupported_version'
      | 'identity_mismatch'
      | 'gate_evidence_mismatch'
      | 'scoring_not_allowed'
      | 'scorecard_mismatch',
    message: string,
  ) {
    super(message)
    this.name = 'DeploymentProfileQualificationError'
  }
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  name: string,
): void {
  const actual = Object.keys(value).sort()
  const required = [...expected].sort()
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} contains unexpected or missing fields`,
    )
  }
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be an object`,
    )
  }
  return value as Record<string, unknown>
}

function arrayValue(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be an array`,
    )
  }
  return value
}

function stringValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be a non-empty string`,
    )
  }
  return value.trim()
}

function integerValue(value: unknown, name: string, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be a safe integer greater than or equal to ${minimum}`,
    )
  }
  return value
}

function timestampValue(value: unknown, name: string): string {
  const timestamp = stringValue(value, name)
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be a canonical ISO timestamp`,
    )
  }
  return timestamp
}

function digestValue(value: unknown, name: string): string {
  const digest = stringValue(value, name).toLowerCase()
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} must be a lowercase SHA-256 digest`,
    )
  }
  return digest
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      `${name} contains an unsupported value`,
    )
  }
  return value as T
}

function parseProfileIdentity(value: unknown): DeploymentProfileIdentityV1 {
  const profile = objectValue(value, 'profile')
  exactKeys(
    profile,
    ['schemaVersion', 'profileId', 'revision', 'label', 'components'],
    'profile',
  )
  if (profile.schemaVersion !== 1) {
    throw new DeploymentProfileQualificationError(
      'unsupported_version',
      'unsupported deployment profile identity version',
    )
  }
  const profileId = stringValue(profile.profileId, 'profile.profileId')
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u.test(profileId)) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      'profile.profileId must be a stable lowercase identifier',
    )
  }
  const components = objectValue(profile.components, 'profile.components')
  exactKeys(
    components,
    [
      'storage',
      'scheduler',
      'execution',
      'publication',
      'maintenance',
      'completeStateTransfer',
    ],
    'profile.components',
  )
  return {
    schemaVersion: 1,
    profileId,
    revision: integerValue(profile.revision, 'profile.revision', 1),
    label: stringValue(profile.label, 'profile.label'),
    components: {
      storage: stringValue(components.storage, 'profile.components.storage'),
      scheduler: stringValue(components.scheduler, 'profile.components.scheduler'),
      execution: stringValue(components.execution, 'profile.components.execution'),
      publication: stringValue(components.publication, 'profile.components.publication'),
      maintenance: stringValue(components.maintenance, 'profile.components.maintenance'),
      completeStateTransfer: stringValue(
        components.completeStateTransfer,
        'profile.components.completeStateTransfer',
      ),
    },
  }
}

function parseGateEvidence(value: unknown): DeploymentProfileGateEvidenceV1 {
  const evidence = objectValue(value, 'gateEvidence entry')
  exactKeys(
    evidence,
    [
      'schemaVersion',
      'profileId',
      'profileRevision',
      'profileIdentityDigest',
      'gateId',
      'status',
      'sourceType',
      'summary',
      'observedAt',
      'artifacts',
    ],
    'gateEvidence entry',
  )
  if (evidence.schemaVersion !== 1) {
    throw new DeploymentProfileQualificationError(
      'unsupported_version',
      'unsupported gate evidence version',
    )
  }
  const artifacts = arrayValue(evidence.artifacts, 'gateEvidence.artifacts').map(
    (artifact, index) => stringValue(artifact, `gateEvidence.artifacts[${index}]`),
  )
  if (new Set(artifacts).size !== artifacts.length) {
    throw new DeploymentProfileQualificationError(
      'invalid_input',
      'gateEvidence.artifacts must not contain duplicates',
    )
  }
  return {
    schemaVersion: 1,
    profileId: stringValue(evidence.profileId, 'gateEvidence.profileId'),
    profileRevision: integerValue(
      evidence.profileRevision,
      'gateEvidence.profileRevision',
      1,
    ),
    profileIdentityDigest: digestValue(
      evidence.profileIdentityDigest,
      'gateEvidence.profileIdentityDigest',
    ),
    gateId: oneOf(
      evidence.gateId,
      DEPLOYMENT_PROFILE_HARD_GATE_IDS,
      'gateEvidence.gateId',
    ),
    status: oneOf(
      evidence.status,
      ['pass', 'fail', 'unresolved'] as const,
      'gateEvidence.status',
    ),
    sourceType: oneOf(
      evidence.sourceType,
      [
        'official_documentation',
        'local_conformance',
        'read_only_shadow',
        'account_verification',
        'operator_constraint',
      ] as const,
      'gateEvidence.sourceType',
    ),
    summary: stringValue(evidence.summary, 'gateEvidence.summary'),
    observedAt: timestampValue(evidence.observedAt, 'gateEvidence.observedAt'),
    artifacts,
  }
}

function parseScorecard(value: unknown): DeploymentProfileScorecardV1 | null {
  if (value === null) return null
  const scorecard = objectValue(value, 'scorecard')
  exactKeys(
    scorecard,
    ['schemaVersion', 'profileIdentityDigest', 'scores'],
    'scorecard',
  )
  if (scorecard.schemaVersion !== 1) {
    throw new DeploymentProfileQualificationError(
      'unsupported_version',
      'unsupported scorecard version',
    )
  }
  const scores = arrayValue(scorecard.scores, 'scorecard.scores').map(
    (entry, index): DeploymentProfileScoreV1 => {
      const score = objectValue(entry, `scorecard.scores[${index}]`)
      exactKeys(score, ['dimension', 'score', 'summary'], 'scorecard score')
      const numericScore = integerValue(
        score.score,
        `scorecard.scores[${index}].score`,
      )
      if (numericScore > 5) {
        throw new DeploymentProfileQualificationError(
          'invalid_input',
          'scorecard scores must be between 0 and 5',
        )
      }
      return {
        dimension: oneOf(
          score.dimension,
          DEPLOYMENT_PROFILE_SCORE_DIMENSIONS,
          `scorecard.scores[${index}].dimension`,
        ),
        score: numericScore,
        summary: stringValue(
          score.summary,
          `scorecard.scores[${index}].summary`,
        ),
      }
    },
  )
  const dimensions = scores.map((score) => score.dimension)
  if (
    scores.length !== DEPLOYMENT_PROFILE_SCORE_DIMENSIONS.length ||
    new Set(dimensions).size !== dimensions.length ||
    DEPLOYMENT_PROFILE_SCORE_DIMENSIONS.some(
      (dimension) => !dimensions.includes(dimension),
    )
  ) {
    throw new DeploymentProfileQualificationError(
      'scorecard_mismatch',
      'scorecard must contain every score dimension exactly once',
    )
  }
  return {
    schemaVersion: 1,
    profileIdentityDigest: digestValue(
      scorecard.profileIdentityDigest,
      'scorecard.profileIdentityDigest',
    ),
    scores: [...scores].sort(
      (left, right) =>
        DEPLOYMENT_PROFILE_SCORE_DIMENSIONS.indexOf(left.dimension) -
        DEPLOYMENT_PROFILE_SCORE_DIMENSIONS.indexOf(right.dimension),
    ),
  }
}

function parseInput(value: unknown): DeploymentProfileQualificationInputV1 {
  const input = objectValue(value, 'qualification input')
  exactKeys(
    input,
    [
      'schemaVersion',
      'evaluatedAt',
      'profile',
      'profileIdentityDigest',
      'gateEvidence',
      'scorecard',
    ],
    'qualification input',
  )
  if (input.schemaVersion !== 1) {
    throw new DeploymentProfileQualificationError(
      'unsupported_version',
      'unsupported qualification input version',
    )
  }
  return {
    schemaVersion: 1,
    evaluatedAt: timestampValue(input.evaluatedAt, 'evaluatedAt'),
    profile: parseProfileIdentity(input.profile),
    profileIdentityDigest: digestValue(
      input.profileIdentityDigest,
      'profileIdentityDigest',
    ),
    gateEvidence: arrayValue(input.gateEvidence, 'gateEvidence').map(
      parseGateEvidence,
    ),
    scorecard: parseScorecard(input.scorecard),
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256Canonical(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalPortableJson(value))
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return bytesToHex(
    new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
  )
}

export async function computeDeploymentProfileIdentityDigest(
  profile: DeploymentProfileIdentityV1,
): Promise<string> {
  return sha256Canonical(parseProfileIdentity(profile))
}

export async function evaluateDeploymentProfileQualification(
  value: unknown,
): Promise<DeploymentProfileQualificationDecisionV1> {
  const input = parseInput(value)
  const expectedIdentityDigest = await sha256Canonical(input.profile)
  if (input.profileIdentityDigest !== expectedIdentityDigest) {
    throw new DeploymentProfileQualificationError(
      'identity_mismatch',
      'profile identity digest does not match the canonical profile identity',
    )
  }

  const byGate = new Map<
    DeploymentProfileHardGateId,
    DeploymentProfileGateEvidenceV1
  >()
  for (const evidence of input.gateEvidence) {
    if (
      evidence.profileId !== input.profile.profileId ||
      evidence.profileRevision !== input.profile.revision ||
      evidence.profileIdentityDigest !== expectedIdentityDigest
    ) {
      throw new DeploymentProfileQualificationError(
        'gate_evidence_mismatch',
        `gate evidence does not match profile identity: ${evidence.gateId}`,
      )
    }
    if (byGate.has(evidence.gateId)) {
      throw new DeploymentProfileQualificationError(
        'gate_evidence_mismatch',
        `duplicate gate evidence: ${evidence.gateId}`,
      )
    }
    byGate.set(evidence.gateId, evidence)
  }
  if (
    byGate.size !== DEPLOYMENT_PROFILE_HARD_GATE_IDS.length ||
    DEPLOYMENT_PROFILE_HARD_GATE_IDS.some((gateId) => !byGate.has(gateId))
  ) {
    throw new DeploymentProfileQualificationError(
      'gate_evidence_mismatch',
      'every hard gate must have exactly one evidence record',
    )
  }

  const evidence = DEPLOYMENT_PROFILE_HARD_GATE_IDS.map(
    (gateId) => byGate.get(gateId)!,
  )
  const failedGates = evidence
    .filter((entry) => entry.status === 'fail')
    .map((entry) => entry.gateId)
  const unresolvedGates = evidence
    .filter((entry) => entry.status === 'unresolved')
    .map((entry) => entry.gateId)
  const passed = evidence.filter((entry) => entry.status === 'pass').length
  const eligibleForScoring = failedGates.length === 0 && unresolvedGates.length === 0

  if (!eligibleForScoring && input.scorecard !== null) {
    throw new DeploymentProfileQualificationError(
      'scoring_not_allowed',
      'a profile cannot be scored while any hard gate fails or remains unresolved',
    )
  }
  if (
    input.scorecard !== null &&
    input.scorecard.profileIdentityDigest !== expectedIdentityDigest
  ) {
    throw new DeploymentProfileQualificationError(
      'scorecard_mismatch',
      'scorecard does not match profile identity',
    )
  }

  const scoreSummary =
    input.scorecard === null
      ? null
      : (() => {
          const total = input.scorecard.scores.reduce(
            (sum, score) => sum + score.score,
            0,
          )
          return {
            total,
            maximum: 50 as const,
            average: Number((total / input.scorecard.scores.length).toFixed(2)),
            scores: input.scorecard.scores,
          }
        })()

  const classification: DeploymentProfileQualificationDecisionV1['classification'] =
    failedGates.length > 0
      ? 'rejected'
      : unresolvedGates.length > 0
        ? 'conditional_candidate'
        : 'qualified_candidate'

  const decisionWithoutDigest = {
    schemaVersion: 1 as const,
    evaluatedAt: input.evaluatedAt,
    profile: input.profile,
    profileIdentityDigest: expectedIdentityDigest,
    classification,
    selection: 'not_selected' as const,
    eligibleForScoring,
    gateSummary: {
      passed,
      failed: failedGates.length,
      unresolved: unresolvedGates.length,
    },
    failedGates,
    unresolvedGates,
    evidence,
    scoreSummary,
  }
  return {
    ...decisionWithoutDigest,
    decisionDigest: await sha256Canonical(decisionWithoutDigest),
  }
}

export function canonicalDeploymentProfileDecision(
  decision: DeploymentProfileQualificationDecisionV1,
): string {
  return canonicalPortableJson(decision)
}
