import { describe, expect, it } from 'vitest'

import {
  canonicalDeploymentProfileDecision,
  computeDeploymentProfileIdentityDigest,
  DEPLOYMENT_PROFILE_HARD_GATE_IDS,
  DEPLOYMENT_PROFILE_SCORE_DIMENSIONS,
  DeploymentProfileQualificationError,
  evaluateDeploymentProfileQualification,
  type DeploymentProfileGateEvidenceV1,
  type DeploymentProfileGateStatus,
  type DeploymentProfileIdentityV1,
  type DeploymentProfileQualificationInputV1,
  type DeploymentProfileScorecardV1,
} from './deployment-profile-qualification'

const evaluatedAt = '2026-08-01T14:30:00.000Z'

function profile(
  overrides: Partial<DeploymentProfileIdentityV1> = {},
): DeploymentProfileIdentityV1 {
  return {
    schemaVersion: 1,
    profileId: 'self-hosted-sqlite-service',
    revision: 1,
    label: 'Cardless self-hosted SQLite service',
    components: {
      storage: 'sqlite-reference-v1',
      scheduler: 'portable-durable-scheduler-v1',
      execution: 'local-service-manager-v1',
      publication: 'git-immutable-publication-v1',
      maintenance: 'portable-bounded-maintenance-v1',
      completeStateTransfer: 'portable-complete-state-v1',
    },
    ...overrides,
  }
}

function evidence(options: {
  identity: DeploymentProfileIdentityV1
  digest: string
  statuses?: Partial<Record<(typeof DEPLOYMENT_PROFILE_HARD_GATE_IDS)[number], DeploymentProfileGateStatus>>
}): DeploymentProfileGateEvidenceV1[] {
  return DEPLOYMENT_PROFILE_HARD_GATE_IDS.map((gateId) => ({
    schemaVersion: 1,
    profileId: options.identity.profileId,
    profileRevision: options.identity.revision,
    profileIdentityDigest: options.digest,
    gateId,
    status: options.statuses?.[gateId] ?? 'pass',
    sourceType: gateId === 'G1' ? 'operator_constraint' : 'local_conformance',
    summary: `${gateId} retained qualification evidence`,
    observedAt: evaluatedAt,
    artifacts: [`evidence/${options.identity.profileId}/${gateId}.json`],
  }))
}

function scorecard(digest: string): DeploymentProfileScorecardV1 {
  return {
    schemaVersion: 1,
    profileIdentityDigest: digest,
    scores: DEPLOYMENT_PROFILE_SCORE_DIMENSIONS.map((dimension, index) => ({
      dimension,
      score: index % 6,
      summary: `${dimension} retained score evidence`,
    })),
  }
}

async function input(options: {
  identity?: DeploymentProfileIdentityV1
  statuses?: Partial<Record<(typeof DEPLOYMENT_PROFILE_HARD_GATE_IDS)[number], DeploymentProfileGateStatus>>
  includeScorecard?: boolean
} = {}): Promise<DeploymentProfileQualificationInputV1> {
  const identity = options.identity ?? profile()
  const digest = await computeDeploymentProfileIdentityDigest(identity)
  return {
    schemaVersion: 1,
    evaluatedAt,
    profile: identity,
    profileIdentityDigest: digest,
    gateEvidence: evidence({
      identity,
      digest,
      statuses: options.statuses,
    }),
    scorecard: options.includeScorecard === false ? null : scorecard(digest),
  }
}

