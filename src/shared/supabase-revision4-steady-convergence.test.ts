import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  SUPABASE_REVISION4_INVOCATION_HALT,
  SUPABASE_REVISION4_MEMORY_HALT_BYTES,
  SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES,
  SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_WINDOW,
  SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
  SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
  type SupabaseRevision4SteadyConvergenceInput,
  verifySupabaseRevision4SteadyConvergence,
} from './supabase-revision4-steady-convergence'

const PROFILE_DIGEST =
  '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const SOURCE_COMMIT = '8df6210b50834957ebab753ccf874e5bc908a440'
const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

const cli = readFileSync(
  resolve(process.cwd(), 'scripts/verify-r4f-revision4-steady-convergence.ts'),
  'utf8',
)
const bundleConfig = readFileSync(
  resolve(
    process.cwd(),
    'vite.r4f-revision4-steady-convergence-verifier.config.ts',
  ),
  'utf8',
)
const harness = readFileSync(
  resolve(
    process.cwd(),
    'scripts/test-r4f-revision4-steady-convergence-verifier.sh',
  ),
  'utf8',
)

function qualifyingInput(): SupabaseRevision4SteadyConvergenceInput {
  return {
    schemaVersion: 1,
    evidenceClass: 'bounded_steady_replay',
    profileId: 'supabase_free_postgres_pgcron_edge',
    profileRevision: 4,
    profileIdentityDigest: PROFILE_DIGEST,
    evidenceId: 'r4f-g5-bounded-steady-replay-test',
    capturedAt: '2026-08-07T05:10:00.000Z',
    sourceCommit: SOURCE_COMMIT,
    prerequisites: {
      g3ProviderReconciliationPassed: true,
      providerCaptureDigest: SHA_A,
      selectedUnexplainedDeltaReserveBytesPerMinute: 1_000,
      interventionReserveApproved: true,
      interventionReserveBytes: 100_000_000,
      interventionReserveRationaleDigest: SHA_B,
    },
    policy: {
      rollingEgressHaltBytes: SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
      rollingWindowMinutes: SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
      requiredLedgersPerMinute: 21,
      invocationHalt: SUPABASE_REVISION4_INVOCATION_HALT,
      memoryHaltBytes: SUPABASE_REVISION4_MEMORY_HALT_BYTES,
      claimCapLedgers: SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
      minimumConsecutiveMinutes: SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES,
    },
    minutes: Array.from({ length: 6 }, (_, index) => ({
      minuteStart: `2026-08-07T05:0${index}:00.000Z`,
      startLedgerIndex: 4_200_000 + index * 21,
      endLedgerIndex: 4_200_020 + index * 21,
      committedLedgers: 21,
      invocationCount: 4,
      applicationBillableEgressUpperBoundBytes: 50_000,
      maximumPeakMemoryBytes: 80_000_000,
      maximumClaimLedgers: 12,
      accountingDigests: [SHA_A],
      committed: true,
      parentHashContinuityVerified: true,
      duplicateLedgerCount: 0,
      skippedLedgerCount: 0,
    })),
    safety: {
      productionCredentialsUsed: false,
      productionMutationPerformed: false,
      recoveryMutationCommitted: false,
      transactionSubmissionPerformed: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
}

function syntheticFixture(): SupabaseRevision4SteadyConvergenceInput {
  return JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-steady-convergence-synthetic.json',
      ),
      'utf8',
    ),
  ) as SupabaseRevision4SteadyConvergenceInput
}

