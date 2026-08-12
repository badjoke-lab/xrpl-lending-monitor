#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r4f-revision4-12-ledger-resume.yml'
wrapper='supabase/functions/xrpl-r4f-revision4-proof-batch/index.ts'
executor='supabase/functions/xrpl-r5-recovery-batch/index.ts'
runtime='supabase/migrations/20260809151000_xrpl_r5_revision4_runtime_rpcs.sql'
egress='supabase/migrations/20260810123000_xrpl_r5_revision4_per_ledger_egress_gate.sql'
evidence='supabase/migrations/20260810133000_xrpl_r5_revision4_accounting_qualification_evidence.sql'

for path in "$workflow" "$wrapper" "$executor" "$runtime" "$egress" "$evidence"; do
  test -f "$path" || { echo "missing resume contract file: $path" >&2; exit 1; }
done

test "$(git hash-object "$runtime")" = '350238cec920446faa036cbf225b35683bcd4b54'
test "$(git hash-object "$egress")" = '96d8d478174866355ee798500e3eff83634a442d'
test "$(git hash-object "$evidence")" = '2a986ba2872aead52119563fc43d8d49c1211949'

for required in \
  '__XRPL_R5_REVISION4_PROOF_RUNTIME_CONFIG__' \
  'selectionDigest:' \
  'unexplainedEgressReserveBytes: 0' \
  "requestSource: 'github_actions_prepared_resume'" \
  "await import('../xrpl-r5-recovery-batch/index.ts')"
do
  grep -Fq "$required" "$wrapper" || { echo "proof wrapper missing resume runtime requirement: $required" >&2; exit 1; }
done
if grep -Fq 'Deno.env.set(' "$wrapper" || grep -Fq 'Deno.env.delete(' "$wrapper"; then
  echo 'proof wrapper must not mutate Edge environment variables' >&2
  exit 1
fi

for required in \
  '__XRPL_R5_REVISION4_PROOF_RUNTIME_CONFIG__' \
  'function qualificationRuntimeOverride()' \
  "requestSource: 'github_actions_prepared_resume'" \
  'function requestSource(): string' \
  "qualificationRuntimeOverride()?.requestSource ?? 'github_actions'" \
  'body.source !== requestSource()' \
  "env('XRPL_R5_REVISION4_SELECTION_DIGEST')" \
  "env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')" \
  'xrpl_claim_r5_revision4_recovery_batch_from_prepared_head' \
  'xrpl_complete_r5_revision4_recovery_batch'
do
  grep -Fq "$required" "$executor" || { echo "executor missing guarded resume requirement: $required" >&2; exit 1; }
done

for required in \
  'contents: read' \
  'issues: write' \
  'cancel-in-progress: false' \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "github.event.comment.body == '/r4f-revision4-12-ledger-resume-prepare'" \
  "startsWith(github.event.comment.body, '/r4f-revision4-12-ledger-resume-authorize ')" \
  "PROOF_FUNCTION: 'xrpl-r4f-revision4-proof-batch'" \
  "ACTIVE_FUNCTION: 'xrpl-r5-recovery-batch'" \
  "RECOVERY_RUN_ID: 'r5-recovery-selected-revision4-entry'" \
  "MAX_LEDGER_COUNT: '12'" \
  "MAX_PER_LEDGER_BYTES: '4581'" \
  "MAX_TOTAL_BYTES: '54972'" \
  'resume_state=prepared_zero_progress' \
  'runrow=([a-f0-9]{64})' \
  'checkpointrow=([a-f0-9]{64})' \
  'checkpoint_id=(r5-checkpoint-revision4-proof-[0-9]+)' \
  'public.xrpl_transfer_json_digest(to_jsonb(r))' \
  'public.xrpl_transfer_json_digest(to_jsonb(c))' \
  '.runStatus == "prepared"' \
  '.runCompletedBatches == 0' \
  '.runCommittedLedgers == 0' \
  '.runLastAccountingDigest == null' \
  '.runLastError == null' \
  '.runStartedAt == null' \
  '.runCompletedAt == null' \
  '.qualificationBoundaryOnly == true' \
  '.fullRecoveryStateCaptured == false' \
  'progressive claim must rebind the prepared run to the current active boundary before reservation' \
  'Reverify bound prepared residue after pause read-only' \
  'Resume exact prepared run with one 12-ledger proof invocation' \
  'source:"github_actions_prepared_resume"' \
  'bun-version: 1.3.14' \
  'generated proof bundle contains unsupported Edge environment mutation' \
  '__XRPL_R5_REVISION4_PROOF_RUNTIME_CONFIG__' \
  'supabase functions deploy "$PROOF_FUNCTION"' \
  'supabase functions delete "$PROOF_FUNCTION"' \
  '--mode pause' \
  '--mode resume' \
  'capture-supabase-revision4-r5-accounting-qualification.mjs' \
  '.qualification.pass == true' \
  'test $((expires_epoch - auth_epoch)) -le 7200'
do
  grep -Fq "$required" "$workflow" || { echo "resume workflow missing fail-closed requirement: $required" >&2; exit 1; }
done

for forbidden in \
  '  push:' \
  '  schedule:' \
  'workflow_dispatch' \
  'pull_request_target' \
  'contents: write' \
  'supabase db push' \
  'SUPABASE_DB_PASSWORD' \
  'supabase link' \
  "MAINNET_ENABLED: 'true'" \
  'wrangler deploy' \
  'supabase functions deploy xrpl-r5-recovery-batch' \
  'supabase functions delete xrpl-r5-recovery-batch' \
  'delete from xrpl_r5_v1.recovery_runs' \
  'delete from xrpl_r5_v1.active_checkpoints' \
  'truncate ' \
  "select public.xrpl_create_r5_revision4_active_checkpoint('" \
  "select public.xrpl_prepare_r5_revision4_active_recovery('"
do
  if grep -Fiq "$forbidden" "$workflow"; then
    echo "resume workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

test "$(grep -Foc 'issues: write' "$workflow")" -eq 1
test "$(grep -Foc 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' "$workflow")" -eq 1
test "$(grep -Foc 'bun-version: 1.3.14' "$workflow")" -eq 1
test "$(grep -Foc 'supabase functions deploy "$PROOF_FUNCTION"' "$workflow")" -eq 1
test "$(grep -Foc 'supabase functions delete "$PROOF_FUNCTION"' "$workflow")" -eq 1
test "$(grep -Foc -- '--mode pause' "$workflow")" -eq 1
test "$(grep -Foc -- '--mode resume' "$workflow")" -eq 1
test "$(grep -Foc 'Resume exact prepared run with one 12-ledger proof invocation' "$workflow")" -eq 1

supabase_setup_line="$(grep -n -F '      - name: Set up Supabase CLI' "$workflow" | cut -d: -f1)"
bun_setup_line="$(grep -n -F '      - name: Set up pinned Bun for proof prebundle' "$workflow" | cut -d: -f1)"
deploy_line="$(grep -n -F '      - name: Bundle and deploy only isolated temporary revision-4 proof function' "$workflow" | cut -d: -f1)"
test "$supabase_setup_line" -lt "$bun_setup_line"
test "$bun_setup_line" -lt "$deploy_line"

test "$(grep -Foc 'read_only:true' "$workflow")" -ge 4

printf '%s\n' 'R4F revision-4 prepared-run resume qualification contract: PASS'
