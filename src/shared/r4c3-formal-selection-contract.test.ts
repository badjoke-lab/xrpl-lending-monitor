import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  computeDeploymentProfileIdentityDigest,
  DEPLOYMENT_PROFILE_HARD_GATE_IDS,
  evaluateDeploymentProfileQualification,
  type DeploymentProfileQualificationDecisionV1,
  type DeploymentProfileQualificationInputV1,
} from './deployment-profile-qualification'

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8')) as T
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    )
  }
  return value
}

function digest(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex')
}

interface ResourceStatus {
  profileId: string
  profileRevision: number
  profileIdentityDigest: string
  qualificationEvidence: {
    workflowRunId: number
    sourceCommit: string
    artifactId: number
    artifactDigest: string
  }
  gates: {
    G8: {
      status: string
      qualified: boolean
      profileSelected: boolean
      session: {
        completedTicks: number
        committedLedgers: number
        minuteRates: number[]
        accountingAttempts: number
        allowedAccountingAttempts: number
        unsafeAccountingAttempts: number
      }
      injectedFailClosedQualification: {
        guardKinds: string[]
        allRejectedBeforeCommit: boolean
        noStateMutation: boolean
        activeProfileReadOnly: boolean
      }
      quotaStateTransfer: Record<string, boolean>
    }
    G9: {
      status: string
      passed: boolean
      profileRevision: number
      profileIdentityDigest: string
    }
  }
  restrictions: Record<string, boolean>
  statusDigest: string
}

interface SelectionRecord {
  outcome: string
  selectedProfile: {
    profileId: string
    profileRevision: number
    profileIdentityDigest: string
    decisionDigest: string
    classification: string
  }
  selectionBasis: {
    onlyQualifiedCandidate: boolean
    gateSummary: { passed: number; failed: number; unresolved: number }
    controllingRemoteEvidence: {
      workflowRunId: number
      sourceCommit: string
      artifactId: number
      artifactDigest: string
    }
  }
  nextPhase: {
    phase: string
    r5Authorized: boolean
  }
  restrictions: Record<string, boolean>
  selectionDigest: string
}

const decision = readJson<DeploymentProfileQualificationDecisionV1>(
  'docs/ops/r4c3-supabase-r4b-decision-2026-08-03.json',
)
const status = readJson<ResourceStatus>(
  'docs/ops/r4c3-resource-gate-status-2026-08-03.json',
)
const selection = readJson<SelectionRecord>(
  'docs/ops/r4e-deployment-profile-selection-2026-08-03.json',
)

