#!/usr/bin/env bash
set -euo pipefail

script='scripts/r4f-revision4-residue-cleanup.mjs'
workflow='.github/workflows/r4f-revision4-residue-cleanup.yml'
policy='scripts/extend-actions-policy-r4f-revision4-cleanup.py'

for path in "$script" "$workflow" "$policy"; do
  test -f "$path" || { echo "missing revision-4 residue cleanup contract file: $path" >&2; exit 1; }
done

node --check "$script"

for signature in \
  'public.xrpl_prepare_r5_revision4_active_recovery(text,text,text,bigint,text,timestamp with time zone)' \
  'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)' \
  'public.xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary(text,timestamp with time zone)' \
  'public.xrpl_claim_r5_revision4_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)' \
  'public.xrpl_claim_r5_revision4_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)' \
  'public.xrpl_complete_r5_revision4_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
do
  grep -Fq "$signature" "$script"
done

for required in \
  "EXPECTED_MIGRATIONS = ['20260811012000', '20260811061000']" \
  'revision4_egress_budget_policy' \
  'revision4_billable_egress_budget_bytes(integer)' \
  'revision4_egress_exclusive_reservation_bytes(integer)' \
  'xrpl_r5_revision4_future_egress_budget_check' \
  'revision4_accounting_qualification_evidence' \
  'xrpl_complete_r5_revision4_recovery_batch_without_qualification_capture' \
  'xrpl_read_r5_revision4_accounting_qualification_evidence()' \
  'checkpointRows' \
  'runRows' \
  'batchRows' \
  'pg_advisory_xact_lock' \
  'r4f-revision4-runtime-function-residue-cleanup' \
  'authorizedPgState' \
  'read_only: readOnly' \
  'managementQuery(buildInspectionQuery(), true)' \
  'managementQuery(buildCleanupMutation(authorizedPgState), false)'
do
  grep -Fq "$required" "$script"
done

test "$(grep -Ec "^    'drop function public\.xrpl_.*revision4.*;',$" "$script")" -eq 6

for required in \
  "github.event.comment.body == '/r4f-revision4-residue-cleanup-prepare'" \
  "startsWith(github.event.comment.body, '/r4f-revision4-residue-cleanup-authorize ')" \
  'bash scripts/test-r4f-revision4-residue-cleanup-contract.sh' \
  '--expect residue' \
  '--expect clean' \
  '--authorized-pgstate' \
  'state=([a-f0-9]{64})' \
  'pgstate=([a-f0-9]{32})' \
  'prepare_run=([0-9]+)' \
  'test $((expires_epoch - auth_epoch)) -le 7200' \
  'Verify exact prior proposal and unique owner authorization' \
  'Drop only the exact six authorized runtime residue functions atomically' \
  'No CASCADE is used.' \
  'migration-history mutation' \
  'table/row mutation' \
  'collector mutation' \
  'Edge Function mutation'
do
  grep -Fq -- "$required" "$workflow"
done

if grep -Eiq 'drop[[:space:]]+function[^;]*[[:space:]]cascade' "$script"; then
  echo 'revision-4 residue cleanup script contains CASCADE drop' >&2
  exit 1
fi

for forbidden in \
  'supabase db push' \
  'supabase functions deploy' \
  'supabase functions delete' \
  'wrangler deploy' \
  '--mode pause' \
  '--mode resume' \
  "MAINNET_ENABLED: 'true'" \
  '  push:' \
  '  schedule:' \
  'pull_request_target'
do
  if grep -Fq -- "$forbidden" "$workflow"; then
    echo "revision-4 residue cleanup workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

grep -Fq 'r4f-revision4-residue-cleanup.yml' "$policy"

printf '%s\n' 'R4F revision-4 residue cleanup contract: PASS'
