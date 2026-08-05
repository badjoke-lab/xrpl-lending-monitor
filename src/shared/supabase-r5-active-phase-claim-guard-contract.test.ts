import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805153000_xrpl_r5_block_active_phase_claims.sql',
)
const originalClaim = read(
  'supabase/migrations/20260802104200_xrpl_guarded_phase_claim.sql',
)
const accounting = read('src/shared/supabase-revision3-resource-accounting.ts')

describe('R5 active phase claim ownership guard', () => {
  it('patches the exact generic phase claim function without replacing unrelated logic', () => {
    for (const required of [
      "'public.xrpl_claim_next_phase(text,timestamptz,integer)'",
      'select pg_get_functiondef(v_signature)',
      'v_declaration_old_count <> 1',
      'v_declaration_new_count <> 0',
      'v_guard_old_count <> 1',
      'v_guard_new_count <> 0',
      'execute v_patched_definition',
      "raise exception 'r5_active_phase_claim_guard_source_definition_drift'",
      "raise exception 'r5_active_phase_claim_guard_patch_verification_failed'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(originalClaim).toContain(
      'v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now)',
    )
    expect(migration).toContain(
      'v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now)',
    )
  })

  it('blocks the exact formal R5 owner before epoch activation or message claim', () => {
    for (const required of [
      "where run_id = 'r5-recovery-selected-revision3-entry'",
      "v_r5.profile_id <> 'supabase_free_postgres_pgcron_edge'",
      'v_r5.profile_revision <> 3',
      "v_r5.source_profile_id <> 'supabase-devnet'",
      "v_r5.network <> 'devnet'",
      "v_r5.epoch_id <> 'supabase-r4c2c-v1'",
      "v_r5.status not in ('prepared', 'running', 'caught_up', 'halted')",
      "raise exception 'r5_active_recovery_phase_claim_identity_invalid'",
      "'claimed', false",
      "'reason', 'r5_active_recovery_owned'",
      "'r5WatermarkLedgerIndex', v_r5.current_watermark_ledger_index",
    ]) {
      expect(migration).toContain(required)
    }

    const guardIndex = migration.indexOf("'reason', 'r5_active_recovery_owned'")
    const activationIndex = migration.lastIndexOf(
      'v_epoch := public.xrpl_ensure_remote_seven_class_epoch(p_now)',
    )
    expect(guardIndex).toBeGreaterThan(-1)
    expect(activationIndex).toBeGreaterThan(guardIndex)
  })

  it('freezes a no-scan physical boundary before installing the production guard', () => {
    for (const required of [
      "hashtextextended('xrpl-r5-active-recovery', 0)",
      "v_run.status <> 'running'",
      'lock table public.xrpl_collector_runtime in share row exclusive mode',
      'lock table public.xrpl_phase_messages in share row exclusive mode',
      'lock table public.xrpl_phase_work in share row exclusive mode',
      'lock table public.xrpl_phase_watermarks in share row exclusive mode',
      "public.xrpl_drain_r5_checkpoint_boundary(\n      'r5-install-active-phase-claim-guard'",
      "'collectorQuiescent'",
      "'activeStreamHealthy'",
      "'noScanExecuted'",
      "'onePendingScan'",
      "'pendingScanBoundToWatermark'",
      "'noInflightWork'",
      "raise exception 'r5_active_phase_claim_guard_boundary_invalid'",
      "raise exception 'r5_active_phase_claim_guard_watermark_invalid'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('records the exact failed proof evidence and boundary delta', () => {
    for (const required of [
      "policy_id = 'r5-active-phase-claim-guard-v1'",
      'source_claim_cap_verification_run_id = 31012179441',
      'source_first_drift_run_id = 31014360049',
      'source_second_drift_run_id = 31015285563',
      "source_commit = '328395146157988d438295a6777d235d34ea9726'",
      'existing_recovery_found boolean not null',
      'recovery_watermark_ledger_index bigint',
      'physical_watermark_ledger_index bigint',
      'watermark_delta bigint',
      'watermark_delta >= 0',
      'boundary jsonb',
      'prior_definition_sha256',
      'patched_definition_sha256',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps resource limits and release boundaries unchanged', () => {
    expect(accounting).toContain('projectMemoryHaltBytes: 224 * MIB')
    expect(accounting).toContain('providerMemoryHardBytes: 256 * MIB')
    expect(accounting).toContain('projectEgressHalt31dBytes: 4 * GIB')
    expect(accounting).toContain('projectInvocationHalt31d: 400_000')

    for (const required of [
      'revoke all on table xrpl_r5_v1.active_phase_claim_guard_changes',
      'from public, anon, authenticated',
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
      'public_reader_unchanged boolean not null check (public_reader_unchanged)',
      'mainnet_disabled boolean not null check (mainnet_disabled)',
      'stabilization_authorized boolean not null check (not stabilization_authorized)',
      'soak_authorized boolean not null check (not soak_authorized)',
    ]) {
      expect(migration).toContain(required)
    }

    expect(migration).not.toContain('projectMemoryHaltBytes')
    expect(migration).not.toContain('databaseHaltBytes')
    expect(migration).not.toContain('MAINNET_ENABLED')
  })
})
