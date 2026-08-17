#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-terminal-archive-phase-b-preflight.yml'
manager='scripts/manage-r5-terminal-archive-phase-b-preflight.mjs'
extender='scripts/extend-actions-policy-r5-terminal-archive-phase-b-preflight.py'

for file in "$workflow" "$manager" "$extender"; do
  test -s "$file"
done

node --check "$manager"
python -m py_compile "$extender"

grep -Fq "github.event.comment.body == '/r5-terminal-archive-phase-b-preflight'" "$workflow"
grep -Fq 'Inspect Phase B preconditions read-only' "$workflow"
grep -Fq 'readyForPhaseBDataMutation' "$workflow"
grep -Fq 'read_only: true' "$manager"
grep -Fq 'retainedToEligible' "$manager"
grep -Fq 'legacyRetirementRequired' "$manager"
grep -Fq 'terminalTransportMutationAuthorized: false' "$manager"
grep -Fq 'physicalCompactionAuthorized: false' "$manager"
grep -Fq 'r5RearmAuthorized: false' "$manager"

for forbidden in 'workflow_dispatch' 'pull_request_target' 'contents: write' 'supabase db push' 'wrangler deploy'; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "forbidden Phase B workflow capability: $forbidden" >&2
    exit 1
  fi
done

if grep -Eiq 'delete[[:space:]]+from[[:space:]]+public\.xrpl_phase_(messages|successors)|\btruncate\b|\bvacuum\b|\breindex\b' "$manager"; then
  echo 'Phase B preflight manager contains row/physical mutation SQL' >&2
  exit 1
fi
