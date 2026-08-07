import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type SupabaseRevision4SelectionDecisionInput,
  verifySupabaseRevision4SelectionDecision,
} from './supabase-revision4-selection-decision'

function fixture(): SupabaseRevision4SelectionDecisionInput {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), 'ops/r4f/revision4-selection-decision-synthetic.json'), 'utf8'),
  ) as SupabaseRevision4SelectionDecisionInput
}

function selectedShape(): SupabaseRevision4SelectionDecisionInput {
  const input = fixture()
  input.evidenceClass = 'formal_selection_decision'
  input.evidenceId = 'r4f-g10-selected-shape'
  for (const gate of input.gateEvidence) gate.status = 'pass'
  input.convergence.steadyConvergenceProved = true
  input.convergence.catchupConvergenceProved = true
  input.convergence.boundedProofUnitPassed = true
  input.decision.outcome = 'selected'
  input.decision.nextStep = 'r5_owner_authorization_required'
  return input
}

describe('Supabase revision-4 G10 selection decision', () => {
  it('retains current unresolved state as not selected and non-final', () => {
    const result = verifySupabaseRevision4SelectionDecision(fixture())
    expect(result.proofReady).toBe(false)
    expect(result.decisionReady).toBe(false)
    expect(result.blockingReasons).toContain('synthetic_or_nonfinal_decision_not_qualifying')
    expect(result.blockingReasons).toContain('qualification_still_unresolved')
    expect(result.machineSummary.unresolvedGateIds).toEqual(['G3', 'G5', 'G6', 'G7', 'G8', 'G9'])
    expect(result.machineSummary.outcomeConsistent).toBe(true)
  })

  it('accepts selection only when G1-G9 all pass and convergence proofs agree', () => {
    const result = verifySupabaseRevision4SelectionDecision(selectedShape())
    expect(result.proofReady).toBe(true)
    expect(result.decisionReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.selectionEligible).toBe(true)
    expect(result.machineSummary.r5RequiresSeparateOwnerAuthorization).toBe(true)
    expect(result.machineSummary.releaseBoundaryClosed).toBe(true)
  })

  it('rejects selected outcome while any gate is unresolved', () => {
    const input = selectedShape()
    input.gateEvidence.find((gate) => gate.gateId === 'G3')!.status = 'unresolved'
    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('selection_without_all_hard_gates')
  })

  it('requires terminal failure to reject and exact failed-gate identity', () => {
    const input = selectedShape()
    input.gateEvidence.find((gate) => gate.gateId === 'G5')!.status = 'fail'
    input.convergence.steadyConvergenceProved = false
    input.decision.outcome = 'rejected'
    input.decision.rejectedGateIds = ['G5']
    input.decision.nextStep = 'return_to_architecture_selection'

    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(true)
    expect(result.machineSummary.rejectionRequired).toBe(true)

    input.decision.rejectedGateIds = ['G6']
    const mismatch = verifySupabaseRevision4SelectionDecision(input)
    expect(mismatch.proofReady).toBe(false)
    expect(mismatch.blockingReasons).toContain('rejected_gate_set_mismatch')
  })

  it('rejects a pass status that contradicts steady, catch-up, or bounded-proof evidence', () => {
    const input = selectedShape()
    input.convergence.catchupConvergenceProved = false
    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('catchup_status_inconsistent')
  })

  it('never lets G10 itself authorize R5 recovery mutation', () => {
    const input = selectedShape()
    input.decision.r5RecoveryMutationAuthorized = true
    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('g10_cannot_authorize_r5_mutation')
    expect(result.machineSummary.releaseBoundaryClosed).toBe(false)
  })

  it('rejects missing or duplicated gate evidence and changed fixed guards', () => {
    const input = selectedShape()
    input.gateEvidence[8] = { ...input.gateEvidence[7] }
    input.policy.claimCapLedgers = 24
    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('gate_evidence_duplicated:G8')
    expect(result.blockingReasons).toContain('gate_evidence_missing:G9')
    expect(result.blockingReasons).toContain('policy_changed:claimCapLedgers')
  })

  it('keeps public reader, Mainnet, stabilization, soak, retired collector, and transactions closed', () => {
    const input = selectedShape()
    input.safety.mainnetDisabled = false
    input.safety.retiredCloudflareCollectorRestarted = true
    const result = verifySupabaseRevision4SelectionDecision(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('mainnet_not_disabled')
    expect(result.blockingReasons).toContain('retired_cloudflare_collector_restarted')
  })
})
