import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  evaluateDeploymentProfileQualification,
  type DeploymentProfileQualificationInputV1,
} from './deployment-profile-qualification'
import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'

interface Revision4MemoryGateClosure {
  schemaVersion: 1
  gateId: 'G4'
  status: 'pass'
  recordedAt: string
  profile: {
    profileId: string
    revision: number
    profileIdentityDigest: string
    selection: 'not_selected'
    recoveryMutationAuthorized: false
  }
  workflow: {
    runId: number
    headSha: string
    conclusion: 'success'
    jobs: Array<{
      name: string
      conclusion: 'success'
    }>
  }
  artifact: {
    id: number
    name: string
    sizeBytes: number
    sha256: string
    expiredAtClosure: false
    officialArchiveMatchesReviewedCopy: true
  }
  evidence: {
    proofReady: true
    blockingReasons: []
    memoryHaltBytes: number
    claimCapLedgers: number
    maximumPeakMemoryBytes: number
    minimumHeadroomBytes: number
  }
  safety: {
    productionCredentialsUsed: false
    productionMutationPerformed: false
    recoveryMutationCommitted: false
    publicReaderUnchanged: true
    mainnetDisabled: true
    stabilizationAuthorized: false
    soakAuthorized: false
  }
  remainingQualification: {
    g3Status: 'unresolved'
    g5ThroughG10Status: 'unresolved'
    oldestUnresolvedGate: 'G3'
    revision4Selection: 'not_selected'
    r5RecoveryMutationAuthorized: false
  }
}

function readQualificationInput(): DeploymentProfileQualificationInputV1 {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-directional-egress-qualification-input.json',
      ),
      'utf8',
    ),
  ) as DeploymentProfileQualificationInputV1
}

function readMemoryGateClosure(): Revision4MemoryGateClosure {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-memory-gate-closure.json',
      ),
      'utf8',
    ),
  ) as Revision4MemoryGateClosure
}

describe('Supabase revision-4 qualification input', () => {
  it('records G1, G2, and G4 as passed while keeping the candidate unselected', async () => {
    const input = readQualificationInput()
    const decision = await evaluateDeploymentProfileQualification(input)

    expect(input.profile).toEqual(SUPABASE_REVISION4_PROFILE)
    expect(input.profileIdentityDigest).toBe(
      SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    )
    expect(input.scorecard).toBeNull()
    expect(decision.classification).toBe('conditional_candidate')
    expect(decision.selection).toBe('not_selected')
    expect(decision.eligibleForScoring).toBe(false)
    expect(decision.gateSummary).toEqual({
      passed: 3,
      failed: 0,
      unresolved: 7,
    })
    expect(decision.failedGates).toEqual([])
    expect(decision.unresolvedGates).toEqual([
      'G3',
      'G5',
      'G6',
      'G7',
      'G8',
      'G9',
      'G10',
    ])
  })

  it('binds G1 to the machine-readable contract and official provider sources', () => {
    const input = readQualificationInput()
    const g1 = input.gateEvidence.find((evidence) => evidence.gateId === 'G1')

    expect(g1).toMatchObject({
      status: 'pass',
      sourceType: 'official_documentation',
      profileRevision: 4,
      profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    })
    expect(g1?.artifacts).toContain(
      'src/shared/supabase-revision4-directional-egress-contract.ts',
    )
    expect(g1?.artifacts).toContain(
      'https://supabase.com/docs/guides/platform/manage-your-usage/egress',
    )
  })

  it('binds G2 to local meter, persistence, shadow, and PostgreSQL evidence', () => {
    const input = readQualificationInput()
    const g2 = input.gateEvidence.find((evidence) => evidence.gateId === 'G2')

    expect(g2).toMatchObject({
      status: 'pass',
      sourceType: 'local_conformance',
      profileRevision: 4,
      profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    })
    expect(g2?.artifacts).toContain(
      'docs/ops/r4f-g2-postgres-readback-2026-08-06.md',
    )
    expect(g2?.artifacts).toContain(
      'https://github.com/badjoke-lab/xrpl-lending-monitor/pull/1266',
    )
  })

  it('binds G4 to the retained authorized replay and closure record', () => {
    const input = readQualificationInput()
    const g4 = input.gateEvidence.find((evidence) => evidence.gateId === 'G4')
    const closure = readMemoryGateClosure()

    expect(g4).toMatchObject({
      status: 'pass',
      sourceType: 'read_only_shadow',
      profileRevision: 4,
      profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    })
    expect(g4?.artifacts).toContain(
      'ops/r4f/revision4-memory-gate-closure.json',
    )
    expect(g4?.artifacts).toContain(
      'https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/31086304493',
    )
    expect(g4?.artifacts).toContain(
      'https://github.com/badjoke-lab/xrpl-lending-monitor/issues/1261#issuecomment-5202436569',
    )

    expect(closure).toMatchObject({
      schemaVersion: 1,
      gateId: 'G4',
      status: 'pass',
      profile: {
        profileId: SUPABASE_REVISION4_PROFILE.profileId,
        revision: 4,
        profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
        selection: 'not_selected',
        recoveryMutationAuthorized: false,
      },
      workflow: {
        runId: 31086304493,
        headSha: '5a25d091919dc2d90116ca9cc4e92335031be9f2',
        conclusion: 'success',
        jobs: [
          { name: 'quality', conclusion: 'success' },
          { name: 'r4f-g4-memory-replay', conclusion: 'success' },
        ],
      },
      artifact: {
        id: 8961530550,
        name: 'r4f-g4-memory-replay-evidence',
        sizeBytes: 160152,
        sha256:
          'e0b4157b70faea269c61f643b78882dffb30a9168632c77e5ec6972673009ed7',
        expiredAtClosure: false,
        officialArchiveMatchesReviewedCopy: true,
      },
      evidence: {
        proofReady: true,
        blockingReasons: [],
        memoryHaltBytes: 234881024,
        claimCapLedgers: 12,
        maximumPeakMemoryBytes: 77430784,
        minimumHeadroomBytes: 157450240,
      },
      safety: {
        productionCredentialsUsed: false,
        productionMutationPerformed: false,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
      remainingQualification: {
        g3Status: 'unresolved',
        g5ThroughG10Status: 'unresolved',
        oldestUnresolvedGate: 'G3',
        revision4Selection: 'not_selected',
        r5RecoveryMutationAuthorized: false,
      },
    })
  })

  it('does not allow scoring or proof execution while any gate is unresolved', () => {
    const input = readQualificationInput()
    expect(
      input.gateEvidence.filter((evidence) => evidence.status === 'pass'),
    ).toHaveLength(3)
    expect(
      input.gateEvidence.filter((evidence) => evidence.status === 'unresolved'),
    ).toHaveLength(7)
    expect(input.scorecard).toBeNull()
  })
})
