import { describe, expect, it } from 'vitest'

import { canonicalDeploymentProfileDecision } from './deployment-profile-qualification'
import {
  buildR4C1LocalSqliteQualificationInput,
  evaluateR4C1LocalSqliteProfile,
  R4C1_LOCAL_SQLITE_PROFILE,
} from './r4c1-local-sqlite-profile-evidence'

describe('R4C1 local SQLite profile evidence', () => {
  it('records seven passing gates and keeps throughput, resources, and operations unresolved', async () => {
    const decision = await evaluateR4C1LocalSqliteProfile()

    expect(decision).toMatchObject({
      schemaVersion: 1,
      profile: R4C1_LOCAL_SQLITE_PROFILE,
      classification: 'conditional_candidate',
      selection: 'not_selected',
      eligibleForScoring: false,
      gateSummary: {
        passed: 7,
        failed: 0,
        unresolved: 3,
      },
      failedGates: [],
      unresolvedGates: ['G7', 'G8', 'G9'],
      scoreSummary: null,
    })
    expect(decision.decisionDigest).toMatch(/^[0-9a-f]{64}$/u)
    expect(decision.evidence.map((entry) => entry.gateId)).toEqual([
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
    ])
  })

  it('produces deterministic input and decision identities', async () => {
    const firstInput = await buildR4C1LocalSqliteQualificationInput()
    const secondInput = await buildR4C1LocalSqliteQualificationInput()
    expect(firstInput).toEqual(secondInput)

    const first = await evaluateR4C1LocalSqliteProfile()
    const second = await evaluateR4C1LocalSqliteProfile()
    expect(first).toEqual(second)
    expect(canonicalDeploymentProfileDecision(first)).toBe(
      canonicalDeploymentProfileDecision(second),
    )
  })

  it('does not treat local crash recovery as proof of an always-on production host', async () => {
    const decision = await evaluateR4C1LocalSqliteProfile()
    const operatorEvidence = decision.evidence.find((entry) => entry.gateId === 'G9')
    expect(operatorEvidence).toMatchObject({
      status: 'unresolved',
      sourceType: 'operator_constraint',
    })
    expect(operatorEvidence?.summary).toContain('No actual always-on host')
    expect(decision.classification).not.toBe('qualified_candidate')
  })
})
