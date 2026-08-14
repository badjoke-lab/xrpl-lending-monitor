#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-index-footprint-readonly-probe.yml'
manager='scripts/r5-secondary-index-readonly-audit.mjs'
test -f "$workflow"
test -f "$manager"
node --check "$manager"

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import sys
workflow=Path(sys.argv[1]).read_text()
manager=Path(sys.argv[2]).read_text()
for required in (
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-index-footprint-readonly-probe'",
    "scripts/r5-secondary-index-readonly-audit.mjs",
    "Read secondary index consumers and planner only",
    "secondary-summary.md",
):
    if required not in workflow: raise SystemExit(f'workflow missing: {required}')
for forbidden in ('  push:','  schedule:','workflow_dispatch','pull_request_target','contents: write','supabase db push','wrangler deploy'):
    if forbidden in workflow: raise SystemExit(f'workflow contains forbidden capability: {forbidden}')
for required in (
    "const MUTATION_CAPABILITY =",
    "MUTATION_CAPABILITY.test(query)",
    "body:JSON.stringify({query:sql,read_only:true})",
    "noIndexMutationAuthorized",
    "noRowMutationAuthorized",
    "noVacuumAuthorized",
    "noSchedulerMutationAuthorized",
    "noDeploymentAuthorized",
    "mainnetDisabled",
    "xrpl_collector_runs_profile_completed_idx",
    "xrpl_phase_work_committed_reader_idx",
    "pg_stat_statements",
    "explain (format json,costs off)",
):
    if required not in manager: raise SystemExit(f'manager missing: {required}')
if 'read_only:false' in manager or 'read_only: false' in manager:
    raise SystemExit('secondary index audit contains writable Management API call')
if manager.count('read_only:true') != 1:
    raise SystemExit('secondary index audit Management API read-only contract drifted')
if 'managementQuery(' in manager:
    raise SystemExit('secondary index audit unexpectedly introduced a second Management API helper')
print('R5 secondary index read-only audit contract: PASS')
PY