describe('Supabase revision-4 G5 steady convergence verifier', () => {
  it('retains an offline CLI and fail-closed synthetic harness', () => {
    expect(cli).toContain('verifySupabaseRevision4SteadyConvergence')
    expect(cli).toContain('--require-proof-ready')
    expect(bundleConfig).toContain(
      'r4f-revision4-steady-convergence-verifier.mjs',
    )
    expect(harness).toContain(
      'synthetic_or_unbounded_evidence_not_qualifying',
    )
    expect(harness).toContain('g3_provider_reconciliation_not_passed')
    expect(harness).toContain('status" -ne 2')
  })

  it('locks the no-charge steady policy', () => {
    expect(SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES).toBe(4_294_967_296)
    expect(SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES).toBe(44_640)
    expect(SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_WINDOW).toBe(937_440)
    expect(SUPABASE_REVISION4_INVOCATION_HALT).toBe(400_000)
    expect(SUPABASE_REVISION4_MEMORY_HALT_BYTES).toBe(234_881_024)
    expect(SUPABASE_REVISION4_CLAIM_CAP_LEDGERS).toBe(12)
    expect(SUPABASE_REVISION4_MINIMUM_STEADY_MINUTES).toBe(6)
  })

  it('accepts only a provider-reconciled consecutive steady shape below every halt', () => {
    const result = verifySupabaseRevision4SteadyConvergence(qualifyingInput())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.sampleMinutes).toBe(6)
    expect(result.machineSummary.totalCommittedLedgers).toBe(126)
    expect(result.machineSummary.averageCommittedLedgersPerMinute).toBe(21)
    expect(result.machineSummary.minimumCommittedLedgersPerMinute).toBe(21)
    expect(result.machineSummary.requiredLedgersPerWindow).toBe(937_440)
    expect(result.machineSummary.projectedRollingEgressUpperBoundBytes).toBe(
      2_376_640_000,
    )
    expect(result.machineSummary.rollingEgressHeadroomBytes).toBe(1_918_327_296)
    expect(result.machineSummary.projectedInvocations).toBe(178_560)
    expect(result.machineSummary.invocationHeadroom).toBe(221_440)
    expect(result.machineSummary.maximumPeakMemoryBytes).toBe(80_000_000)
    expect(result.machineSummary.minimumMemoryHeadroomBytes).toBe(154_881_024)
    expect(result.machineSummary.maximumClaimLedgers).toBe(12)
    expect(result.machineSummary.consecutiveMinuteSequenceVerified).toBe(true)
    expect(result.machineSummary.ledgerContinuityVerified).toBe(true)
  })

  it('rejects the retained synthetic fixture and a single successful minute', () => {
    const result = verifySupabaseRevision4SteadyConvergence(syntheticFixture())

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'synthetic_or_unbounded_evidence_not_qualifying',
    )
    expect(result.blockingReasons).toContain('g3_provider_reconciliation_not_passed')
    expect(result.blockingReasons).toContain('intervention_reserve_not_approved')
    expect(result.blockingReasons).toContain(
      'insufficient_consecutive_minute_samples',
    )
  })

  it('rejects changed guards, discontinuity, cap bypass, and memory-halt recurrence', () => {
    const input = qualifyingInput()
    input.policy.rollingEgressHaltBytes += 1
    input.minutes[1]!.startLedgerIndex += 1
    input.minutes[1]!.maximumClaimLedgers = 13
    input.minutes[2]!.maximumPeakMemoryBytes = SUPABASE_REVISION4_MEMORY_HALT_BYTES

    const result = verifySupabaseRevision4SteadyConvergence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('policy_changed:rollingEgressHaltBytes')
    expect(result.blockingReasons).toContain('ledger_sequence_not_contiguous:minute_1')
    expect(result.blockingReasons).toContain('claim_cap_exceeded:minute_1')
    expect(result.blockingReasons).toContain('memory_halt_reached:minute_2')
  })

  it('rejects egress and invocation projections that do not remain below fixed halts', () => {
    const input = qualifyingInput()
    for (const minute of input.minutes) {
      minute.applicationBillableEgressUpperBoundBytes = 100_000
      minute.invocationCount = 9
    }

    const result = verifySupabaseRevision4SteadyConvergence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'projected_rolling_egress_not_below_halt',
    )
    expect(result.blockingReasons).toContain('projected_invocations_not_below_halt')
  })

  it('does not let average throughput hide a sub-threshold minute', () => {
    const input = qualifyingInput()
    input.minutes[0]!.committedLedgers = 20
    input.minutes[0]!.endLedgerIndex -= 1
    input.minutes[1]!.startLedgerIndex -= 1
    input.minutes[1]!.committedLedgers = 22

    const result = verifySupabaseRevision4SteadyConvergence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('minute_below_required_rate:minute_0')
  })
})
