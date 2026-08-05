import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationPath =
  'supabase/migrations/20260806015000_xrpl_r5_atomic_running_preclaim_boundary.sql'
const migration = readFileSync(resolve(process.cwd(), migrationPath), 'utf8')

describe('R5 atomic running preclaim boundary', () => {
  it('binds the repair to the exact failed burst and successful V2 diagnostic', () => {
    for (const required of [
      "policy_id = 'r5-atomic-running-preclaim-boundary-v1'",
      'source_failed_burst_run_id = 31021223140',
      'source_diagnostic_run_id = 31027674759',
      "source_commit = '08e8a35656e9870bfa7aee6eb9dad3d1668b7ad2'",
      'minimum_observed_recovery_watermark = 4138667',
      'observed_physical_gap between 0 and 256',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('patches only the running wrapper branch by exact source replacement', () => {
    for (const required of [
      'v_old_declaration constant text',
      'v_new_declaration constant text',
      'v_old_branch constant text',
      'v_new_branch constant text',
      'v_old_declaration_count <> 1',
      'v_new_declaration_count <> 0',
      'v_old_branch_count <> 1',
      'v_new_branch_count <> 0',
      'r5_atomic_preclaim_source_definition_drift',
      'r5_atomic_preclaim_patch_order_invalid',
      'r5_atomic_preclaim_patch_verification_failed',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('drains and adopts before the base claim in the same function transaction', () => {
    const adoption =
      'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
    const refresh = 'select * into v_run'
    const claim = 'v_claim := public.xrpl_claim_r5_active_recovery_batch('

    expect(migration).toContain(adoption)
    expect(migration).toContain("'reason'', ''atomic_running_preclaim_boundary''")
    expect(migration).toContain("'pendingScanLockHeldThroughClaim'', true")
    expect(migration).toContain("'noScanExecutedBeforeClaim'', true")
    expect(migration.indexOf(adoption)).toBeLessThan(
      migration.lastIndexOf(refresh),
    )
    expect(migration.indexOf(adoption)).toBeLessThan(
      migration.indexOf(claim),
    )
  })

  it('keeps prepared-state rebind and the twelve-ledger base claim intact', () => {
    for (const required of [
      "if v_run.status = 'prepared' then",
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;',
      'twelve_ledger_claim_cap_retained',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains fixed safety and authorization boundaries', () => {
    for (const required of [
      'database_halt_bytes = 400000000',
      '400000000,',
      'public_reader_unchanged',
      'mainnet_disabled',
      'stabilization_authorized',
      'soak_authorized',
      'from public, anon, authenticated',
      'to service_role',
    ]) {
      expect(migration).toContain(required)
    }

    for (const forbidden of [
      '400000001',
      "MAINNET_ENABLED: 'true'",
      'stabilization_authorized,\n    true',
      'soak_authorized,\n    true',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(\n  text, text, timestamptz, integer\n) to anon',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(\n  text, text, timestamptz, integer\n) to authenticated',
    ]) {
      expect(migration).not.toContain(forbidden)
    }
  })

  it('does not execute a scan or the repaired claim during migration', () => {
    expect(migration).not.toContain(
      'perform public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    )
    expect(migration).not.toContain(
      'select public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    )
    expect(migration).not.toContain('xrplRpc')
    expect(migration).not.toContain('ledger_entry')
  })
})
