import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type SupabaseRevision4SteadyConvergenceInput,
  verifySupabaseRevision4SteadyConvergence as verifyBaseSteadyConvergence,
} from './supabase-revision4-steady-convergence'
import { verifySupabaseRevision4SteadyConvergence } from './supabase-revision4-steady-convergence-hardening'

const SHA_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const SHA_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

function qualifyingInput(
  secondOffset = 0,
): SupabaseRevision4SteadyConvergenceInput {
  const input = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-steady-convergence-synthetic.json',
      ),
      'utf8',
    ),
  ) as SupabaseRevision4SteadyConvergenceInput

  input.evidenceClass = 'bounded_steady_replay'
  input.evidenceId = 'r4f-g5-hardening-test'
  input.prerequisites = {
    g3ProviderReconciliationPassed: true,
    providerCaptureDigest: SHA_A,
    selectedUnexplainedDeltaReserveBytesPerMinute: 1_000,
    interventionReserveApproved: true,
    interventionReserveBytes: 100_000_000,
    interventionReserveRationaleDigest: SHA_B,
  }
  input.minutes = Array.from({ length: 6 }, (_, index) => ({
    minuteStart: `2026-08-07T05:0${index}:${String(secondOffset).padStart(2, '0')}.000Z`,
    startLedgerIndex: 4_200_000 + index * 21,
    endLedgerIndex: 4_200_020 + index * 21,
    committedLedgers: 21,
    invocationCount: 2,
    applicationBillableEgressUpperBoundBytes: 50_000,
    maximumPeakMemoryBytes: 80_000_000,
    maximumClaimLedgers: 12,
    accountingDigests: [SHA_A],
    committed: true,
    parentHashContinuityVerified: true,
    duplicateLedgerCount: 0,
    skippedLedgerCount: 0,
  }))

  return input
}

describe('Supabase revision-4 G5 verifier hardening', () => {
  it('preserves a fully aligned qualifying shape', () => {
    const result = verifySupabaseRevision4SteadyConvergence(qualifyingInput())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
  })

  it('rejects invocation counts that cannot cover committed ledgers under the claim cap', () => {
    const input = qualifyingInput()
    for (const minute of input.minutes) {
      minute.invocationCount = 1
    }

    expect(verifyBaseSteadyConvergence(input).proofReady).toBe(true)

    const result = verifySupabaseRevision4SteadyConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'invocation_count_below_claim_coverage:minute_0',
    )
  })

  it('rejects sixty-second sequences that are not aligned to UTC minute boundaries', () => {
    const input = qualifyingInput(30)

    expect(verifyBaseSteadyConvergence(input).proofReady).toBe(true)

    const result = verifySupabaseRevision4SteadyConvergence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('minute_not_utc_boundary:minute_0')
  })
})
