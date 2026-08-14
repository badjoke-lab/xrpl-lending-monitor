#!/usr/bin/env bash
set -euo pipefail

source_script='scripts/check-actions-workflow-allowlist.sh'
generated_script="$(mktemp)"
trap 'rm -f "$generated_script"' EXIT

python scripts/generate-actions-policy-r4f-g3-dual.py "$source_script" "$generated_script"
python scripts/normalize-actions-policy-r4f-g3-dual.py "$generated_script"
python scripts/extend-actions-policy-r4f-revision4-proof.py "$generated_script"
python scripts/normalize-actions-policy-r4f-revision4-resume.py "$generated_script"
python scripts/extend-actions-policy-r4f-revision4-cleanup.py "$generated_script"
python scripts/extend-actions-policy-r4f-revision4-invocation-probe.py "$generated_script"
python scripts/extend-actions-policy-r4f-revision4-resource-snapshot-refresh.py "$generated_script"
python scripts/extend-actions-policy-r5-revision4-minute-activation.py "$generated_script"
python scripts/extend-actions-policy-r5-revision4-db-footprint-probe.py "$generated_script"
python scripts/extend-actions-policy-r5-phase-message-ready-partial-index-apply.py "$generated_script"
python scripts/extend-actions-policy-r5-retention-readonly-preflight.py "$generated_script"
python scripts/extend-actions-policy-r5-cron-history-retention.py "$generated_script"
chmod 700 "$generated_script"
bash "$generated_script" "$@"
bash -n scripts/check-supabase-production-autodeploy-boundary.sh
bash scripts/check-supabase-production-autodeploy-boundary.sh
node scripts/test-r5-phase-ready-native-history-record.mjs
bash -n scripts/test-r5-retention-readonly-preflight-contract.sh
bash scripts/test-r5-retention-readonly-preflight-contract.sh
bash -n scripts/test-r5-cron-history-retention-contract.sh
bash scripts/test-r5-cron-history-retention-contract.sh
bash -n scripts/test-r5-payload-commit-retention-postgres.sh
mkdir -p actions-workflow-policy-evidence/r5-payload-commit-retention
if ! R5_RAW_RETENTION_OUTPUT=actions-workflow-policy-evidence/r5-payload-commit-retention \
  bash -x scripts/test-r5-payload-commit-retention-postgres.sh \
  > actions-workflow-policy-evidence/r5-payload-commit-retention/trace.log 2>&1; then
  cat actions-workflow-policy-evidence/r5-payload-commit-retention/trace.log >&2
  exit 1
fi
bash -n scripts/run-r4f-g3-dual-provider-verdict.sh
node scripts/check-r4f-g3-isolation-control-policy.mjs
node scripts/check-r4f-g3-dual-runner-policy.mjs
bash -n scripts/test-r4f-revision4-12-ledger-qualification-contract.sh
bash scripts/test-r4f-revision4-12-ledger-qualification-contract.sh
bash -n scripts/test-r4f-revision4-residue-cleanup-contract.sh
bash scripts/test-r4f-revision4-residue-cleanup-contract.sh
bash -n scripts/test-r5-phase-message-ready-partial-index-apply-contract.sh
bash scripts/test-r5-phase-message-ready-partial-index-apply-contract.sh
