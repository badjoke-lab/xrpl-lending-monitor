import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805083000_xrpl_r5_retry_memory_halt_with_half_batch.sql',
)
const assertion = read(
  'supabase/migrations/20260805083100_xrpl_r5_retry_memory_halt_assertion.sql',
)
const accounting = read('src/shared/supabase-revision3-resource-accounting.ts')

describe('R5 exact memory-halt half-batch retry', () => {
  it('binds the one-time repair to the exact failed production boundary', () => {
    for (const required of [
      "'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'",
      'p_source_failed_burst_run_id <> 30987685290',
      "p_source_commit <> 'b4f267944bd076659b4c1db29208dcdc35eb532c'",
      'v_run.completed_batches <> 244',
      'v_run.committed_ledgers <> 5175',
      'v_run.current_watermark_ledger_index <> 4138482',
      'v_batch.batch_sequence <> 245',
      'v_batch.start_ledger_index <> 4138483',
      'v_batch.end_ledger_index <> 4138506',
      'v_batch.ledger_count <> 24',
      "v_batch.error_message <> 'revision3_resource_halt:memory_upper_bound_halt'",
      'v_completed_count <> 244',
      'v_halted_count <> 1',
      'v_last_completed_end <> 4138482',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains the failed reservation and records one additional retry reservation', () => {
    for (const required of [
      'v_retry_count := 12',
      'v_prior_egress := v_batch.projected_conservative_egress_31d_bytes',
      'v_projected_egress := v_prior_egress + v_batch.reserved_egress_upper_bound_bytes',
      'v_prior_invocations := v_batch.projected_invocations_31d',
      'v_projected_invocations := v_prior_invocations + 1',
      'v_projected_egress >= 4294967296',
      'v_projected_invocations >= 400000',
      "raise exception 'r5_memory_retry_schedule_additional_reservation_halt'",
      "'failedAttemptReservationRetained', true",
      "'additionalRetryReservationRecorded', true",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('releases only the exact halted batch as the same sequence and identity', () => {
    for (const required of [
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
      expect(migration).toContain(required)
    }
  })

  it('fails deployment when production exists but the exact retry state was not created', () => {
    for (const required of [
      "if not found then\n    return;",
      "v_run.status <> 'running'",
      'v_batch.end_ledger_index <> 4138494',
      'v_batch.ledger_count <> 12',
      'v_retry.prior_ledger_count <> 24',
      'v_retry.retry_ledger_count <> 12',
      "raise exception 'r5_memory_retry_post_migration_state_invalid'",
    ]) {
      expect(assertion).toContain(required)
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
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("'mainnetDisabled', false")
    expect(migration).not.toContain("'stabilizationAuthorized', true")
    expect(migration).not.toContain("'soakAuthorized', true")
  })
})
