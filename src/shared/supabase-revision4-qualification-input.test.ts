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

describe('Supabase revision-4 qualification input', () => {
  it('records G1 and G2 as passed while keeping the candidate unselected', async () => {
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
      passed: 2,
      failed: 0,
      unresolved: 8,
    })
    expect(decision.failedGates).toEqual([])
    expect(decision.unresolvedGates).toEqual([
      'G3',
      'G4',
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

  it('does not allow scoring or proof execution while any gate is unresolved', () => {
    const input = readQualificationInput()
    expect(
      input.gateEvidence.filter((evidence) => evidence.status === 'pass'),
    ).toHaveLength(2)
    expect(
      input.gateEvidence.filter((evidence) => evidence.status === 'unresolved'),
    ).toHaveLength(8)
    expect(input.scorecard).toBeNull()
  })
})