describe('R4B deployment profile qualification evaluator', () => {
  it('produces a deterministic qualified but unselected decision after every gate passes', async () => {
    const qualification = await input()
    const first = await evaluateDeploymentProfileQualification(qualification)
    const second = await evaluateDeploymentProfileQualification(
      structuredClone(qualification),
    )

    expect(first).toEqual(second)
    expect(first).toMatchObject({
      schemaVersion: 1,
      evaluatedAt,
      classification: 'qualified_candidate',
      selection: 'not_selected',
      eligibleForScoring: true,
      gateSummary: {
        passed: 10,
        failed: 0,
        unresolved: 0,
      },
      failedGates: [],
      unresolvedGates: [],
      scoreSummary: {
        total: 21,
        maximum: 50,
        average: 2.1,
      },
    })
    expect(first.decisionDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(canonicalDeploymentProfileDecision(first)).toBe(
      canonicalDeploymentProfileDecision(second),
    )
  })

  it('keeps an all-pass unscored profile unselected and eligible for later scoring', async () => {
    const decision = await evaluateDeploymentProfileQualification(
      await input({ includeScorecard: false }),
    )
    expect(decision).toMatchObject({
      classification: 'qualified_candidate',
      selection: 'not_selected',
      eligibleForScoring: true,
      scoreSummary: null,
    })
  })

  it('classifies unresolved evidence as conditional and prohibits scoring', async () => {
    const unscored = await input({
      statuses: { G1: 'unresolved', G7: 'unresolved' },
      includeScorecard: false,
    })
    const decision = await evaluateDeploymentProfileQualification(unscored)
    expect(decision).toMatchObject({
      classification: 'conditional_candidate',
      selection: 'not_selected',
      eligibleForScoring: false,
      gateSummary: {
        passed: 8,
        failed: 0,
        unresolved: 2,
      },
      unresolvedGates: ['G1', 'G7'],
      scoreSummary: null,
    })

    const scored = structuredClone(unscored)
    scored.scorecard = scorecard(scored.profileIdentityDigest)
    await expect(
      evaluateDeploymentProfileQualification(scored),
    ).rejects.toMatchObject({ code: 'scoring_not_allowed' })
  })

  it('classifies one failed hard gate as rejected and prohibits scoring', async () => {
    const rejected = await input({
      statuses: { G3: 'fail' },
      includeScorecard: false,
    })
    const decision = await evaluateDeploymentProfileQualification(rejected)
    expect(decision).toMatchObject({
      classification: 'rejected',
      selection: 'not_selected',
      eligibleForScoring: false,
      failedGates: ['G3'],
      unresolvedGates: [],
    })

    rejected.scorecard = scorecard(rejected.profileIdentityDigest)
    await expect(
      evaluateDeploymentProfileQualification(rejected),
    ).rejects.toMatchObject({ code: 'scoring_not_allowed' })
  })

  it('rejects changed profile identity and evidence from another revision', async () => {
    const qualification = await input({ includeScorecard: false })
    const changedProfile = structuredClone(qualification)
    changedProfile.profile.components.scheduler = 'changed-scheduler-v2'
    await expect(
      evaluateDeploymentProfileQualification(changedProfile),
    ).rejects.toMatchObject({ code: 'identity_mismatch' })

    const changedEvidence = structuredClone(qualification)
    changedEvidence.gateEvidence[0]!.profileRevision = 2
    await expect(
      evaluateDeploymentProfileQualification(changedEvidence),
    ).rejects.toMatchObject({ code: 'gate_evidence_mismatch' })
  })

  it('requires every hard gate exactly once', async () => {
    const missing = await input({ includeScorecard: false })
    missing.gateEvidence.pop()
    await expect(
      evaluateDeploymentProfileQualification(missing),
    ).rejects.toMatchObject({ code: 'gate_evidence_mismatch' })

    const duplicate = await input({ includeScorecard: false })
    duplicate.gateEvidence[9] = structuredClone(duplicate.gateEvidence[0]!)
    await expect(
      evaluateDeploymentProfileQualification(duplicate),
    ).rejects.toMatchObject({ code: 'gate_evidence_mismatch' })
  })

  it('requires every score dimension exactly once and binds it to profile identity', async () => {
    const incomplete = await input()
    incomplete.scorecard!.scores.pop()
    await expect(
      evaluateDeploymentProfileQualification(incomplete),
    ).rejects.toMatchObject({ code: 'scorecard_mismatch' })

    const foreign = await input()
    foreign.scorecard!.profileIdentityDigest = '0'.repeat(64)
    await expect(
      evaluateDeploymentProfileQualification(foreign),
    ).rejects.toMatchObject({ code: 'scorecard_mismatch' })
  })

  it('rejects unsupported versions, extra fields, non-canonical timestamps, and invalid score values', async () => {
    const unsupported = (await input({ includeScorecard: false })) as unknown as Record<
      string,
      unknown
    >
    unsupported.schemaVersion = 2
    await expect(
      evaluateDeploymentProfileQualification(unsupported),
    ).rejects.toMatchObject({ code: 'unsupported_version' })

    const extra = (await input({ includeScorecard: false })) as unknown as Record<
      string,
      unknown
    >
    extra.unexpected = true
    await expect(evaluateDeploymentProfileQualification(extra)).rejects.toBeInstanceOf(
      DeploymentProfileQualificationError,
    )

    const timestamp = await input({ includeScorecard: false })
    timestamp.evaluatedAt = '2026-08-01T14:30:00Z'
    await expect(
      evaluateDeploymentProfileQualification(timestamp),
    ).rejects.toMatchObject({ code: 'invalid_input' })

    const invalidScore = await input()
    invalidScore.scorecard!.scores[0]!.score = 6
    await expect(
      evaluateDeploymentProfileQualification(invalidScore),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  })
})
