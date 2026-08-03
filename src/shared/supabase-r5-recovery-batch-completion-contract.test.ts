import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803123100_xrpl_r5_recovery_batch_complete.sql',
  ),
  'utf8',
)

describe('R5 active recovery batch completion contract', () => {
  it('requires one selected, leased, unexpired revision-3 recovery batch', () => {
    for (const required of [
      'create or replace function public.xrpl_complete_r5_active_recovery_batch',
      "perform pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0))",
      "v_batch.status <> 'leased'",
      'v_batch.lease_owner is distinct from p_owner',
      'v_batch.lease_expires_at <= p_completed_at',
      "v_run.status <> 'running'",
      "v_run.source_profile_id <> 'supabase-devnet'",
      "v_run.network <> 'devnet'",
      "v_run.epoch_id <> 'supabase-r4c2c-v1'",
      'v_run.profile_identity_digest <> v_batch.profile_identity_digest',
      'v_run.selection_digest <> v_batch.selection_digest',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('revalidates the exact quiescent active boundary before mutation', () => {
    for (const required of [
      "v_runtime.status <> 'stopped'",
      "v_stream.status <> 'active'",
      'v_watermark.ledger_index <> v_run.current_watermark_ledger_index',
      'v_watermark.ledger_hash <> v_run.current_watermark_ledger_hash',
      'v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0',
      "v_pending_scan.phase <> 'scan'",
      'v_pending_scan.attempt_count <> 0',
      "status in ('planned', 'staged', 'committing', 'finalizing')",
      "raise exception 'r5_recovery_batch_completion_inflight_work_present'",
      'v_pending_scan.message_id <> v_scan_id',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds the canonical portable works, chunks, rows, and successor chain', () => {
    for (const required of [
      "encode(digest(convert_to(p_works_json, 'UTF8'), 'sha256'), 'hex')",
      'public.xrpl_phase_work_id(',
      "(v_plan->>'schemaVersion')::integer <> 1",
      "v_plan->>'network' <> v_run.network",
      "v_plan->>'epochId' <> v_run.epoch_id",
      "v_plan->>'baseIdentity' <> v_run.base_identity",
      "(v_plan->>'plannedEndLedgerIndex')::bigint <> v_end_index",
      "v_payload->>'payloadDigest'",
      "v_payload->>'chunkDigest'",
      "jsonb_array_length(v_payload->'records') <> v_record_count",
      'select payload_record into v_payload_record',
      "raise exception 'r5_recovery_batch_row_payload_mismatch_at_%'",
      'public.xrpl_phase_commit_message_id(',
      'public.xrpl_phase_finalize_message_id(',
      'public.xrpl_phase_scan_message_id(',
      'insert into public.xrpl_phase_successors',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("v_plan->>'workId'")
    expect(migration).not.toContain("v_row.value->>'createdAt'")
  })

  it('requires revision-3 accounting before active inserts and shrinks only on success', () => {
    const accountingGate = migration.indexOf(
      "raise exception 'r5_recovery_batch_accounting_threshold_invalid'",
    )
    const firstActiveInsert = migration.indexOf(
      'insert into public.xrpl_phase_work',
    )
    expect(accountingGate).toBeGreaterThan(-1)
    expect(firstActiveInsert).toBeGreaterThan(accountingGate)

    for (const required of [
      "v_accounting->>'profileId' <> 'supabase_free_postgres_pgcron_edge'",
      "(v_accounting->>'profileRevision')::integer <> 3",
      "coalesce((v_accounting_result->>'allowed')::boolean, false) is not true",
      "jsonb_array_length(v_accounting_result->'failures') <> 0",
      "coalesce((v_accounting_checks->>'preMutationDecision')::boolean, false) is not true",
      "(v_accounting_thresholds->>'projectMemoryHaltBytes')::bigint <> 234881024",
      "(v_accounting_thresholds->>'projectTickEgressHaltBytes')::bigint <> 33554432",
      "(v_accounting_thresholds->>'projectEgressHalt31dBytes')::bigint <> 4294967296",
      "(v_accounting_thresholds->>'projectInvocationHalt31d')::bigint <> 400000",
      "(v_accounting_result->>'projectedInvocations31d')::bigint",
      'p_finalized_egress_upper_bound_bytes',
      "set status = 'completed'",
      'finalized_egress_upper_bound_bytes = p_finalized_egress_upper_bound_bytes',
      "'batchReservationShrunkOnlyAfterSuccess'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('advances all active and R5 state atomically but does not declare catch-up', () => {
    for (const required of [
      'insert into public.xrpl_phase_work',
      'insert into public.xrpl_phase_payload_chunks',
      'insert into public.xrpl_phase_reference_rows',
      'insert into public.xrpl_phase_commit_chunks',
      'insert into public.xrpl_phase_watermarks',
      'update xrpl_r5_v1.recovery_batches',
      'update xrpl_r5_v1.recovery_runs',
      'current_watermark_ledger_index = v_last_index',
      'completed_batches = v_new_completed_batches',
      'committed_ledgers = v_new_committed_ledgers',
      "set status = 'running'",
      "'singlePendingScanAfterCommit'",
      "'noLeasedOrRetryMessagesAfterCommit'",
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationNotStarted', true",
      "'soakNotStarted', true",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("set status = 'caught_up'")
  })

  it('allows only exact completed replay and preserves closed permissions', () => {
    for (const required of [
      "if v_batch.status = 'completed' then",
      "raise exception 'r5_recovery_batch_completed_replay_conflict'",
      "'replayed', true",
      'from public, anon, authenticated',
      'to service_role',
      'to supabase_admin',
    ]) {
      expect(migration).toContain(required)
    }
  })
})
