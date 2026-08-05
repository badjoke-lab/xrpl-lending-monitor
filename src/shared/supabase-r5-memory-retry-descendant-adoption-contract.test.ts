import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260805093000_xrpl_r5_adopt_memory_retry_watermark_drift.sql',
)
const accounting = read('src/shared/supabase-revision3-resource-accounting.ts')

describe('R5 memory-retry watermark-drift descendant adoption', () => {
  it('binds the repair to the exact failed run, batch, and recovery watermark', () => {
    for (const required of [
      "v_expected_run_id constant text :=\n    'r5-recovery-selected-revision3-entry'",
      "v_expected_batch_id constant text :=\n    'r5-batch-v1-r5-recovery-selected-revision3-entry-00000245'",
      'v_run.completed_batches <> 244',
      'v_run.committed_ledgers <> 5160',
      'v_run.current_watermark_ledger_index <> 4138467',
      "'2AFA2CE9FA58878B6E13285945B97270544FED472F50D6D08BB05EA6036A6A3B'",
      "'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138467:14A18F40E0FA2E0DB48DAA307949BE755493352509A3E40C4DF160DDF2301EEF'",
      "'r5_recovery_batch_completion_watermark_drift'",
      'v_batch.batch_sequence <> 245',
      'v_batch.start_ledger_index <> 4138468',
      'v_batch.end_ledger_index <> 4138479',
      'v_batch.ledger_count <> 12',
      'v_batch.attempt_count <> 2',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires the original memory halt and half-batch retry audit evidence', () => {
    for (const required of [
      'v_retry.source_failed_burst_run_id <> 30987685290',
      "v_retry.source_commit\n      <> 'b4f267944bd076659b4c1db29208dcdc35eb532c'",
      "v_retry.reason\n      <> 'revision3_resource_halt:memory_upper_bound_halt'",
      'v_retry.prior_ledger_count <> 24',
      'v_retry.retry_ledger_count <> 12',
      'v_retry.prior_conservative_egress_31d_bytes <> 3482266216',
      'v_retry.projected_conservative_egress_31d_bytes <> 3616483944',
      'v_retry.prior_invocations_31d <> 75795',
      'v_retry.projected_invocations_31d <> 75796',
      'source_memory_halt_run_id bigint not null',
      'source_failed_burst_run_id bigint not null',
      'retry_audit jsonb not null',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('drains and validates the exact physical descendant chain before adoption', () => {
    for (const required of [
      "public.xrpl_drain_r5_checkpoint_boundary(\n    'r5-memory-retry-watermark-drift-repair'",
      "'collectorQuiescent'",
      "'onlyExistingCommitOrFinalizeDrained'",
      "'noScanExecuted'",
      "'onePendingScan'",
      "'noInflightWork'",
      'v_boundary_before_index < 4138481',
      'v_boundary_after_index > 4138737',
      "'F4520F0F615E71F5AD41D9585737542D35EED6D41A79E25470C168F7D8B2B06D'",
      "'collector-work-v1:devnet:supabase-r4c2c-v1:seven-class-base-4132417-C9A7A89077EA7F54EBC296EE95E6AE45601088DDA5CFC5538A435C4A21E9CE77:4138481:5A52D7485DE41CB3F9D0E5E4905E17BE6DB4BAE92FEEB92442ADF2F1F283B2EF'",
      'work.start_ledger_index between 4138468 and 4138479',
      'v_work_count <> 12',
      'not v_single_ledger_chain',
      'not v_hash_linked_chain',
      'v_first_final_index <> 4138479',
      "'worksDigest', v_first_works_digest",
      "'rowsDigest', v_first_rows_digest",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('converts only batch 245 and retains both failed reservations', () => {
    for (const required of [
      "set status = 'completed'",
      "origin = 'adopted_active_descendant'",
      'finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes',
      'failure_reservation_retained = true',
      'completed_batches = completed_batches + 1',
      'committed_ledgers = committed_ledgers + 12',
      'adopted_batches = adopted_batches + 1',
      'adopted_ledgers = adopted_ledgers + 12',
      "'failedAttemptProjectedEgress31dBytes', 3482266216",
      "'retryProjectedEgress31dBytes', 3616483944",
      "'failedAttemptProjectedInvocations31d', 75795",
      "'retryProjectedInvocations31d', 75796",
      "'failedReservationsRetained', true",
      "'additionalRecoveryEgressUpperBoundBytes', 0",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('adopts every remaining committed descendant through the drained watermark', () => {
    for (const required of [
      'v_remaining_ledger_count := v_watermark.ledger_index - 4138479',
      'v_expected_remaining_batches := (v_remaining_ledger_count + 23) / 24',
      'v_remaining_ledger_count < 2',
      'v_remaining_ledger_count > 258',
      'public.xrpl_adopt_r5_committed_active_descendants(',
      "(v_remaining_adoption->>'startLedgerIndex')::bigint <> 4138480",
      "(v_remaining_adoption->>'firstBatchSequence')::bigint <> 246",
      "(v_remaining_adoption->>'adoptedBatchCount')::bigint",
      'v_run.completed_batches <> 245 + v_expected_remaining_batches',
      'v_run.committed_ledgers\n      <> v_watermark.ledger_index - v_run.start_watermark_ledger_index',
      'v_halted_batch_count <> 0',
      'v_leased_batch_count <> 0',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps all resource and release boundaries fail closed', () => {
    expect(accounting).toContain('projectMemoryHaltBytes: 224 * MIB')
    expect(accounting).toContain('providerMemoryHardBytes: 256 * MIB')
    expect(accounting).toContain('projectEgressHalt31dBytes: 4 * GIB')
    expect(accounting).toContain('projectInvocationHalt31d: 400_000')

    for (const required of [
      'revoke all on table xrpl_r5_v1.memory_retry_descendant_repairs',
      'from public, anon, authenticated',
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
      "raise exception 'r5_memory_retry_drift_repair_post_state_invalid'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("'mainnetDisabled', false")
    expect(migration).not.toContain("'stabilizationAuthorized', true")
    expect(migration).not.toContain("'soakAuthorized', true")
  })
})
