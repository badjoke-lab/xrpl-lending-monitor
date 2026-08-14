#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-retention-readonly-preflight.yml'
probe='scripts/r5-retention-readonly-preflight.mjs'

for path in "$workflow" "$probe"; do
  test -f "$path" || { echo "missing required file: $path" >&2; exit 1; }
done

node --check "$probe"

required_workflow=(
  "github.event.issue.number == 1261"
  "github.event.comment.user.login == 'badjoke-lab'"
  "github.event.comment.body == '/r5-retention-readonly-preflight'"
  "persist-credentials: false"
  'node scripts/r5-retention-readonly-preflight.mjs'
  "retentionBoundary.probeReadOnly"
  "retentionBoundary.noDeleteAuthorized"
  "retentionBoundary.noVacuumAuthorized"
  "retentionBoundary.noSchedulerMutationAuthorized"
  "retentionBoundary.noDeploymentAuthorized"
  "retentionBoundary.mainnetDisabled"
  "Upload sanitized read-only evidence"
  "Publish sanitized read-only result"
)
for fragment in "${required_workflow[@]}"; do
  grep -Fq -- "$fragment" "$workflow" || { echo "workflow missing retention preflight contract fragment: $fragment" >&2; exit 1; }
done

required_probe=(
  "read_only: true"
  "cron.job_run_details"
  "xrpl_phase_payload_chunks"
  "xrpl_phase_commit_chunks"
  "xrpl_phase_messages"
  "xrpl_phase_successors"
  "currentAndPredecessorProtected"
  "canonicalReferenceRowsUntouched"
  "committedWorkRowsUntouched"
  "schedulerMessagesUntouched"
  "successorEdgesUntouched"
  "noDeleteAuthorized"
  "noVacuumAuthorized"
  "noSchedulerMutationAuthorized"
  "noDeploymentAuthorized"
  "mainnetDisabled"
  "routineDependencies"
  "viewDependencies"
  "installedPgstattuple"
  "installedPgFreespacemap"
)
for fragment in "${required_probe[@]}"; do
  grep -Fq -- "$fragment" "$probe" || { echo "probe missing retention preflight contract fragment: $fragment" >&2; exit 1; }
done

for forbidden in \
  'supabase db push' \
  'supabase functions deploy' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  "MAINNET_ENABLED: 'true'" \
  'workflow_dispatch' \
  'pull_request_target'; do
  if grep -Fq -- "$forbidden" "$workflow"; then
    echo "workflow contains forbidden retention capability: $forbidden" >&2
    exit 1
  fi
done

if grep -Eiq '\bdelete[[:space:]]+from\b|\binsert[[:space:]]+into\b|\btruncate\b|\balter[[:space:]]+table\b|\bdrop[[:space:]]+(table|schema)\b' "$probe"; then
  echo 'retention preflight probe contains forbidden mutating SQL' >&2
  exit 1
fi
if grep -Fq 'read_only: false' "$probe"; then
  echo 'retention preflight probe contains writable Management API mode' >&2
  exit 1
fi

issue_write_count="$(grep -Fc 'issues: write' "$workflow")"
test "$issue_write_count" = 1

echo 'R5 retention read-only preflight contract: PASS'
