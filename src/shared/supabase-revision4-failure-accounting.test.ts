import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type SupabaseRevision4FailureAccountingInput,
  verifySupabaseRevision4FailureAccounting,
} from './supabase-revision4-failure-accounting'

function fixture(): SupabaseRevision4FailureAccountingInput {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'ops/r4f/revision4-failure-accounting-synthetic.json'),
      'utf8',
    ),
  ) as SupabaseRevision4FailureAccountingInput
}

function proofShape(): SupabaseRevision4FailureAccountingInput {
  const input = fixture()
  input.evidenceClass = 'bounded_failure_accounting_replay'
  input.evidenceId = 'r4f-g7-proof-shape'
  input.prerequisites.g3ProviderReconciliationPassed = true
  input.prerequisites.g4MemoryRequalificationPassed = true
  input.prerequisites.g5SteadyConvergencePassed = true
  input.prerequisites.g6CatchupConvergencePassed = true
  return input
}

describe('Supabase revision-4 G7 failure accounting', () => {
  it('keeps the retained synthetic fixture non-qualifying while exposing the unresolved gates', () => {
    const result = verifySupabaseRevision4FailureAccounting(fixture())

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'synthetic_or_unbounded_evidence_not_qualifying',
    )
    expect(result.blockingReasons).toContain('g3_provider_reconciliation_not_passed')
    expect(result.blockingReasons).toContain('g5_steady_convergence_not_passed')
    expect(result.blockingReasons).toContain('g6_catchup_convergence_not_passed')
    expect(result.blockingReasons).not.toContain('g4_memory_requalification_not_passed')
  })

  it('accepts the complete five-path proof shape when all preceding gates are explicitly satisfied', () => {
    const result = verifySupabaseRevision4FailureAccounting(proofShape())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.allRequiredScenarioKindsPresent).toBe(true)
    expect(result.machineSummary.failedReservationsPreserved).toBe(true)
    expect(result.machineSummary.retryAccountingAppended).toBe(true)
    expect(result.machineSummary.rollbackAccountingPreserved).toBe(true)
    expect(result.machineSummary.leaseReclaimAccountingPreserved).toBe(true)
    expect(result.machineSummary.adoptedSourceAccountingPreserved).toBe(true)
    expect(result.machineSummary.repairOnlySeparatedFromOrdinarySuccess).toBe(true)
    expect(result.machineSummary.scenarioCount).toBe(5)
    expect(result.machineSummary.attemptCount).toBe(10)
  })

  it('rejects replacing a failed-attempt reservation with the smaller measured amount', () => {
    const input = proofShape()
    const failed = input.scenarios[0].attempts[0]
    failed.retainedBillableEgressUpperBoundBytes =
      failed.measuredBillableEgressUpperBoundBytes
    input.scenarios[0].retainedHistoricalBillableEgressUpperBoundBytes =
      failed.retainedBillableEgressUpperBoundBytes
      + input.scenarios[0].attempts[1].retainedBillableEgressUpperBoundBytes
    input.scenarios[0].failurePathRetainedBillableEgressUpperBoundBytes =
      failed.retainedBillableEgressUpperBoundBytes

    const result = verifySupabaseRevision4FailureAccounting(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'failure_reservation_not_preserved:scenario_0:attempt_0',
    )
    expect(result.machineSummary.failedReservationsPreserved).toBe(false)
  })

  it('rejects a retry summary that erases the failed attempt after success', () => {
    const input = proofShape()
    const retry = input.scenarios[0].attempts[1]
    input.scenarios[0].retainedHistoricalBillableEgressUpperBoundBytes =
      retry.retainedBillableEgressUpperBoundBytes

    const result = verifySupabaseRevision4FailureAccounting(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'scenario_summary_mismatch:scenario_0:historical',
    )
    expect(result.blockingReasons).toContain('failed_retry_accounting_not_appended')
    expect(result.machineSummary.retryAccountingAppended).toBe(false)
  })

  it('rejects rollback and lease reclaim paths that erase the earlier attempt accounting', () => {
    const rollback = proofShape()
    rollback.scenarios[1].attempts[0].retainedBillableEgressUpperBoundBytes = 0
    rollback.scenarios[1].failurePathRetainedBillableEgressUpperBoundBytes = 0
    rollback.scenarios[1].retainedHistoricalBillableEgressUpperBoundBytes =
      rollback.scenarios[1].attempts[1].retainedBillableEgressUpperBoundBytes

    const rollbackResult = verifySupabaseRevision4FailureAccounting(rollback)
    expect(rollbackResult.proofReady).toBe(false)
    expect(rollbackResult.blockingReasons).toContain('rollback_accounting_erased')

    const reclaim = proofShape()
    reclaim.scenarios[2].attempts[0].retainedBillableEgressUpperBoundBytes = 0
    reclaim.scenarios[2].failurePathRetainedBillableEgressUpperBoundBytes = 0
    reclaim.scenarios[2].retainedHistoricalBillableEgressUpperBoundBytes =
      reclaim.scenarios[2].attempts[1].retainedBillableEgressUpperBoundBytes

    const reclaimResult = verifySupabaseRevision4FailureAccounting(reclaim)
    expect(reclaimResult.proofReady).toBe(false)
    expect(reclaimResult.blockingReasons).toContain(
      'lease_reclaim_prior_accounting_erased',
    )
  })

  it('rejects adoption without retained source accounting and repair folded into ordinary success', () => {
    const adoption = proofShape()
    adoption.scenarios[3].attempts[0].measuredBillableEgressUpperBoundBytes = 0
    adoption.scenarios[3].attempts[0].retainedBillableEgressUpperBoundBytes = 0
    adoption.scenarios[3].ordinarySuccessfulBillableEgressUpperBoundBytes = 0
    adoption.scenarios[3].retainedHistoricalBillableEgressUpperBoundBytes =
      adoption.scenarios[3].attempts[1].retainedBillableEgressUpperBoundBytes

    const adoptionResult = verifySupabaseRevision4FailureAccounting(adoption)
    expect(adoptionResult.proofReady).toBe(false)
    expect(adoptionResult.blockingReasons).toContain(
      'adopted_source_accounting_not_preserved',
    )

    const repair = proofShape()
    repair.scenarios[4].ordinarySuccessfulBillableEgressUpperBoundBytes =
      repair.scenarios[4].retainedHistoricalBillableEgressUpperBoundBytes

    const repairResult = verifySupabaseRevision4FailureAccounting(repair)
    expect(repairResult.proofReady).toBe(false)
    expect(repairResult.blockingReasons).toContain(
      'scenario_summary_mismatch:scenario_4:ordinary_success',
    )
    expect(repairResult.blockingReasons).toContain(
      'repair_only_not_separated_from_ordinary_success',
    )
    expect(repairResult.machineSummary.repairOnlySeparatedFromOrdinarySuccess).toBe(
      false,
    )
  })

  it('requires every named failure path exactly once and preserves the fixed guards', () => {
    const input = proofShape()
    input.scenarios.pop()
    input.policy.claimCapLedgers = 24

    const result = verifySupabaseRevision4FailureAccounting(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('required_failure_scenarios_incomplete')
    expect(result.blockingReasons).toContain('policy_changed:claimCapLedgers')
  })
})
