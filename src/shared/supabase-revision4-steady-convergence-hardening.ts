import {
  SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  type SupabaseRevision4SteadyConvergenceInput,
  type SupabaseRevision4SteadyConvergenceResult,
  verifySupabaseRevision4SteadyConvergence as verifyBaseSteadyConvergence,
} from './supabase-revision4-steady-convergence'

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) {
    reasons.push(reason)
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function isUtcMinuteBoundary(value: string): boolean {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp % 60_000 === 0
}

function minimumInvocationsForMinute(
  committedLedgers: number,
  maximumClaimLedgers: number,
): number | null {
  if (
    !isPositiveSafeInteger(committedLedgers)
    || !isPositiveSafeInteger(maximumClaimLedgers)
  ) {
    return null
  }

  const effectiveMaximumClaimLedgers = Math.min(
    maximumClaimLedgers,
    SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  )
  return Math.ceil(committedLedgers / effectiveMaximumClaimLedgers)
}

export function verifySupabaseRevision4SteadyConvergence(
  input: SupabaseRevision4SteadyConvergenceInput,
): SupabaseRevision4SteadyConvergenceResult {
  const baseResult = verifyBaseSteadyConvergence(input)
  const blockingReasons = [...baseResult.blockingReasons]

  for (const [index, minute] of input.minutes.entries()) {
    const sampleId = `minute_${index}`

    if (!isUtcMinuteBoundary(minute.minuteStart)) {
      addReason(blockingReasons, `minute_not_utc_boundary:${sampleId}`)
    }

    const minimumInvocations = minimumInvocationsForMinute(
      minute.committedLedgers,
      minute.maximumClaimLedgers,
    )
    if (
      minimumInvocations !== null
      && isPositiveSafeInteger(minute.invocationCount)
      && minute.invocationCount < minimumInvocations
    ) {
      addReason(
        blockingReasons,
        `invocation_count_below_claim_coverage:${sampleId}`,
      )
    }
  }

  return {
    ...baseResult,
    proofReady: blockingReasons.length === 0,
    blockingReasons,
  }
}

export type {
  SupabaseRevision4SteadyConvergenceInput,
  SupabaseRevision4SteadyConvergenceResult,
} from './supabase-revision4-steady-convergence'
