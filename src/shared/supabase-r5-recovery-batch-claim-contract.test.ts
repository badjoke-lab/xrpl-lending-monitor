import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803123000_xrpl_r5_recovery_batch_claim.sql',
  ),
  'utf8',
)

describe('R5 active recovery batch claim contract', () => {
  it('binds every batch to the selected revision-3 profile and R5 run', () => {
    for (const required of [
      'create table if not exists xrpl_r5_v1.recovery_batches',
      "profile_id = 'supabase_free_postgres_pgcron_edge'",
      'profile_revision = 3',
      "profile_identity_digest = '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      "selection_digest = '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'",
      'ledger_count between 1 and 24',
      'end_ledger_index = start_ledger_index + ledger_count - 1',
      'create unique index if not exists xrpl_r5_one_leased_batch_per_run_idx',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires a quiescent active boundary before reserving recovery work', () => {
    for (const required of [
      "v_runtime.status <> 'stopped'",
      "v_stream.status <> 'active'",
      "where profile_id = 'supabase-devnet'",
      'v_watermark.ledger_index <> v_run.current_watermark_ledger_index',
      'v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash',
      'v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0',
      "v_pending_scan.phase <> 'scan'",
      "status in ('planned', 'staged', 'committing', 'finalizing')",
      "raise exception 'r5_recovery_batch_inflight_work_present'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('reserves conservative quota before any downstream fetch or active mutation', () => {
    for (const required of [
      'v_reserved constant bigint := 134217728',
      'v_egress_halt constant bigint := 4294967296',
      'v_invocation_halt constant bigint := 400000',
      "v_provider_observed_at < p_now - interval '25 hours'",
      'v_prior_egress + v_reserved >= v_egress_halt',
      'v_projected_invocations >= v_invocation_halt',
      "then 'r5_recovery_monthly_egress_halt'",
      "else 'r5_recovery_monthly_invocation_halt'",
      "'reservationBeforeNetworkFetch', true",
      "'openOrFailedBatchRetainsFullReservation', true",
    ]) {
      expect(migration).toContain(required)
    }

    expect(migration).not.toContain('insert into public.xrpl_phase_work')
    expect(migration).not.toContain('insert into public.xrpl_phase_messages')
    expect(migration).not.toContain('insert into public.xrpl_phase_watermarks')
    expect(migration).not.toContain('update public.xrpl_phase_work')
    expect(migration).not.toContain('update public.xrpl_phase_messages')
    expect(migration).not.toContain('update public.xrpl_phase_watermarks')
  })

  it('supports exact lease replay while retaining failed reservations', () => {
    for (const required of [
      "where run_id = v_run.run_id and status = 'leased'",
      "'reason', 'batch_lease_active'",
      "'reclaimed', true",
      'attempt_count = attempt_count + 1',
      'create or replace function public.xrpl_fail_r5_active_recovery_batch',
      "set status = 'halted'",
      "'reservationRetainedAfterFailure', true",
      "'activeTablesNotMutatedByFailureFinalization', true",
      "'recoveryRunHalted', true",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps public-reader, Mainnet, stabilization, and soak boundaries closed', () => {
    for (const required of [
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationNotStarted', true",
      "'soakNotStarted', true",
      'from public, anon, authenticated',
      'to service_role',
    ]) {
      expect(migration).toContain(required)
    }
  })
})
