import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803103000_xrpl_revision3_attempt_lifecycle.sql',
)
const guard = read('supabase/functions/xrpl-resource-headroom-guard/index.ts')

describe('Supabase revision-3 attempt lifecycle contract', () => {
  it('retains one deterministic attempt reservation per guarded session minute', () => {
    for (const required of [
      'create table if not exists xrpl_resource_guard_v2.attempts',
      "status text not null check (status in ('open', 'succeeded', 'failed', 'deferred'))",
      'reserved_egress_upper_bound_bytes = 134217728',
      'unique (session_id, scheduled_minute)',
      'create or replace function public.xrpl_begin_revision3_attempt',
      "v_scheduled_minute := date_trunc('minute', p_scheduled_at)",
      "pg_advisory_xact_lock(hashtextextended('xrpl-r4c3-attempt-' || p_session_id, 0))",
      "v_session.status <> 'running'",
      'not v_session.resource_guard_enabled',
      "where session_id = p_session_id\n    and scheduled_minute = v_scheduled_minute",
      "'replayed', true",
    ]) expect(migration).toContain(required)
  })

  it('counts open, failed, and deferred attempts at the full crash reservation', () => {
    for (const required of [
      'create or replace function xrpl_resource_guard_v2.attempt_effective_egress',
      "when p_status = 'succeeded' then p_finalized",
      'else p_reserved',
      "started_at >= p_started_at - interval '31 days'",
      'v_prior_egress := greatest(v_attempt_egress, v_legacy_egress)',
      'v_prior_egress + v_reserved >= v_egress_halt',
      "then 'revision3_attempt_monthly_egress_halt'",
      "'openAttemptCountsAtFullReservation', true",
      "'crashCannotRemoveReservation', true",
      "'providerEgressCounterClaimed', false",
    ]) expect(migration).toContain(required)
  })

  it('reserves both wrapper and downstream invocations before network execution', () => {
    for (const required of [
      'v_prior_invocations := greatest(v_provider_invocations, v_attempt_count * 2)',
      'v_projected_invocations := greatest(v_provider_invocations, (v_attempt_count + 1) * 2)',
      'v_projected_invocations >= v_invocation_halt',
      "then 'revision3_attempt_monthly_invocation_halt'",
      "'twoFunctionInvocationsReserved', true",
      "greatest(v_provider_invocations, (v_attempt_count + 1) * 2 - 1)",
    ]) expect(migration).toContain(required)
  })

  it('shrinks only a successful attempt to its safe accounted egress bound', () => {
    for (const required of [
      'create or replace function public.xrpl_finalize_revision3_attempt',
      "p_status not in ('succeeded', 'failed', 'deferred')",
      "if p_status = 'succeeded' then",
      'p_finalized_egress_upper_bound_bytes >= 33554432',
      "when v_target_status = 'succeeded' then p_accounting_digest",
      "when v_target_status = 'succeeded' then null",
      "'succeededAttemptShrinksToAccountedUpperBound'",
      "'failedOrDeferredAttemptRetainsFullReservation'",
      "'reservationNeverDeletedByFinalization', true",
    ]) expect(migration).toContain(required)
  })

  it('requires one open pre-network attempt in every guarded accounting context', () => {
    for (const required of [
      'create or replace function public.xrpl_read_revision3_accounting_context',
      "where session_id = v_tick.session_id\n      and scheduled_minute = v_tick.scheduled_minute",
      "v_current_attempt.status <> 'open'",
      "raise exception 'revision-3 guarded tick lacks one open pre-network attempt'",
      'v_attempt_egress - v_current_attempt.reserved_egress_upper_bound_bytes',
      "'guardedAttemptReservedBeforeNetwork'",
      "'openAttemptExcludedFromCurrentTickPriorEgress', true",
      "'openAndFailedAttemptsIncludedInRollingEgress', true",
      "'twoFunctionInvocationsReservedPerGuardedAttempt', true",
    ]) expect(migration).toContain(required)
  })

  it('begins the reservation before calling the steady executor and finalizes afterward', () => {
    const beginAt = guard.indexOf("'xrpl_begin_revision3_attempt'")
    const downstreamAt = guard.indexOf('/functions/v1/xrpl-steady-batch-tick')
    const finalizeAt = guard.indexOf("'xrpl_finalize_revision3_attempt'")

    expect(beginAt).toBeGreaterThan(0)
    expect(downstreamAt).toBeGreaterThan(beginAt)
    expect(finalizeAt).toBeGreaterThan(0)
    expect(guard).toContain(
      '`r4c3:${sessionId}:${Math.floor(scheduledAt.getTime() / 60_000)}`',
    )
    expect(guard).toContain("status: 'succeeded'")
    expect(guard).toContain("status: deferred ? 'deferred' : 'failed'")
    expect(guard).toContain("status: 'failed'")
    expect(guard).toContain('result.conservativeTickEgressUpperBoundBytes')
    expect(guard).toContain('revision3 accounting digest')
  })

  it('keeps the full reservation when the downstream call throws or lacks safe accounting', () => {
    expect(guard).toContain('successful guarded tick lacks one safe revision-3 accounting result')
    expect(guard).toContain('finalizedEgressUpperBoundBytes: null')
    expect(guard).toContain('accountingDigest: null')
    expect(guard).toContain('attemptFinalization')
    expect(guard).toContain('revision3_attempt_reservation_halt')
  })
})
