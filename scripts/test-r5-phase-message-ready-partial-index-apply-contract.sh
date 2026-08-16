#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-phase-message-ready-partial-index-apply.yml'
manager='scripts/manage-r5-phase-message-ready-live-safe.mjs'
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
  "MANAGER_PATH: scripts/manage-r5-phase-message-ready-live-safe.mjs"
  'node "$MANAGER_PATH" prepare'
  "head=\${MIGRATION_HEAD}"
  "--authorized-state"
  "Authorization expires"
  "Current production migration head"
  "strictly behind the current production migration head"
  "structural authorization digest"
  "Canonical history row mutation authorized"
  "Stabilization/soak/R5 restart"
)
for fragment in "${required_workflow[@]}"; do
  grep -Fq -- "$fragment" "$workflow" || { echo "workflow missing contract fragment: $fragment" >&2; exit 1; }
done

required_manager=(
  "const VERSION = '20260814130000'"
  "const INTERNAL_DB_HALT = 400_000_000"
  "retroactiveTargetBehindHead"
  "maxMigrationVersion > VERSION"
  "structuralStateSha256"
  "targetMigrationRows"
  "readyIndexDefinitionSha256"
  "tableContractSha256"
  "temporaryIndexExists"
  "authorized phase ready-index structural state drifted before mutation"
  "lock table public.xrpl_phase_messages in share mode;"
  "insert into supabase_migrations.schema_migrations"
  "migration head changed across retroactive target apply"
  "phase ready index did not shrink"
  "partial ready index exceeds"
  "phase-message row count decreased"
  "rowMutationPerformed: false"
  "vacuumPerformed: false"
  "schedulerMutationPerformed: false"
  "deploymentPerformed: false"
  "publicReaderMutationPerformed: false"
  "mainnetDisabled: true"
  "command === 'prepare'"
  "command === 'apply'"
)
for fragment in "${required_manager[@]}"; do
  grep -Fq -- "$fragment" "$manager" || { echo "manager missing live-safe contract fragment: $fragment" >&2; exit 1; }
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

for guard in \
  '/\btruncate\b/iu' \
  '/\bdelete\s+from\b/iu' \
  '/\bvacuum\b/iu' \
  '/\bdrop\s+table\b/iu'; do
  grep -Fq -- "$guard" "$manager" || { echo "manager missing runtime forbidden-SQL guard: $guard" >&2; exit 1; }
done

prepare_count="$(grep -Fc "github.event.comment.body == '/r5-phase-ready-index-prepare'" "$workflow")"
authorize_count="$(grep -Fc "startsWith(github.event.comment.body, '/r5-phase-ready-index-authorize ')" "$workflow")"
test "$prepare_count" = 1
test "$authorize_count" = 1

if grep -Fq "PREVIOUS_MIGRATION_VERSION" "$workflow" || grep -Fq "PREVIOUS_VERSION" "$manager"; then
  echo 'live-safe phase ready-index path must not depend on a frozen historical migration head' >&2
  exit 1
fi

echo 'R5 phase message ready partial-index live-safe apply contract: PASS'