describe('R4C3 formal revision-3 selection contract', () => {
  it('reproduces the retained R4B decision through the canonical evaluator', async () => {
    const input: DeploymentProfileQualificationInputV1 = {
      schemaVersion: 1,
      evaluatedAt: decision.evaluatedAt,
      profile: decision.profile,
      profileIdentityDigest: decision.profileIdentityDigest,
      gateEvidence: decision.evidence,
      scorecard: null,
    }

    const evaluated = await evaluateDeploymentProfileQualification(input)
    expect(evaluated).toEqual(decision)
    expect(await computeDeploymentProfileIdentityDigest(decision.profile)).toBe(
      decision.profileIdentityDigest,
    )
  })

  it('retains every hard gate exactly once as pass', () => {
    expect(decision.classification).toBe('qualified_candidate')
    expect(decision.selection).toBe('not_selected')
    expect(decision.eligibleForScoring).toBe(true)
    expect(decision.gateSummary).toEqual({ passed: 10, failed: 0, unresolved: 0 })
    expect(decision.failedGates).toEqual([])
    expect(decision.unresolvedGates).toEqual([])
    expect(decision.scoreSummary).toBeNull()
    expect(decision.evidence.map((entry) => entry.gateId)).toEqual(
      DEPLOYMENT_PROFILE_HARD_GATE_IDS,
    )
    expect(decision.evidence.every((entry) => entry.status === 'pass')).toBe(true)
  })

  it('binds the exact successful remote evidence and revision-3 G8/G9 state', () => {
    expect(status.profileId).toBe('supabase_free_postgres_pgcron_edge')
    expect(status.profileRevision).toBe(3)
    expect(status.profileIdentityDigest).toBe(decision.profileIdentityDigest)
    expect(status.qualificationEvidence).toEqual({
      workflowRunId: 30817518929,
      sourceCommit: '01fc146dcd261d2e919c614130ee19566ca854ae',
      artifactId: 8857796228,
      artifactDigest:
        'sha256:5ad18831e32c0dd3b87e7135909a38302b21a01274b112545ea15e259270813c',
      verifiedAt: expect.any(String),
      issueNumber: 1109,
    })
    expect(status.gates.G8.status).toBe('qualified')
    expect(status.gates.G8.qualified).toBe(true)
    expect(status.gates.G8.profileSelected).toBe(false)
    expect(status.gates.G8.session).toEqual({
      completedTicks: 6,
      committedLedgers: 144,
      minuteRates: [24, 24, 24, 24, 24, 24],
      accountingAttempts: 6,
      allowedAccountingAttempts: 6,
      unsafeAccountingAttempts: 0,
      sessionId: expect.any(String),
    })
    expect(status.gates.G8.injectedFailClosedQualification.guardKinds).toEqual([
      'missing_accounting',
      'unsafe_accounting',
      'memory_halt',
      'tick_egress_halt',
      'monthly_egress_halt',
      'invocation_halt',
      'future_record',
    ])
    expect(status.gates.G8.injectedFailClosedQualification).toMatchObject({
      allRejectedBeforeCommit: true,
      noStateMutation: true,
      activeProfileReadOnly: true,
    })
    expect(
      Object.values(status.gates.G8.quotaStateTransfer).every((value) => value),
    ).toBe(true)
    expect(status.gates.G9).toMatchObject({
      status: 'qualified',
      passed: true,
      profileRevision: 3,
      profileIdentityDigest: decision.profileIdentityDigest,
    })
  })

  it('keeps R5 prohibited in gate evidence and authorizes it only in selection', () => {
    expect(Object.values(status.restrictions).every((value) => value === false)).toBe(true)
    expect(selection.outcome).toBe('profile_selected')
    expect(selection.selectedProfile).toEqual({
      profileId: decision.profile.profileId,
      profileRevision: decision.profile.revision,
      profileIdentityDigest: decision.profileIdentityDigest,
      decisionDigest: decision.decisionDigest,
      classification: decision.classification,
    })
    expect(selection.selectionBasis.onlyQualifiedCandidate).toBe(true)
    expect(selection.selectionBasis.gateSummary).toEqual(decision.gateSummary)
    expect(selection.selectionBasis.controllingRemoteEvidence).toEqual({
      workflowRunId: 30817518929,
      sourceCommit: '01fc146dcd261d2e919c614130ee19566ca854ae',
      artifactId: 8857796228,
      artifactDigest:
        'sha256:5ad18831e32c0dd3b87e7135909a38302b21a01274b112545ea15e259270813c',
      verifiedAt: expect.any(String),
    })
    expect(selection.nextPhase).toMatchObject({ phase: 'R5', r5Authorized: true })
    expect(selection.restrictions).toEqual({
      publicReaderCutover: false,
      mainnet: false,
      stabilization: false,
      soak: false,
      retiredCloudflareCollectorRestart: false,
    })
  })

  it('retains canonical digests for the decision, status, and selection', () => {
    const decisionWithoutDigest = structuredClone(decision) as Record<string, unknown>
    delete decisionWithoutDigest.decisionDigest
    expect(digest(decisionWithoutDigest)).toBe(decision.decisionDigest)

    const statusWithoutDigest = structuredClone(status) as unknown as Record<string, unknown>
    delete statusWithoutDigest.statusDigest
    expect(digest(statusWithoutDigest)).toBe(status.statusDigest)

    const selectionWithoutDigest = structuredClone(selection) as unknown as Record<
      string,
      unknown
    >
    delete selectionWithoutDigest.selectionDigest
    expect(digest(selectionWithoutDigest)).toBe(selection.selectionDigest)
  })
})
