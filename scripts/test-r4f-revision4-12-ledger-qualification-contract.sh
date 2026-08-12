#!/usr/bin/env bash
set -euo pipefail

runtime='supabase/migrations/20260809151000_xrpl_r5_revision4_runtime_rpcs.sql'
egress='supabase/migrations/20260810123000_xrpl_r5_revision4_per_ledger_egress_gate.sql'
evidence='supabase/migrations/20260810133000_xrpl_r5_revision4_accounting_qualification_evidence.sql'
wrapper='supabase/functions/xrpl-r4f-revision4-proof-batch/index.ts'
executor='supabase/functions/xrpl-r5-recovery-batch/index.ts'
qualifier='scripts/qualify-supabase-revision4-r5-accounting.mjs'
capture='scripts/capture-supabase-revision4-r5-accounting-qualification.mjs'
prepare='scripts/prepare-r4f-g3-isolated-window.mjs'
workflow='.github/workflows/r4f-revision4-12-ledger-qualification.yml'

for path in "$runtime" "$egress" "$evidence" "$wrapper" "$executor" "$qualifier" "$capture" "$prepare" "$workflow"; do
  test -f "$path" || { echo "missing contract file: $path" >&2; exit 1; }
done

test "$(git hash-object "$runtime")" = '350238cec920446faa036cbf225b35683bcd4b54'
test "$(git hash-object "$egress")" = '96d8d478174866355ee798500e3eff83634a442d'
test "$(git hash-object "$evidence")" = '2a986ba2872aead52119563fc43d8d49c1211949'

grep -Fq 'strpos(v_definition, v_old_digest) = 0' "$runtime"
grep -Fq 'strpos(v_definition, v_old_selection) = 0' "$runtime"
grep -Fq "replace(v_clone, quote_literal(v_old_selection), 'v_checkpoint.selection_digest')" "$runtime"
grep -Fq "replace(v_clone, quote_literal(v_old_selection), 'v_run.selection_digest')" "$runtime"
grep -Fq "'or[[:space:]]+v_checkpoint\\.selection_digest[[:space:]]*<>[[:space:]]*v_checkpoint\\.selection_digest'" "$runtime"
grep -Fq "'or[[:space:]]+v_run\\.selection_digest[[:space:]]*<>[[:space:]]*v_run\\.selection_digest'" "$runtime"
grep -Fq "'''supabase_free_postgres_pgcron_edge'',[[:space:]]*3,'" "$runtime"
grep -Fq 'strpos(v_clone, v_old_selection) <> 0' "$runtime"
grep -Fq 'xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)' "$runtime"
grep -Fq 'xrpl_rebind_r5_revision4_prebatch_recovery_to_active_boundary_strict' "$runtime"
grep -Fq 'r5_revision4_rebind_strict_source_drift' "$runtime"
grep -Fq 'r5_revision4_rebind_wrapper_source_drift' "$runtime"
grep -Fq 'public.xrpl_drain_r5_checkpoint_boundary(' "$runtime"
if grep -Eq "E'or v_(checkpoint|run)\.selection_digest\\\\n" "$runtime"; then
  echo 'revision-4 runtime still contains newline-sensitive selection clone transforms' >&2
  exit 1
fi
if grep -Eq 'position\(v_old_(digest|selection) in ' "$runtime"; then
  echo 'revision-4 runtime still contains variable position(...) source guards' >&2
  exit 1
fi

for signature in \
  'public.xrpl_prepare_r5_active_recovery(text,text,text,bigint,text,timestamp with time zone)' \
  'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary_strict(text,timestamp with time zone)' \
  'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(text,timestamp with time zone)' \
  'public.xrpl_claim_r5_active_recovery_batch(text,text,bigint,text,timestamp with time zone,integer)' \
  'public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(text,text,timestamp with time zone,integer)' \
  'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)'
do
  grep -Fq "$signature" "$prepare"
done
grep -Fq 'runtimeSourceSetSha256' "$prepare"
grep -Fq 'r5_runtime_source_set_sha256=' "$prepare"
grep -Fq 'r5_prepare_source_sha256=${runtimeSourceSetSha256}' "$prepare"
grep -Fq 'allDynamicCloneSourcesBound: true' "$prepare"

grep -Fq "await import('../xrpl-r5-recovery-batch/index.ts')" "$wrapper"
grep -Fq "99a1f97fc17ed6023bc3075bffe963a260e99a4ed0e2d831b068826c7797222f" "$wrapper"
grep -Fq "XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES', '0'" "$wrapper"

grep -Fq "const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'" "$executor"
grep -Fq "const RECOVERY_RUN_ID = 'r5-recovery-selected-revision4-entry'" "$executor"
grep -Fq 'xrpl_claim_r5_revision4_recovery_batch_from_prepared_head' "$executor"
grep -Fq 'xrpl_complete_r5_revision4_recovery_batch' "$executor"

