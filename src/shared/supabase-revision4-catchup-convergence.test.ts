import { describe, expect, it } from 'vitest'

import {
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'
import {
  SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  SUPABASE_REVISION4_INVOCATION_HALT,
  SUPABASE_REVISION4_MEMORY_HALT_BYTES,
  SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
  SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
  SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
} from './supabase-revision4-steady-convergence'
import {
  SUPABASE_REVISION4_MINIMUM_CATCHUP_LEDGERS_PER_MINUTE,
  SUPABASE_REVISION4_MINIMUM_CATCHUP_MINUTES,
  type SupabaseRevision4CatchupConvergenceInput,
  verifySupabaseRevision4CatchupConvergence,
} from './supabase-revision4-catchup-convergence'

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const SHA_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
const SHA_D = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'

function qualifyingInput(): SupabaseRevision4CatchupConvergenceInput {
  return {
    schemaVersion: 1,
    evidenceClass: 'bounded_moving_head_catchup',
    profileId: SUPABASE_REVISION4_PROFILE.profileId,
    profileRevision: SUPABASE_REVISION4_PROFILE.revision,
    profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    evidenceId: 'r4f-g6-moving-head-test',
    capturedAt: '2026-08-07T07:00:00.000Z',
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
    prerequisites: {
      g3ProviderReconciliationPassed: true,
      g5SteadyConvergencePassed: true,
      providerCaptureDigest: SHA_A,
      g5SteadyEvidenceDigest: SHA_B,
      selectedUnexplainedDeltaReserveBytesPerMinute: 1_000,
      interventionReserveApproved: true,
      interventionReserveBytes: 100_000_000,
      interventionReserveRationaleDigest: SHA_C,
      g5SteadyBillableEgressUpperBoundBytesPerMinute: 10_000,
      g5SteadyInvocationsPerMinute: 2,
    },
    policy: {
      rollingEgressHaltBytes: SUPABASE_REVISION4_ROLLING_EGRESS_HALT_BYTES,
      rollingWindowMinutes: SUPABASE_REVISION4_ROLLING_WINDOW_MINUTES,
      steadyRequiredLedgersPerMinute: SUPABASE_REVISION4_REQUIRED_LEDGERS_PER_MINUTE,
      catchupMinimumLedgersPerMinute:
        SUPABASE_REVISION4_MINIMUM_CATCHUP_LEDGERS_PER_MINUTE,
      invocationHalt: SUPABASE_REVISION4_INVOCATION_HALT,
      memoryHaltBytes: SUPABASE_REVISION4_MEMORY_HALT_BYTES,
      claimCapLedgers: SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
      minimumConsecutiveMinutes: SUPABASE_REVISION4_MINIMUM_CATCHUP_MINUTES,
    },
    minutes: Array.from({ length: 6 }, (_, index) => {
      const sourceHeadStartLedgerIndex = 4_200_100 + index * 21
      const committedWatermarkStartLedgerIndex = 4_200_000 + index * 30
      return {
        minuteStart: `2026-08-07T07:0${index}:00.000Z`,
        sourceHeadStartLedgerIndex,
        sourceHeadEndLedgerIndex: sourceHeadStartLedgerIndex + 21,
        committedWatermarkStartLedgerIndex,
        committedWatermarkEndLedgerIndex: committedWatermarkStartLedgerIndex + 30,
        committedLedgers: 30,
        invocationCount: 3,
        applicationBillableEgressUpperBoundBytes: 20_000,
        maximumPeakMemoryBytes: 80_000_000,
        maximumClaimLedgers: 12,
        accountingDigests: [SHA_D],
        committed: true,
        parentHashContinuityVerified: true,
        duplicateLedgerCount: 0,
        skippedLedgerCount: 0,
      }
    }),
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

describe('Supabase revision-4 G6 moving-head catch-up convergence', () => {
  it('accepts bounded moving-head evidence that reduces backlog under fixed guards', () => {
    const result = verifySupabaseRevision4CatchupConvergence(qualifyingInput())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.minimumCommittedLedgersPerMinute).toBe(30)
    expect(result.machineSummary.minimumSourceHeadAdvancePerMinute).toBe(21)
    expect(result.machineSummary.minimumBacklogReductionPerMinute).toBe(9)
    expect(result.machineSummary.initialBacklogLedgers).toBe(100)
    expect(result.machineSummary.finalBacklogLedgers).toBe(46)
    expect(result.machineSummary.projectedCatchupMinutes).toBe(12)
    expect(result.machineSummary.movingHeadSequenceVerified).toBe(true)
    expect(result.machineSummary.watermarkContinuityVerified).toBe(true)
    expect(result.machineSummary.backlogConvergenceVerified).toBe(true)
  })

  it('rejects static-head evidence even when committed throughput is high', () => {
    const input = qualifyingInput()
    input.minutes[0].sourceHeadEndLedgerIndex = input.minutes[0].sourceHeadStartLedgerIndex

    const result = verifySupabaseRevision4CatchupConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('source_head_not_advancing:minute_0')
  })

  it('rejects throughput that does not reduce backlog faster than the moving head', () => {
    const input = qualifyingInput()
    for (const [index, minute] of input.minutes.entries()) {
      minute.sourceHeadStartLedgerIndex = 4_200_100 + index * 30
      minute.sourceHeadEndLedgerIndex = minute.sourceHeadStartLedgerIndex + 30
    }

    const result = verifySupabaseRevision4CatchupConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('backlog_not_decreasing:minute_0')
    expect(result.blockingReasons).toContain('catchup_not_faster_than_head:minute_0')
  })

  it('rejects invocation evidence that cannot cover the retained ledger count', () => {
    const input = qualifyingInput()
    input.minutes[0].invocationCount = 2

    const result = verifySupabaseRevision4CatchupConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'invocation_count_below_claim_coverage:minute_0',
    )
  })

  it('requires G3 and G5 before G6 can qualify', () => {
    const input = qualifyingInput()
    input.prerequisites.g3ProviderReconciliationPassed = false
    input.prerequisites.g5SteadyConvergencePassed = false

    const result = verifySupabaseRevision4CatchupConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('g3_provider_reconciliation_not_passed')
    expect(result.blockingReasons).toContain('g5_steady_convergence_not_passed')
  })

  it('rejects catch-up evidence whose rolling blend would hit the fixed egress halt', () => {
    const input = qualifyingInput()
    input.prerequisites.g5SteadyBillableEgressUpperBoundBytesPerMinute = 100_000

    const result = verifySupabaseRevision4CatchupConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('rolling_egress_halt_reached')
  })
})
