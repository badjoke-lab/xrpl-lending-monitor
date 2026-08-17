#!/usr/bin/env bash
set -euo pipefail

runner='scripts/run-r5-terminal-archive-phase-b-500-ramp.mjs'
workflow='.github/workflows/r5-terminal-archive-phase-b-500-ramp.yml'
base_workflow='.github/workflows/r5-terminal-archive-phase-b-tranche.yml'
base_manager='scripts/manage-r5-terminal-archive-phase-b-tranche.mjs'
policy='scripts/extend-actions-policy-r5-terminal-archive-phase-b-500-ramp.py'

for file in "$runner" "$workflow" "$base_workflow" "$base_manager" "$policy"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done

node --check "$runner"
python -m py_compile "$policy"

expected_base='03d1af2aff0546a5c348e5847d19e2449d421fe25650b9ad52a588e2acd87b43'
actual_base="$(sha256sum "$base_manager" | awk '{print $1}')"
[[ "$actual_base" == "$expected_base" ]] || {
  echo "base manager digest drift: $actual_base" >&2
  exit 1
}

grep -Fq "const EXPECTED_BASE_SHA256 = '$expected_base'" "$runner"
grep -Fq "const SOURCE_MARKER = 'const TRANCHE_LIMIT = 250'" "$runner"
grep -Fq "const RAMP_MARKER = 'const TRANCHE_LIMIT = 500'" "$runner"
grep -Fq "const BYTE_LIMIT_MARKER = 'const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000'" "$runner"
[[ "$(grep -Fc 'source.replace(SOURCE_MARKER, RAMP_MARKER)' "$runner")" -eq 1 ]]
grep -Fq 'source.split(SOURCE_MARKER).length !== 2' "$runner"
grep -Fq 'await rm(generated, { force: true })' "$runner"

# The proven 250-row path remains intact; the ramp is additive and isolated.
grep -Fq 'const TRANCHE_LIMIT = 250' "$base_manager"
grep -Fq 'const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000' "$base_manager"
grep -Fq 'test "$count" -ge 1 && test "$count" -le 250' "$base_workflow"
grep -Fq '/r5-terminal-archive-phase-b-prepare' "$base_workflow"
grep -Fq '/r5-terminal-archive-phase-b-authorize ' "$base_workflow"

# The 500-row path keeps the same exact-owner, exact-state, 2MB and shared-concurrency boundaries.
for required in \
  "group: r5-terminal-archive-phase-b-tranche" \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "/r5-terminal-archive-phase-b-500-prepare" \
  "/r5-terminal-archive-phase-b-500-authorize " \
  'test "$count" -ge 1 && test "$count" -le 500' \
  'test "$logical" -ge 0 && test "$logical" -le 2000000' \
  'scripts/run-r5-terminal-archive-phase-b-500-ramp.mjs' \
  'canonicalWorkReferenceHistoryMutationPerformed' \
  'physicalCompactionPerformed' \
  'vacuumPerformed' \
  'reindexPerformed' \
  'schedulerMutationPerformed' \
  'deploymentPerformed' \
  'publicReaderMutationPerformed' \
  'mainnetDisabled' \
  'r5Rearmed'; do
  grep -Fq "$required" "$workflow" || { echo "500-ramp workflow missing: $required" >&2; exit 1; }
done

# A ramp PR must not gain any deployment, scheduler, Mainnet or physical-rewrite capability.
for forbidden in \
  '  push:' \
  '  schedule:' \
  'workflow_dispatch' \
  'pull_request_target' \
  'contents: write' \
  'supabase functions deploy' \
  'supabase db push' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "500-ramp workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

# The underlying manager still owns the mutation semantics and retains the proven transaction bounds.
for required in \
  "set local lock_timeout = '5s'" \
  "set local statement_timeout = '180s'" \
  "pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b', 0))" \
  "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0))" \
  'authorized Phase B candidate identity drifted' \
  'R5 successor is not database-guard halted' \
  'terminal archive private/RLS contract drifted' \
  'canonical work/reference history changed during Phase B'; do
  grep -Fq "$required" "$base_manager" || { echo "base manager safety guard missing: $required" >&2; exit 1; }
done

echo 'R5 terminal archive Phase B 500-row ramp contract PASS'
