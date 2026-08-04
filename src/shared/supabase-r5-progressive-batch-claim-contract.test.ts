import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803123700_xrpl_r5_progressive_batch_claim.sql',
)

describe('R5 progressive recovery batch claim contract', () => {
  it('reads and validates the durable recovery state before deciding on rebind', () => {
    const stateRead = migration.indexOf(
      'select * into v_run\n  from xrpl_r5_v1.recovery_runs',
    )
    const rebindCall = migration.indexOf(
      'v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
    )
    expect(stateRead).toBeGreaterThanOrEqual(0)
    expect(rebindCall).toBeGreaterThan(stateRead)

    for (const required of [
      'supabase_free_postgres_pgcron_edge',
      'v_run.profile_revision <> 3',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
      "v_run.source_profile_id <> 'supabase-devnet'",
      "v_run.network <> 'devnet'",
      "v_run.epoch_id <> 'supabase-r4c2c-v1'",
      'v_run.batch_size <> 24',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('returns terminal recovery states without attempting a zero-progress rebind', () => {
    const caughtUp = migration.indexOf("if v_run.status = 'caught_up' then")
    const halted = migration.indexOf("if v_run.status = 'halted' then")
    const prepared = migration.indexOf("if v_run.status = 'prepared' then")
    const rebindCall = migration.indexOf(
      'v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
    )
    expect(caughtUp).toBeGreaterThanOrEqual(0)
    expect(halted).toBeGreaterThan(caughtUp)
    expect(prepared).toBeGreaterThan(halted)
    expect(rebindCall).toBeGreaterThan(prepared)
    expect(migration).toContain("'reason', 'terminal_recovery_state'")
  })

  it('retains the strict rebind only for a prepared zero-progress run', () => {
    for (const required of [
      "if v_run.status = 'prepared' then",
      'v_run.completed_batches <> 0',
      'v_run.committed_ledgers <> 0',
      'v_run.last_accounting_digest is not null',
      'v_run.last_error is not null',
      'v_run.started_at is not null',
      'v_run.completed_at is not null',
      'r5_recovery_prepared_state_progress_invalid',
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'r5_recovery_prepared_state_changed_during_rebind',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('skips prebatch rebind after the first atomic batch has committed', () => {
    const rebindNeedle =
      'v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary('
    const rebindCall = migration.indexOf(rebindNeedle)
    const runningGuard = migration.indexOf('v_run.completed_batches < 1')
    const progressReason = migration.indexOf("'reason', 'recovery_progress_present'")
    const baseClaim = migration.indexOf(
      'v_claim := public.xrpl_claim_r5_active_recovery_batch(',
    )

    expect(rebindCall).toBeGreaterThanOrEqual(0)
    expect(migration.lastIndexOf(rebindNeedle)).toBe(rebindCall)
    expect(runningGuard).toBeGreaterThan(rebindCall)
    expect(progressReason).toBeGreaterThan(runningGuard)
    expect(baseClaim).toBeGreaterThan(progressReason)

    for (const required of [
      'v_run.completed_batches < 1',
      'v_run.committed_ledgers < 1',
      'v_run.last_accounting_digest is null',
      'v_run.started_at is null',
      'r5_recovery_running_progress_invalid',
      "'prebatchRebindSkippedAfterProgress', true",
      "'completedBatches', v_run.completed_batches",
      "'committedLedgers', v_run.committed_ledgers",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('preserves retained-head reservation and all later safety boundaries', () => {
    for (const required of [
      "'fresh_head_refresh_required'",
      'v_run.initial_validated_head_ledger_index',
      'v_run.initial_validated_head_ledger_hash',
      'public.xrpl_claim_r5_active_recovery_batch(',
      "'networkReadOccurredBeforeReservation', false",
      "'reservationBeforeAnyNetworkRead', true",
      "'freshHeadMustCoverReservedEndBeforeFetch', true",
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationNotStarted', true",
      "'soakNotStarted', true",
      "'prebatchRebind', v_rebind",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains the exact trusted signature without destructive SQL', () => {
    for (const required of [
      'revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      ') from public, anon, authenticated;',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      ') to service_role;',
      "rolname = 'supabase_admin'",
    ]) {
      expect(migration).toContain(required)
    }
    for (const forbidden of ['cascade', 'delete from', 'truncate ', 'drop table']) {
      expect(migration.toLowerCase()).not.toContain(forbidden)
    }
  })
})
