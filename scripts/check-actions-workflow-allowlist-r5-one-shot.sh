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
python scripts/extend-actions-policy-r5-index-footprint-readonly-probe.py "$generated_script"
python scripts/extend-actions-policy-r5-work-status-partial-index-apply.py "$generated_script"
python scripts/extend-actions-policy-r5-raw-evidence-retention.py "$generated_script"
python scripts/extend-actions-policy-r5-raw-evidence-compaction.py "$generated_script"
python scripts/extend-actions-policy-r5-revision4-resource-halt-rearm.py "$generated_script"
python scripts/extend-actions-policy-r5-revision4-prepared-head-repair.py "$generated_script"
python scripts/extend-actions-policy-r5-revision4-minute-completion-repair.py "$generated_script"
chmod 700 "$generated_script"
bash "$generated_script" "$@"
node --check scripts/r5-index-footprint-readonly-probe.mjs
node --check scripts/r5-secondary-index-readonly-audit.mjs
node --check scripts/manage-r5-work-status-partial-index.mjs
node --check scripts/manage-r5-raw-evidence-retention.mjs
node --check scripts/manage-r5-raw-evidence-compaction.mjs
node --check scripts/manage-r5-revision4-prepared-head-memory-retry-fix.mjs
node --check scripts/manage-r5-revision4-minute-completion-capture-guard.mjs
node --check scripts/manage-r5-revision4-minute-successor.mjs
node --check scripts/prepare-r5-minute-successor-source.mjs
node --check scripts/inspect-r5-revision4-minute-failure-state.mjs
node --check scripts/r5-post-retention-readonly-gate.mjs
bash -n scripts/check-supabase-production-autodeploy-boundary.sh
bash scripts/check-supabase-production-autodeploy-boundary.sh
node scripts/test-r5-phase-ready-native-history-record.mjs
bash -n scripts/test-r5-retention-readonly-preflight-contract.sh
bash scripts/test-r5-retention-readonly-preflight-contract.sh
bash -n scripts/test-r5-post-retention-readonly-gate-contract.sh
bash scripts/test-r5-post-retention-readonly-gate-contract.sh
bash -n scripts/test-r5-cron-history-retention-contract.sh
bash scripts/test-r5-cron-history-retention-contract.sh
bash -n scripts/test-r5-payload-commit-retention-postgres.sh
mkdir -p actions-workflow-policy-evidence/r5-payload-commit-retention
trace_file='actions-workflow-policy-evidence/r5-payload-commit-retention-trace.log'
if ! R5_RAW_RETENTION_OUTPUT=actions-workflow-policy-evidence/r5-payload-commit-retention \
  bash -x scripts/test-r5-payload-commit-retention-postgres.sh \
  > "$trace_file" 2>&1; then
  cat "$trace_file" >&2
  exit 1
fi
bash -n scripts/test-r5-raw-evidence-recurring-retention-postgres.sh
R5_RAW_RECURRING_OUTPUT=actions-workflow-policy-evidence/r5-raw-recurring-retention \
  bash scripts/test-r5-raw-evidence-recurring-retention-postgres.sh
bash -n scripts/test-r5-raw-evidence-retention-contract.sh
bash scripts/test-r5-raw-evidence-retention-contract.sh
bash -n scripts/test-r5-work-status-partial-index-postgres.sh
R5_WORK_STATUS_INDEX_OUTPUT=actions-workflow-policy-evidence/r5-work-status-partial-index \
  bash scripts/test-r5-work-status-partial-index-postgres.sh
bash -n scripts/test-r5-terminal-transport-archive-postgres.sh
R5_TERMINAL_ARCHIVE_OUTPUT=actions-workflow-policy-evidence/r5-terminal-transport-archive \
  bash scripts/test-r5-terminal-transport-archive-postgres.sh
bash -n scripts/test-r5-terminal-archive-contract-postgres.sh
R5_TERMINAL_ARCHIVE_CONTRACT_OUTPUT=actions-workflow-policy-evidence/r5-terminal-archive-contract \
  bash scripts/test-r5-terminal-archive-contract-postgres.sh
bash -n scripts/test-r5-terminal-archive-window-postgres.sh
R5_TERMINAL_ARCHIVE_WINDOW_OUTPUT=actions-workflow-policy-evidence/r5-terminal-archive-window \
  bash scripts/test-r5-terminal-archive-window-postgres.sh
bash -n scripts/test-r5-revision4-archive-completion-patch-postgres.sh
R5_ARCHIVE_COMPLETION_PATCH_OUTPUT=actions-workflow-policy-evidence/r5-archive-completion-patch \
  bash scripts/test-r5-revision4-archive-completion-patch-postgres.sh
bash -n scripts/test-r5-terminal-archive-core-compat-contract.sh
bash scripts/test-r5-terminal-archive-core-compat-contract.sh
bash -n scripts/test-r5-cron-physical-compaction-postgres.sh
R5_CRON_COMPACTION_OUTPUT=actions-workflow-policy-evidence/r5-cron-physical-compaction \
  bash scripts/test-r5-cron-physical-compaction-postgres.sh
bash -n scripts/test-r5-work-status-partial-index-apply-contract.sh
bash scripts/test-r5-work-status-partial-index-apply-contract.sh
bash -n scripts/test-r5-secondary-index-readonly-audit-contract.sh
bash scripts/test-r5-secondary-index-readonly-audit-contract.sh
bash -n scripts/run-r4f-g3-dual-provider-verdict.sh
node scripts/check-r4f-g3-isolation-control-policy.mjs
node scripts/check-r4f-g3-dual-runner-policy.mjs
bash -n scripts/test-r4f-revision4-12-ledger-qualification-contract.sh
bash scripts/test-r4f-revision4-12-ledger-qualification-contract.sh
bash -n scripts/test-r4f-revision4-residue-cleanup-contract.sh
bash scripts/test-r4f-revision4-residue-cleanup-contract.sh
bash -n scripts/test-r5-phase-message-ready-partial-index-apply-contract.sh
bash scripts/test-r5-phase-message-ready-partial-index-apply-contract.sh
