import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const wrapper = read(
  'supabase/migrations/20260803123500_xrpl_r5_prebatch_boundary_drain.sql',
)
const drain = read(
  'supabase/migrations/20260803122000_xrpl_r5_checkpoint_boundary_drain.sql',
)

describe('R5 prebatch boundary drain wrapper', () => {
  it('preserves the applied strict implementation under a private name', () => {
    for (const required of [
      'alter function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'rename to xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(',
    ]) {
      expect(wrapper).toContain(required)
    }
    expect(wrapper.indexOf('rename to xrpl_rebind')).toBeLessThan(
      wrapper.indexOf('create or replace function public.xrpl_rebind'),
    )
  })

  it('drains the existing commit or finalize boundary before strict rebind', () => {
    const drainCall = wrapper.indexOf(
      'v_drain := public.xrpl_drain_r5_checkpoint_boundary(',
    )
    const strictCall = wrapper.indexOf(
      'v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(',
    )
    expect(drainCall).toBeGreaterThanOrEqual(0)
    expect(strictCall).toBeGreaterThan(drainCall)
    for (const required of [
      "'r5-prebatch-rebind'",
      "hashtextextended('xrpl-r5-active-recovery', 0)",
      'v_drained_step_count :=',
      'v_drained_step_count < 0',
      'v_drained_step_count > 256',
      'p_now + make_interval(secs => v_drained_step_count + 1)',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('accepts only the complete trusted drain result', () => {
    for (const required of [
      "(v_drain->>'drained')::boolean",
      "v_drain->'checks'->>'collectorQuiescent'",
      "v_drain->'checks'->>'activeStreamHealthy'",
      "v_drain->'checks'->>'onlyExistingCommitOrFinalizeDrained'",
      "v_drain->'checks'->>'noScanExecuted'",
      "v_drain->'checks'->>'onePendingScan'",
      "v_drain->'checks'->>'pendingScanBoundToWatermark'",
      "v_drain->'checks'->>'noInflightWork'",
      "v_drain->'checks'->>'watermarkIdentityPreserved'",
      'r5_recovery_prebatch_boundary_drain_invalid',
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('inherits the exact scan binding and commit/finalize-only drain contract', () => {
    for (const required of [
      "if v_pending.phase = 'scan' then",
      "v_pending.payload->>'expectedPreviousLedgerIndex'",
      "v_pending.payload->>'expectedPreviousLedgerHash'",
      "v_pending.payload->>'network' <> v_stream.network",
      "v_pending.payload->>'epochId' <> v_stream.epoch_id",
      "v_pending.payload->>'baseIdentity' <> v_stream.base_identity",
      "if v_pending.phase not in ('commit', 'finalize') then",
      'r5_checkpoint_drain_unexpected_pending_phase',
      "'noScanExecuted', true",
      "'onlyExistingCommitOrFinalizeDrained', true",
    ]) {
      expect(drain).toContain(required)
    }
  })

  it('returns sanitized drain provenance without widening R5 gates', () => {
    for (const required of [
      "'prebatchBoundaryDrain', v_drain",
      "'boundaryDrainBeforeRebind', true",
      "'onlyExistingCommitOrFinalizeDrained', true",
      "'noScanExecutedBeforeRebind', true",
    ]) {
      expect(wrapper).toContain(required)
    }
    expect(wrapper).not.toContain('http')
    expect(wrapper).not.toContain('s.devnet')
    expect(wrapper).not.toContain('mainnet')
  })

  it('exposes only the wrapper to trusted remote callers', () => {
    for (const required of [
      'revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(',
      ') from public, anon, authenticated, service_role;',
      'revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      ') to service_role;',
      "revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text, timestamptz) from supabase_admin",
      "grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text, timestamptz) to supabase_admin",
    ]) {
      expect(wrapper).toContain(required)
    }
  })
})
