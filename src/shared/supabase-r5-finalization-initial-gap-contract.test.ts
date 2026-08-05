import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805145500_xrpl_r5_bound_initial_finalization_gap.sql',
)
const source = read(
  'supabase/migrations/20260804161000_xrpl_r5_finalize_burst_boundary.sql',
)

const oldInitialBound =
  'or v_watermark_before.ledger_index\n      > v_run_before.current_watermark_ledger_index + 24 then'
const newInitialBound =
  'or v_watermark_before.ledger_index\n      > v_run_before.current_watermark_ledger_index + 256 then'
const retainedDrainBound =
  "or (v_boundary->'watermarkAfter'->>'ledgerIndex')::bigint\n      > v_watermark_before.ledger_index + 24 then"
const retainedFinalBound =
  'or v_watermark_after.ledger_index > v_watermark_before.ledger_index + 24'

describe('R5 finalization initial-gap bounded repair', () => {
  it('patches only the initial pre-drain bound from 24 to 256', () => {
    expect(source).toContain(oldInitialBound)
    expect(source).not.toContain(newInitialBound)
    expect(source).toContain(retainedDrainBound)
    expect(source).toContain(retainedFinalBound)

    for (const required of [
      "policy_id = 'r5-finalization-initial-gap-256-v1'",
      'prior_initial_gap_bound = 24',
      'initial_gap_bound = 256',
      'drain_advance_bound = 24',
      "E'or v_watermark_before.ledger_index\\n      > v_run_before.current_watermark_ledger_index + 24 then'",
      "E'or v_watermark_before.ledger_index\\n      > v_run_before.current_watermark_ledger_index + 256 then'",
      'v_patched_definition := replace(v_definition, v_old, v_new)',
      'execute v_patched_definition',
      'v_old_count <> 1',
      'v_new_count <> 0',
      'v_old_count <> 0',
      'v_new_count <> 1',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains both post-drain 24-ledger bounds exactly', () => {
    for (const required of [
      "E'or (v_boundary->''watermarkAfter''->>''ledgerIndex'')::bigint\\n      > v_watermark_before.ledger_index + 24 then'",
      "'or v_watermark_after.ledger_index > v_watermark_before.ledger_index + 24'",
      'position(v_retained_drain_bound in v_definition) = 0',
      'position(v_retained_final_bound in v_definition) = 0',
      'position(v_retained_drain_bound in v_patched_definition) = 0',
      'position(v_retained_final_bound in v_patched_definition) = 0',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds production application to the exact stopped R5 state', () => {
    for (const required of [
      "run_id = 'r5-recovery-selected-revision3-entry'",
      "v_run.status <> 'running'",
      "v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'",
      'v_run.profile_revision <> 3',
      "v_run.source_profile_id <> 'supabase-devnet'",
      "v_run.network <> 'devnet'",
      "v_run.epoch_id <> 'supabase-r4c2c-v1'",
      'v_run.current_watermark_ledger_index <> 4138491',
      'v_run.last_error is not null',
      'v_run.completed_at is not null',
      'v_observed_gap < 25 or v_observed_gap > 256',
      "status in ('leased', 'halted')",
      'v_active_batch_count <> 0',
      'r5_finalization_initial_gap_outside_bounded_repair',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('records the exact evidence chain and source definition digests', () => {
    for (const required of [
      'source_finalization_failure_run_id = 31018077125',
      'source_claim_cap_verification_run_id = 31012179441',
      "source_commit = '2e6e7ca71784c9402cced7f0d21eecd86d5e99ef'",
      'source_recovery_watermark_ledger_index = 4138491',
      'observed_production_gap between 25 and 256',
      'pg_get_functiondef(v_signature)',
      'prior_definition_sha256',
      'patched_definition_sha256',
      "extensions.digest(convert_to(v_definition, 'UTF8'), 'sha256')",
      "extensions.digest(convert_to(v_patched_definition, 'UTF8'), 'sha256')",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps release and public-reader boundaries closed', () => {
    for (const required of [
      'public_reader_unchanged boolean not null check (public_reader_unchanged)',
      'mainnet_disabled boolean not null check (mainnet_disabled)',
      'stabilization_authorized boolean not null check (not stabilization_authorized)',
      'soak_authorized boolean not null check (not soak_authorized)',
      'v_policy.public_reader_unchanged is not true',
      'v_policy.mainnet_disabled is not true',
      'v_policy.stabilization_authorized is not false',
      'v_policy.soak_authorized is not false',
    ]) {
      expect(migration).toContain(required)
    }

    for (const forbidden of [
      "MAINNET_ENABLED: 'true'",
      'stabilization_authorized,\n    true',
      'soak_authorized,\n    true',
      'update public.xrpl_phase_',
      'update xrpl_r5_v1.recovery_runs',
      'insert into xrpl_r5_v1.recovery_batches',
      'delete from',
      'truncate ',
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