grep -Fq "const QUALIFICATION_KEY = 'r4f-revision4-r5-12-ledger-accounting-v1'" "$capture"
grep -Fq "const RUN_ID = 'r5-recovery-selected-revision4-entry'" "$capture"
grep -Fq 'evidence.ledgerCount !== 12' "$capture"
grep -Fq 'MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER = 4_581' "$qualifier"
grep -Fq 'REQUIRED_LEDGER_COUNT = 12' "$qualifier"

grep -Fq "PROOF_FUNCTION: 'xrpl-r4f-revision4-proof-batch'" "$workflow"
grep -Fq "ACTIVE_FUNCTION: 'xrpl-r5-recovery-batch'" "$workflow"
grep -Fq "MAX_LEDGER_COUNT: '12'" "$workflow"
grep -Fq "MAX_PER_LEDGER_BYTES: '4581'" "$workflow"
grep -Fq "MAX_TOTAL_BYTES: '54972'" "$workflow"
grep -Fq "github.event.comment.body == '/r4f-revision4-12-ledger-prepare'" "$workflow"
grep -Fq "startsWith(github.event.comment.body, '/r4f-revision4-12-ledger-authorize ')" "$workflow"
grep -Fq "test \"\$(git hash-object \"\$RUNTIME_PATH\")\" = '350238cec920446faa036cbf225b35683bcd4b54'" "$workflow"
grep -Fq "expires=\"\$(date -u -d '+2 hours' '+%Y-%m-%dT%H:%M:%SZ')\"" "$workflow"
grep -Fq 'prepare_source=${PREPARE_SOURCE_SHA}' "$workflow"
grep -Fq 'prepare_source=([a-f0-9]{64})' "$workflow"
grep -Fq 'migration_state=applied_clean prepare_run=${GITHUB_RUN_ID}' "$workflow"
grep -Fq 'migration_state=applied_clean prepare_run=([0-9]+)' "$workflow"
grep -Fq 'Migration state: `applied_clean`' "$workflow"
grep -Fq 'Revision-3 runtime source-set SHA-256' "$workflow"
grep -Fq 'checkpointRev4Exists' "$workflow"
grep -Fq 'rebindStrictRev4Exists' "$workflow"
grep -Fq 'egressPolicyRows' "$workflow"
grep -Fq 'runIdRows' "$workflow"
grep -Fq 'evidenceRows' "$workflow"
grep -Fq "20260809151000 20260810123000 20260810133000 20260811012000 20260811061000" "$workflow"
grep -Fq "policy_id='r5-revision4-egress-4581-v1'" "$workflow"
grep -Fq 'maximum_ledgers_per_claim=12' "$workflow"
grep -Fq 'maximum_billable_egress_bytes_per_ledger=4581' "$workflow"
grep -Fq 'maximum_claim_billable_egress_bytes=54972' "$workflow"
grep -Fq 'maximum_claim_exclusive_reservation_bytes=54973' "$workflow"
grep -Fq 'r4f-g3-isolated-window-prepare-evidence' "$workflow"
grep -Fq 'test $((expires_epoch - auth_epoch)) -le 7200' "$workflow"
grep -Fq 'test "$ACTUAL_PREPARE_SOURCE" = "$EXPECTED_PREPARE_SOURCE"' "$workflow"
grep -Fq 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' "$workflow"
grep -Fq 'bun-version: 1.3.14' "$workflow"
grep -Fq "test \"\$bun_version\" = '1.3.14'" "$workflow"
grep -Fq 'bun build "$PROOF_FUNCTION_PATH"' "$workflow"
grep -Fq -- '--target=browser' "$workflow"
grep -Fq -- '--format=esm' "$workflow"
grep -Fq 'proof-function-bundle.json' "$workflow"
grep -Fq 'generated proof bundle retains a relative import' "$workflow"
grep -Fq "bundle.includes('cloudflare:')" "$workflow"
grep -Fq "bundle.includes('Deno.serve')" "$workflow"
grep -Fq 'sourceSha256 !== authorizedFunctionSha' "$workflow"
grep -Fq 'supabase functions deploy "$PROOF_FUNCTION" --project-ref "$SUPABASE_PROJECT_ID" --use-api --no-verify-jwt' "$workflow"
grep -Fq 'supabase functions delete "$PROOF_FUNCTION"' "$workflow"

for forbidden in \
  'supabase db push' \
  'SUPABASE_DB_PASSWORD' \
  'supabase link' \
  'supabase functions deploy xrpl-r5-recovery-batch' \
  'supabase functions delete xrpl-r5-recovery-batch' \
  "MAINNET_ENABLED: 'true'" \
  '/r4f-g3-dashboard-authorize' \
  '/r4f-g3-after' \
  '/r4f-g3-capture-logs' \
  "date -u -d '+15 minutes'"
do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "qualification workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

printf '%s\n' 'R4F revision-4 exact 12-ledger qualification contract: PASS'
