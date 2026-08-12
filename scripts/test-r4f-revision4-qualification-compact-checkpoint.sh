#!/usr/bin/env bash
set -euo pipefail

sql='scripts/r4f-revision4-qualification-compact-checkpoint.sql'
test -f "$sql"

for required in \
  '__CHECKPOINT_ID__' \
  '__SELECTION_DIGEST__' \
  '__OBSERVED_AT__' \
  "hashtextextended('xrpl-r5-active-checkpoint', 0)" \
  'existing_checkpoint as materialized' \
  'where not exists (select 1 from existing_checkpoint)' \
  'public.xrpl_drain_r5_checkpoint_boundary(' \
  "d.value->>'purpose' = 'r5-checkpoint-boundary-drain'" \
  "d.value->>'profileId' = 'supabase_free_postgres_pgcron_edge'" \
  "(d.value->>'profileRevision')::integer = 3" \
  "d.value->>'sourceProfileId' = 'supabase-devnet'" \
  "d.value->>'network' = 'devnet'" \
  "d.value->>'epochId' = 'supabase-r4c2c-v1'" \
  "jsonb_typeof(d.value->'drainedPhases') = 'array'" \
  "drained_phase->>'phase' not in ('commit', 'finalize')" \
  "'{checks,collectorQuiescent}'" \
  "'{checks,activeStreamHealthy}'" \
  "'{checks,onlyExistingCommitOrFinalizeDrained}'" \
  "'{checks,noScanExecuted}'" \
  "'{checks,onePendingScan}'" \
  "'{checks,pendingScanBoundToWatermark}'" \
  "'{checks,noInflightWork}'" \
  "'{checks,watermarkIdentityPreserved}'" \
  "'{checks,publicReaderUnchanged}'" \
  "'{checks,mainnetDisabled}'" \
  "'{checks,activeRecoveryStarted}'" \
  "'{checks,stabilizationAuthorized}'" \
  "'{checks,soakAuthorized}'" \
  "'{watermarkAfter,ledgerIndex}'" \
  "'{watermarkAfter,ledgerHash}'" \
  "'{watermarkAfter,workId}'" \
  "'{pendingScan,messageId}'" \
  "'{pendingScan,expectedPreviousLedgerIndex}'" \
  "'{pendingScan,expectedPreviousLedgerHash}'" \
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
  'public.xrpl_collector_runtime' \
  'public.xrpl_phase_streams' \
  'public.xrpl_phase_watermarks' \
  'public.xrpl_phase_messages' \
  'public.xrpl_phase_successors' \
  'public.xrpl_phase_work' \
  'public.xrpl_phase_payload_chunks' \
  'public.xrpl_phase_reference_rows' \
  'public.xrpl_phase_commit_chunks' \
  'xrpl_resource_guard_v2.attempts' \
  'xrpl_resource_guard_v2.tick_accounting' \
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

grep -Fq 'The trusted checkpoint-boundary drain is the authoritative proof' "$sql"
grep -Fq 'Do not re-read phase tables in the same SQL statement' "$sql"

printf '%s\n' 'R4F revision-4 compact qualification checkpoint contract: PASS'
