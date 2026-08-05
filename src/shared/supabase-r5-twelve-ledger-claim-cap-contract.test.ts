import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805134500_xrpl_r5_cap_future_claims_at_twelve.sql',
)
const originalClaim = read(
  'supabase/migrations/20260803123000_xrpl_r5_recovery_batch_claim.sql',
)
const accounting = read('src/shared/supabase-revision3-resource-accounting.ts')

const oldAssignment =
  'v_count := least(24::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'
const newAssignment =
  'v_count := least(12::bigint, p_validated_head_ledger_index - v_watermark.ledger_index)::integer;'

describe('R5 twelve-ledger future claim cap', () => {
  it('patches only the exact historical twenty-four-ledger claim assignment', () => {
    expect(originalClaim).toContain(oldAssignment)
    expect(migration).toContain(`v_old constant text :=\n    '${oldAssignment}'`)
    expect(migration).toContain(`v_new constant text :=\n    '${newAssignment}'`)
    expect(migration).toContain('select pg_get_functiondef(v_signature)')
    expect(migration).toContain('v_old_count <> 1 or v_new_count <> 0')
    expect(migration).toContain('v_old_count <> 0 or v_new_count <> 1')
    expect(migration).toContain('execute v_patched_definition')
  })

  it('binds the patch to the exact recovery function signature', () => {
    expect(migration).toContain(
      "'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamptz,integer)'",
    )
    expect(migration).toContain(
      "raise exception 'r5_twelve_ledger_claim_cap_function_missing'",
    )
    expect(migration).toContain(
      "raise exception 'r5_twelve_ledger_claim_cap_source_definition_drift'",
    )
    expect(migration).toContain(
      "raise exception 'r5_twelve_ledger_claim_cap_patch_verification_failed'",
    )
  })

  it('refuses to change the claim policy while an active batch is leased or halted', () => {
    for (const required of [
      "run.status in ('prepared', 'running')",
      "batch.status in ('leased', 'halted')",
      'v_active_batch_count <> 0',
      "raise exception 'r5_twelve_ledger_claim_cap_active_batch_present'",
      "hashtextextended('xrpl-r5-active-recovery', 0)",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('records the exact failure and adoption evidence without changing profile identity', () => {
    for (const required of [
      "policy_id = 'r5-claim-cap-12-v1'",
      "profile_id = 'supabase_free_postgres_pgcron_edge'",
      'profile_revision = 3',
      'nominal_batch_size = 24',
      'prior_claim_cap = 24',
      'claim_cap = 12',
      'source_memory_halt_run_id = 30987685290',
      'source_watermark_drift_run_id = 30991245747',
      'source_adoption_verification_run_id = 30992583324',
      "source_commit = '52ebc396f7c5217ae06e595aabe2053440f1076a'",
      'prior_definition_sha256',
      'patched_definition_sha256',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps the existing resource halts unchanged', () => {
    expect(accounting).toContain('projectMemoryHaltBytes: 224 * MIB')
    expect(accounting).toContain('providerMemoryHardBytes: 256 * MIB')
    expect(accounting).toContain('projectEgressHalt31dBytes: 4 * GIB')
    expect(accounting).toContain('projectInvocationHalt31d: 400_000')

    expect(migration).not.toContain('projectMemoryHaltBytes')
    expect(migration).not.toContain('databaseHaltBytes')
    expect(migration).not.toContain('projectEgressHalt31dBytes')
    expect(migration).not.toContain('projectInvocationHalt31d')
  })

  it('keeps all release boundaries fail closed', () => {
    for (const required of [
      'revoke all on table xrpl_r5_v1.batch_claim_policy_changes',
      'from public, anon, authenticated',
      'public_reader_unchanged boolean not null check (public_reader_unchanged)',
      'mainnet_disabled boolean not null check (mainnet_disabled)',
      'stabilization_authorized boolean not null check (not stabilization_authorized)',
      'soak_authorized boolean not null check (not soak_authorized)',
      "raise exception 'r5_twelve_ledger_claim_cap_post_state_invalid'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('mainnet_disabled,\n    false')
    expect(migration).not.toContain('stabilization_authorized,\n    true')
    expect(migration).not.toContain('soak_authorized,\n    true')
  })
})
