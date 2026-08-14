#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-index-footprint-readonly-probe.yml'
manager='scripts/r5-secondary-index-readonly-audit.mjs'
test -f "$workflow"
test -f "$manager"
node --check "$manager"

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re,sys
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
for pattern in (r'\bdelete\s+from\b',r'\btruncate\b',r'\bvacuum\b',r'\bdrop\s+index\b',r'\bcreate\s+index\b',r'\balter\s+index\b'):
    if re.search(pattern,manager,re.I):
        raise SystemExit(f'secondary audit source contains forbidden mutation capability: {pattern}')
print('R5 secondary index read-only audit contract: PASS')
PY
