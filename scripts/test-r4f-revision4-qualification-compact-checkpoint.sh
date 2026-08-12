#!/usr/bin/env bash
set -euo pipefail

sql='scripts/r4f-revision4-qualification-compact-checkpoint.sql'
test -f "$sql"

for required in \
  '__CHECKPOINT_ID__' \
  '__SELECTION_DIGEST__' \
  '__OBSERVED_AT__' \
  "hashtextextended('xrpl-r5-active-checkpoint', 0)" \
  'public.xrpl_drain_r5_checkpoint_boundary(' \
  "r.status = 'stopped'" \
  'r.lease_owner is null' \
  'r.lease_expires_at is null' \
  'r.last_error is null' \
  'r.consecutive_failures = 0' \
  "s.status = 'active'" \
  "m.status = 'pending'" \
  "m.phase = 'scan'" \
  "predecessor.phase = 'finalize'" \
  "predecessor.status = 'completed'" \
  "predecessor.result->>'status' = 'committed'" \
  "work.status = 'committed'" \
  'work.scanned_end_ledger_index = w.ledger_index' \
  'work.final_ledger_hash = w.ledger_hash' \
  'work.committed_at is not null' \
  "status in ('planned', 'staged', 'committing', 'finalizing')" \
  'mc.pending_messages = 1' \
  'mc.leased_messages = 0' \
  'mc.retry_messages = 0' \
  'wc.inflight_work = 0' \
  "'r5-revision4-qualification-boundary-checkpoint'" \
  "'qualificationBoundaryOnly', true" \
  "'fullRecoveryStateCaptured', false" \
  "'legacyRevision3AccountingStateRetained', false" \
  "'publicReaderUnchanged', true" \
  "'mainnetDisabled', true" \
  'insert into xrpl_r5_v1.active_checkpoints' \
  'on conflict (checkpoint_id) do nothing' \
  'public.xrpl_transfer_json_digest(selected.state) = selected.state_digest' \
  "'checkpointKind', 'revision4-qualification-boundary'"
do
  grep -Fq "$required" "$sql" || {
    echo "compact checkpoint SQL is missing fail-closed requirement: $required" >&2
    exit 1
  }
done

for forbidden in \
  'jsonb_agg' \
  'array_agg' \
  'xrpl_create_r5_active_checkpoint(' \
  'xrpl_create_r5_revision4_active_checkpoint(' \
  'create function' \
  'create or replace function' \
  'alter table' \
  'drop table' \
  'drop function' \
  'truncate ' \
  'update xrpl_r5_v1.active_checkpoints' \
  'delete from xrpl_r5_v1.active_checkpoints' \
  'insert into xrpl_r5_v1.recovery_runs' \
  'insert into xrpl_r5_v1.recovery_batches' \
  'insert into xrpl_r5_v1.revision4_accounting_qualification_evidence'
do
  if grep -Fiq "$forbidden" "$sql"; then
    echo "compact checkpoint SQL contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

test "$(grep -Foc 'insert into xrpl_r5_v1.active_checkpoints' "$sql")" -eq 1
test "$(grep -Foc 'public.xrpl_drain_r5_checkpoint_boundary(' "$sql")" -eq 1

for table in \
  public.xrpl_collector_runtime \
  public.xrpl_phase_streams \
  public.xrpl_phase_watermarks \
  public.xrpl_phase_messages \
  public.xrpl_phase_successors \
  public.xrpl_phase_work \
  public.xrpl_phase_payload_chunks \
  public.xrpl_phase_reference_rows \
  public.xrpl_phase_commit_chunks \
  xrpl_resource_guard_v2.attempts \
  xrpl_resource_guard_v2.tick_accounting
do
  grep -Fq "$table" "$sql" || {
    echo "compact checkpoint SQL dropped source-state coverage: $table" >&2
    exit 1
  }
done

printf '%s\n' 'R4F revision-4 compact qualification checkpoint contract: PASS'
