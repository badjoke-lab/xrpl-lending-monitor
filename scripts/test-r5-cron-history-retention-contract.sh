#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-cron-history-retention.yml'
manager='scripts/manage-r5-cron-history-retention.mjs'
for path in "$workflow" "$manager"; do test -f "$path" || { echo "missing $path" >&2; exit 1; }; done
node --check "$manager"

for fragment in \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "github.event.comment.body == '/r5-cron-history-retention-prepare'" \
  "startsWith(github.event.comment.body, '/r5-cron-history-retention-authorize ')" \
  "persist-credentials: false" \
  "Inspect retention pre-state read-only" \
  "Apply exact bounded cron retention" \
  "VACUUM performed" \
  'payload/commit deletion: `none`' \
  'stabilization/soak/R5 restart: `not authorized`'; do
  grep -Fq -- "$fragment" "$workflow" || { echo "workflow missing: $fragment" >&2; exit 1; }
done

for fragment in \
  "const JOB_NAME = 'xrpl-r5-cron-history-retention-v1'" \
  "const JOB_SCHEDULE = '17 */6 * * *'" \
  'const SUCCESS_HOURS = 24' \
  'const FAILURE_DAYS = 7' \
  "status = 'succeeded'" \
  "status is distinct from 'succeeded'" \
  'read_only: readOnly' \
  'managementQuery(inspectionSql(), true)' \
  'managementQuery(transaction, false)' \
  'select cron.schedule' \
  'cleanup job already exists before apply' \
  'authorized structural state drifted before cron retention mutation' \
  'vacuumPerformed: false' \
  'schedulerMutationPerformed: true' \
  'mainnetDisabled: true' \
  'r5RestartAuthorized: false'; do
  grep -Fq -- "$fragment" "$manager" || { echo "manager missing: $fragment" >&2; exit 1; }
done

for forbidden in 'supabase db push' 'supabase functions deploy' 'wrangler deploy' "MAINNET_ENABLED: 'true'" 'workflow_dispatch' 'pull_request_target'; do
  ! grep -Fq -- "$forbidden" "$workflow" || { echo "workflow contains forbidden capability: $forbidden" >&2; exit 1; }
done
for forbidden_regex in '\btruncate\b' '\bdrop[[:space:]]+(table|schema)\b' '\bupdate[[:space:]]+cron\.job\b' '\bdelete[[:space:]]+from[[:space:]]+public\.' '\bvacuum\b'; do
  if grep -Eiq "$forbidden_regex" "$manager"; then echo "manager contains forbidden SQL: $forbidden_regex" >&2; exit 1; fi
done

test "$(grep -Fc 'issues: write' "$workflow")" = 1
test "$(grep -Fc 'managementQuery(transaction, false)' "$manager")" = 1
test "$(grep -Fc 'select cron.schedule' "$manager")" = 1

echo 'R5 cron history retention contract: PASS'
