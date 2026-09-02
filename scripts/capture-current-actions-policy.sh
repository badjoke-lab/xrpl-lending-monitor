#!/usr/bin/env bash
set -euo pipefail

source_script='scripts/check-actions-workflow-allowlist.sh'
output='actions-workflow-policy-evidence/generated-actions-policy.sh'
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

python scripts/generate-actions-policy-r4f-g3-dual.py "$source_script" "$tmp"
python scripts/normalize-actions-policy-r4f-g3-dual.py "$tmp"
for transformer in \
  scripts/extend-actions-policy-r4f-revision4-proof.py \
  scripts/normalize-actions-policy-r4f-revision4-resume.py \
  scripts/extend-actions-policy-r4f-revision4-cleanup.py \
  scripts/extend-actions-policy-r4f-revision4-invocation-probe.py \
  scripts/extend-actions-policy-r4f-revision4-resource-snapshot-refresh.py \
  scripts/extend-actions-policy-r5-revision4-minute-activation.py \
  scripts/extend-actions-policy-r5-revision4-db-footprint-probe.py \
  scripts/extend-actions-policy-r5-phase-message-ready-partial-index-apply.py \
  scripts/extend-actions-policy-r5-retention-readonly-preflight.py \
  scripts/extend-actions-policy-r5-cron-history-retention.py \
  scripts/extend-actions-policy-r5-index-footprint-readonly-probe.py \
  scripts/extend-actions-policy-r5-work-status-partial-index-apply.py \
  scripts/extend-actions-policy-r5-raw-evidence-retention.py \
  scripts/extend-actions-policy-r5-raw-evidence-compaction.py \
  scripts/extend-actions-policy-r5-revision4-resource-halt-rearm.py \
  scripts/extend-actions-policy-r5-revision4-prepared-head-repair.py \
  scripts/extend-actions-policy-r5-revision4-minute-completion-repair.py \
  scripts/extend-actions-policy-r5-terminal-archive-phase-a-apply.py \
  scripts/extend-actions-policy-r5-legacy-rev3-execution-retirement.py \
  scripts/extend-actions-policy-r5-terminal-archive-phase-b-tranche.py \
  scripts/extend-actions-policy-r5-terminal-archive-phase-b-500-ramp.py \
  scripts/extend-actions-policy-r5-terminal-transport-compaction-preflight.py \
  scripts/extend-actions-policy-r5-terminal-archive-v2-preflight.py \
  scripts/extend-actions-policy-r5-collector-runs-retention-preflight.py \
  scripts/extend-actions-policy-r5-collector-runs-retention-rewrite.py \
  scripts/extend-actions-policy-r5-phase-ready-index-physical-reindex.py \
  scripts/extend-actions-policy-current-repair-deploy-only.py \
  scripts/extend-actions-policy-current-repair-queue-consumer.py
do
  python "$transformer" "$tmp"
done

mkdir -p "$(dirname "$output")"
cp "$tmp" "$output"
sha256sum "$output" | tee 'actions-workflow-policy-evidence/generated-actions-policy.sha256'
