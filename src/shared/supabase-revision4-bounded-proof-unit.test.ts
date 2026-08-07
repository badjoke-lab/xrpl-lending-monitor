import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type SupabaseRevision4G9Input,
  verifySupabaseRevision4BoundedProofUnit,
} from './supabase-revision4-bounded-proof-unit'

function fixture(): SupabaseRevision4G9Input {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'ops/r4f/revision4-bounded-proof-unit-synthetic.json'), 'utf8'),
  ) as SupabaseRevision4G9Input
}

function proofShape(): SupabaseRevision4G9Input {
  const input = fixture()
  input.evidenceClass = 'bounded_proof_unit_execution'
  input.evidenceId = 'r4f-g9-proof-shape'
  for (let gate = 1; gate <= 8; gate += 1) {
    input.prerequisites[`g${gate}Passed` as keyof typeof input.prerequisites] = true as never
  }
  input.authorization.authorized = true
  input.execution.attempted = true
  input.execution.completed = true
  return input
}

describe('Supabase revision-4 G9 bounded proof unit', () => {
  it('keeps the retained fixture unqualified and unexecuted without owner authorization', () => {
    const result = verifySupabaseRevision4BoundedProofUnit(fixture())
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('synthetic_or_unbounded_evidence_not_qualifying')
    expect(result.blockingReasons).toContain('g3_not_passed')
    expect(result.blockingReasons).toContain('g8_not_passed')
    expect(result.blockingReasons).toContain('owner_authorization_missing')
    expect(result.blockingReasons).toContain('proof_unit_execution_not_completed')
  })

  it('accepts exactly one owner-authorized bounded unit after all eight gates pass', () => {
    const result = verifySupabaseRevision4BoundedProofUnit(proofShape())
    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.allEightPrerequisitesPassed).toBe(true)
    expect(result.machineSummary.authorizationValid).toBe(true)
    expect(result.machineSummary.proofUnitBounded).toBe(true)
    expect(result.machineSummary.executionMatchesAuthorization).toBe(true)
    expect(result.machineSummary.executionWithinBudgets).toBe(true)
    expect(result.machineSummary.oneShotConsumptionProved).toBe(true)
  })

  it('rejects authorization from another issue, owner, commit, or revision identity', () => {
    const input = proofShape()
    input.authorization.issueNumber = 1175
    input.authorization.authorizedBy = 'someone-else'
    input.authorization.sourceCommit = '1111111111111111111111111111111111111111'
    input.authorization.profileRevision = 3

    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('authorization_issue_mismatch')
    expect(result.blockingReasons).toContain('authorization_owner_mismatch')
    expect(result.blockingReasons).toContain('authorization_source_or_identity_mismatch')
  })

  it('rejects an authorization window that does not contain the captured execution', () => {
    const input = proofShape()
    input.authorization.expiresAt = '2026-08-07T23:59:59.000Z'
    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('authorization_window_invalid')
  })

  it('rejects a second unit, oversized ledger range, or relaxed resource budget', () => {
    const input = proofShape()
    input.authorization.proofUnitCount = 2
    input.authorization.endLedgerIndex = input.authorization.startLedgerIndex + 23
    input.authorization.billableEgressBudgetBytes = 4294967296

    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('proof_unit_authorization_not_bounded')
  })

  it('rejects execution outside the authorized range or resource budgets', () => {
    const input = proofShape()
    input.execution.endLedgerIndex += 1
    input.execution.invocationsUsed = input.authorization.invocationBudget + 1

    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('execution_does_not_match_authorization')
    expect(result.blockingReasons).toContain('execution_budget_exceeded')
  })

  it('requires ledger integrity and consumes authorization exactly once with no successor', () => {
    const input = proofShape()
    input.execution.parentHashContinuityVerified = false
    input.execution.duplicateLedgerCount = 1
    input.execution.authorizationConsumedExactlyOnce = false
    input.execution.successorNotAuthorized = false

    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('proof_unit_ledger_integrity_not_proved')
    expect(result.blockingReasons).toContain('one_shot_consumption_not_proved')
  })

  it('does not let G9 authorize release, Mainnet, stabilization, soak, or transactions', () => {
    const input = proofShape()
    input.safety.publicReaderUnchanged = false
    input.safety.mainnetDisabled = false
    input.safety.stabilizationAuthorized = true
    input.safety.soakAuthorized = true
    input.safety.transactionSubmissionPerformed = true

    const result = verifySupabaseRevision4BoundedProofUnit(input)
    expect(result.proofReady).toBe(false)
    expect(result.machineSummary.releaseBoundaryClosed).toBe(false)
  })
})
