#!/usr/bin/env bash
set -euo pipefail
now_epoch="$(date -u +%s)"
evaluate_epoch="$(date -u -d "$EVALUATE_UTC" +%s)"
budget_seconds="$((QUALIFY_TIMEOUT_MINUTES * 60))"
required_seconds="$((evaluate_epoch - now_epoch + FINALIZATION_BUDGET_SECONDS))"
test "$required_seconds" -gt 0
if [ "$required_seconds" -ge "$((budget_seconds - 300))" ]; then
  echo "::error::Qualification time budget invalid: required=${required_seconds}s budget=${budget_seconds}s"
  exit 1
fi
start_epoch="$(date -u -d "$START_UTC" +%s)"
test "$(date -u +%s)" -lt "$start_epoch"
gh issue edit "$STATUS_ISSUE" --title 'P0 RUNNING — complete-history 12-slot pre-soak qualification v4'
gh issue comment "$STATUS_ISSUE" --body "$(cat <<EOF
## Complete-history 12-slot qualification v4 armed

- runtime: \`${RUNTIME_SHA}\`
- start: \`${START_UTC}\` (2026-07-25 17:30 JST)
- final slot: \`${END_UTC}\` (2026-07-25 18:25 JST)
- evaluate: \`${EVALUATE_UTC}\` (2026-07-25 18:30:30 JST)
- exact slots: 12 at 300,000 ms spacing
- metric attribution: persisted Queue \`started_at\`–\`completed_at\` only
- zero-occurrence rule: exact zero in the fixed bundles is valid only with a retained representative public/XRPL witness for that semantic class
- production mutation during the window: none
- deployment/version, base/epoch, immutable publication, cron and Queue topology are frozen before and compared after
EOF
)"
target="$(date -u -d "$PREPARE_UTC" +%s)"
now="$(date -u +%s)"
if [ "$now" -lt "$target" ]; then sleep "$((target-now))"; fi
test "$(date -u +%s)" -lt "$start_epoch"
