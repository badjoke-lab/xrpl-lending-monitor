import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const helperMigration = read(
  'supabase/migrations/20260805083000_xrpl_r5_retry_memory_halt_with_half_batch.sql',
)
const exactRepairMigration = read(
  'supabase/migrations/20260805083100_xrpl_r5_retry_memory_halt_assertion.sql',
)
const accounting = read('src/shared/supabase-revision3-resource-accounting.ts')

describe('R5 exact memory-halt half-batch retry', () => {
  it('binds the repair to the observed failed production boundary', () => {
    for (const required of [
      "'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'",
      "v_run.status <> 'halted'",
      'v_run.completed_batches <> 244',
      'v_run.committed_ledgers <> 5160',
      'v_run.current_watermark_ledger_index <> 4138467',
      "v_run.last_error\n        <> 'revision3_resource_halt:memory_upper_bound_halt'",
      'v_batch.batch_sequence <> 245',
      'v_batch.start_ledger_index <> 4138468',
      'v_batch.end_ledger_index <> 4138491',
      'v_batch.ledger_count <> 24',
      'v_batch.projected_conservative_egress_31d_bytes <> 3482266216',
      'v_batch.projected_invocations_31d <> 75795',
      'v_completed_count <> 244',
      'v_halted_count <> 1',
      'v_last_completed_end <> 4138467',
    ]) {
      expect(exactRepairMigration).toContain(required)
    }
  })

  it('retains the failed reservation and records one additional retry reservation', () => {
    for (const required of [
      'v_prior_egress := v_batch.projected_conservative_egress_31d_bytes',
      'v_prior_egress + v_batch.reserved_egress_upper_bound_bytes',
      'v_prior_invocations := v_batch.projected_invocations_31d',
      'v_projected_invocations := v_prior_invocations + 1',
      'v_prior_egress <> 3482266216',
      'v_projected_egress <> 3616483944',
      'v_projected_egress >= 4294967296',
      'v_prior_invocations <> 75795',
      'v_projected_invocations <> 75796',
      'v_projected_invocations >= 400000',
      'source_failed_burst_run_id, source_commit, reason',
      '30987685290',
      "'b4f267944bd076659b4c1db29208dcdc35eb532c'",
      "'revision3_resource_halt:memory_upper_bound_halt'",
      '24, 12',
    ]) {
      expect(exactRepairMigration).toContain(required)
    }
  })

  it('shrinks only batch 245 and preserves its identity for the existing retry claim', () => {
    for (const required of [
      'set end_ledger_index = 4138479',
      'ledger_count = 12',
      "set status = 'running'",
      'last_error = null',
      'and batch_sequence = v_run.completed_batches + 1',
      "and status = 'halted'",
      "and error_message = 'revision3_resource_halt:memory_upper_bound_halt'",
      "set status = 'leased'",
      'attempt_count = attempt_count + 1',
      "'sameBatchIdentityRetained', true",
      "'sameBatchSequenceRetained', true",
      'v_batch.ledger_count not in (1, 3, 6, 12)',
      "v_claim->>'reason' <> 'no_memory_retry'",
    ]) {
      const source = required.includes('4138479')
        || required === 'ledger_count = 12'
        || required === "set status = 'running'"
        || required === 'last_error = null'
        ? exactRepairMigration
        : helperMigration
      expect(source).toContain(required)
    }
  })

  it('asserts the exact post-state and removes the stale one-time scheduler', () => {
    for (const required of [
      "if not found then\n    return;",
      "v_run.status <> 'running'",
      'v_run.committed_ledgers <> 5160',
      'v_run.current_watermark_ledger_index <> 4138467',
      'v_batch.end_ledger_index <> 4138479',
      'v_batch.ledger_count <> 12',
      'v_batch.prior_conservative_egress_31d_bytes <> 3482266216',
      'v_batch.projected_conservative_egress_31d_bytes <> 3616483944',
      'v_batch.prior_invocations_31d <> 75795',
      'v_batch.projected_invocations_31d <> 75796',
      'v_retry.prior_ledger_count <> 24',
      'v_retry.retry_ledger_count <> 12',
      "raise exception 'r5_memory_retry_post_migration_state_invalid'",
      'drop function if exists public.xrpl_schedule_r5_memory_retry_half',
    ]) {
      expect(exactRepairMigration).toContain(required)
    }
  })

  it('does not relax revision-3 limits or release product boundaries', () => {
    expect(accounting).toContain('projectMemoryHaltBytes: 224 * MIB')
    expect(accounting).toContain('providerMemoryHardBytes: 256 * MIB')
    expect(accounting).toContain('projectEgressHalt31dBytes: 4 * GIB')
    expect(accounting).toContain('projectInvocationHalt31d: 400_000')

    for (const required of [
      "'memoryThresholdUnchanged', true",
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
      'revoke all on table xrpl_r5_v1.memory_halt_batch_retries',
      'from public, anon, authenticated',
    ]) {
      expect(helperMigration).toContain(required)
    }
    expect(helperMigration).not.toContain("'mainnetDisabled', false")
    expect(helperMigration).not.toContain("'stabilizationAuthorized', true")
    expect(helperMigration).not.toContain("'soakAuthorized', true")
  })
})
