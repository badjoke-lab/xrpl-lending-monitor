#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-phase-message-ready-partial-index-apply.yml'
manager='scripts/manage-r5-phase-message-ready-partial-index.mjs'
migration='supabase/migrations/20260814130000_xrpl_phase_messages_ready_partial_index.sql'

for path in "$workflow" "$manager" "$migration"; do
  test -f "$path" || { echo "missing required file: $path" >&2; exit 1; }
done

node --check "$manager"
bash -n scripts/test-r5-phase-message-ready-partial-index-postgres.sh

required_workflow=(
  "github.event.issue.number == 1261"
  "github.event.comment.user.login == 'badjoke-lab'"
  "github.event.comment.body == '/r5-phase-ready-index-prepare'"
  "startsWith(github.event.comment.body, '/r5-phase-ready-index-authorize ')"
  "TARGET_MIGRATION_VERSION: '20260814130000'"
  "PREVIOUS_MIGRATION_VERSION: '20260813072000'"
  "--expect full"
  "--authorized-state"
  "--expect partial"
  "Authorization expires"
  "Canonical history row mutation authorized"
  "Stabilization/soak/R5 restart"
)
for fragment in "${required_workflow[@]}"; do
  grep -Fq -- "$fragment" "$workflow" || { echo "workflow missing contract fragment: $fragment" >&2; exit 1; }
done

required_manager=(
  "const VERSION = '20260814130000'"
  "const PREVIOUS_VERSION = '20260813072000'"
  "readOnly = true"
  "managementQuery(transaction, [], false)"
  "set local lock_timeout = '5s';"
  "set local statement_timeout = '45s';"
  "target partial-index migration is already recorded"
  "authorized production index state drifted before mutation"
  "message row count decreased across index-only migration"
  "canonicalHistoryMutationAuthorized: false"
  "schedulerMutationAuthorized: false"
  "publicReaderMutationAuthorized: false"
  "mainnetDisabled: true"
)
for fragment in "${required_manager[@]}"; do
  grep -Fq -- "$fragment" "$manager" || { echo "manager missing contract fragment: $fragment" >&2; exit 1; }
done

for forbidden in \
  'supabase db push' \
  'supabase functions deploy' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  "MAINNET_ENABLED: 'true'"; do
  if grep -Fq -- "$forbidden" "$workflow"; then
    echo "workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

if grep -Eiq '\b(truncate|vacuum)\b|\bdelete[[:space:]]+from\b|\bdrop[[:space:]]+(table|schema)\b' "$migration"; then
  echo 'migration contains forbidden destructive row/schema operation' >&2
  exit 1
fi

# The manager intentionally contains regex literals naming forbidden SQL so it can
# reject such migration text at runtime. Verify that guard exists rather than
# grepping the manager for those words and matching the guard itself.
for guard in \
  '/\btruncate\b/iu' \
  '/\bdelete\s+from\b/iu' \
  '/\bvacuum\b/iu' \
  '/\bdrop\s+table\b/iu' \
  '/\bdrop\s+schema\b/iu'; do
  grep -Fq -- "$guard" "$manager" || { echo "manager missing runtime forbidden-SQL guard: $guard" >&2; exit 1; }
done

prepare_count="$(grep -Fc "github.event.comment.body == '/r5-phase-ready-index-prepare'" "$workflow")"
authorize_count="$(grep -Fc "startsWith(github.event.comment.body, '/r5-phase-ready-index-authorize ')" "$workflow")"
test "$prepare_count" = 1
test "$authorize_count" = 1

echo 'R5 phase message ready partial-index apply contract: PASS'
