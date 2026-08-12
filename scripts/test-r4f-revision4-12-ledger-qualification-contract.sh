#!/usr/bin/env bash
set -euo pipefail

runtime='supabase/migrations/20260809151000_xrpl_r5_revision4_runtime_rpcs.sql'
egress='supabase/migrations/20260810123000_xrpl_r5_revision4_per_ledger_egress_gate.sql'
evidence='supabase/migrations/20260810133000_xrpl_r5_revision4_accounting_qualification_evidence.sql'
wrapper='supabase/functions/xrpl-r4f-revision4-proof-batch/index.ts'
executor='supabase/functions/xrpl-r5-recovery-batch/index.ts'
qualifier='scripts/qualify-supabase-revision4-r5-accounting.mjs'
capture='scripts/capture-supabase-revision4-r5-accounting-qualification.mjs'
workflow='.github/workflows/r4f-revision4-12-ledger-qualification.yml'

for path in "$runtime" "$egress" "$evidence" "$wrapper" "$executor" "$qualifier" "$capture" "$workflow"; do
  test -f "$path" || { echo "missing contract file: $path" >&2; exit 1; }
done

test "$(git hash-object "$runtime")" = '066142b0db19e8b2435836de16e1ae09e95aabb2'
test "$(git hash-object "$egress")" = '96d8d478174866355ee798500e3eff83634a442d'
test "$(git hash-object "$evidence")" = '2a986ba2872aead52119563fc43d8d49c1211949'

grep -Fq 'strpos(v_definition, v_old_digest) = 0' "$runtime"
grep -Fq 'strpos(v_definition, v_old_selection) = 0' "$runtime"
grep -Fq 'strpos(v_clone, v_old_selection) <> 0' "$runtime"
if grep -Eq 'position\(v_old_(digest|selection) in ' "$runtime"; then
  echo 'revision-4 runtime still contains variable position(...) source guards' >&2
  exit 1
fi

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
grep -Fq 'supabase functions deploy "$PROOF_FUNCTION"' "$workflow"
grep -Fq 'supabase functions delete "$PROOF_FUNCTION"' "$workflow"

for forbidden in \
  'supabase functions deploy xrpl-r5-recovery-batch' \
  'supabase functions delete xrpl-r5-recovery-batch' \
  "MAINNET_ENABLED: 'true'" \
  '/r4f-g3-dashboard-authorize' \
  '/r4f-g3-after' \
  '/r4f-g3-capture-logs'
do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "qualification workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

printf '%s\n' 'R4F revision-4 exact 12-ledger qualification contract: PASS'
