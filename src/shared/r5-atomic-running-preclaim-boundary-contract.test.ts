import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migrationPath =
  'supabase/migrations/20260806015000_xrpl_r5_atomic_running_preclaim_boundary.sql'
const migration = readFileSync(resolve(process.cwd(), migrationPath), 'utf8')

describe('R5 atomic running preclaim boundary', () => {
  it('binds the repair to the exact production evidence chain', () => {
    for (const required of [
      "policy_id = 'r5-atomic-running-preclaim-boundary-v1'",
      'source_failed_burst_run_id = 31021223140',
      'source_diagnostic_run_id = 31027674759',
      'source_failed_migration_run_id = 31029262492',
      "source_commit = '08e8a35656e9870bfa7aee6eb9dad3d1668b7ad2'",
      '4bc44edfecfa5575f11c6821662c74a464237a3f554bc7516e684cc5eb1a7311',
      'minimum_observed_recovery_watermark = 4138667',
      'observed_physical_gap between 0 and 256',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('patches only the variable declaration and stable base-claim anchor', () => {
    for (const required of [
      'v_old_declaration constant text',
      'v_new_declaration constant text',
      'v_claim_anchor constant text',
      'v_atomic_block constant text',
      'v_old_declaration_count <> 1',
      'v_new_declaration_count <> 0',
      'v_claim_anchor_count <> 1',
      'v_atomic_marker_count <> 0',
      'replace(v_definition, v_old_declaration, v_new_declaration)',
      'v_atomic_block || v_claim_anchor',
      'stable_claim_anchor_insertion',
      'r5_atomic_preclaim_source_definition_drift',
      'r5_atomic_preclaim_patch_order_invalid',
      'r5_atomic_preclaim_patch_verification_failed',
    ]) {
      expect(migration).toContain(required)
    }

    expect(migration).not.toContain('v_old_branch constant text')
    expect(migration).not.toContain('v_new_branch constant text')
  })

  it('preserves existing running controls and inserts drain/adoption immediately before claim', () => {
    const adoption =
      'v_preclaim_adoption := public.xrpl_adopt_r5_committed_active_descendants('
    const claimAnchor =
      "v_claim_anchor constant text :=\n    E'  v_claim := public.xrpl_claim_r5_active_recovery_batch(\\n';"

    for (const required of [
      adoption,
      claimAnchor,
      "'reason'', ''atomic_running_preclaim_boundary''",
      "'atomicBoundaryHeldThroughClaim'', true",
      "'pendingScanLockHeldThroughClaim'', true",
      "'noScanExecutedBeforeClaim'', true",
      "if v_run.status = ''running'' then",
      'r5_recovery_atomic_preclaim_adoption_invalid',
      'r5_recovery_atomic_preclaim_run_invalid',
    ]) {
      expect(migration).toContain(required)
    }

    expect(migration.indexOf(adoption)).toBeLessThan(
      migration.indexOf('v_atomic_block || v_claim_anchor'),
    )
  })

  it('retains the twelve-ledger cap and production definition digest guard', () => {
    for (const required of [
      'v_prior_sha256 <>',
      'r5_atomic_preclaim_production_definition_digest_drift',
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

  it('does not execute a scan or repaired claim during migration', () => {
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
