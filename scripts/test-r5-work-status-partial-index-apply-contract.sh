#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-work-status-partial-index-apply.yml'
manager='scripts/manage-r5-work-status-partial-index.mjs'
test -f "$workflow"
test -f "$manager"
node --check "$manager"

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re
import sys

workflow = Path(sys.argv[1]).read_text()
manager = Path(sys.argv[2]).read_text()

for required in (
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-work-status-index-prepare'",
    "startsWith(github.event.comment.body, '/r5-work-status-index-authorize ')",
    "test \"$(jq -r '.indexMutationAuthorized' /tmp/r5-work-status-index-prepare.json)\" = false",
    "test \"$(jq -r '.rowMutationAuthorized' /tmp/r5-work-status-index-prepare.json)\" = false",
    "test \"$(jq -r '.vacuumAuthorized' /tmp/r5-work-status-index-prepare.json)\" = false",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "--authorized-state \"$STATE_SHA\" --authorized-mutation \"$MUTATION_SHA\"",
):
    if required not in workflow:
        raise SystemExit(f"workflow missing guarded requirement: {required}")
for forbidden in (
    "  schedule:",
    "  push:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase db push",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in workflow:
        raise SystemExit(f"workflow contains forbidden capability: {forbidden.strip()}")
if workflow.count("issues: write") != 1:
    raise SystemExit("workflow issue-write permission must occur exactly once")
if workflow.count("/r5-work-status-index-authorize") != 3:
    raise SystemExit("authorization command surface drifted")

start = manager.find("const MUTATION_SQL = String.raw`")
if start < 0:
    raise SystemExit("exact mutation SQL constant missing")
start += len("const MUTATION_SQL = String.raw`")
end = manager.find("`\n\nfor (const forbidden", start)
if end < 0:
    raise SystemExit("exact mutation SQL terminator missing")
mutation = manager[start:end]

for required in (
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '45s';",
    "lock table public.xrpl_phase_work in share mode;",
    "create index xrpl_phase_work_status_noncommitted_idx",
    "on public.xrpl_phase_work(profile_id,status,updated_at,work_id)",
    "where status <> 'committed';",
    "drop index public.xrpl_phase_work_status_idx;",
    "alter index public.xrpl_phase_work_status_noncommitted_idx rename to xrpl_phase_work_status_idx;",
    "commit;",
):
    if required not in mutation:
        raise SystemExit(f"mutation SQL missing exact requirement: {required}")
for forbidden in (
    r"\bdelete\s+from\b",
    r"\bupdate\s+[a-z_]",
    r"\binsert\s+into\b",
    r"\btruncate\b",
    r"\bvacuum\b",
    r"\bdrop\s+table\b",
    r"\balter\s+table\b",
    r"\bcreate\s+table\b",
    r"\bcron\.",
):
    if re.search(forbidden, mutation, re.I):
        raise SystemExit(f"mutation SQL contains forbidden capability: {forbidden}")
if manager.count("managementQuery(MUTATION_SQL, false)") != 1:
    raise SystemExit("manager writable Management API call must be exactly one exact DDL transaction")
other_false = [line.strip() for line in manager.splitlines() if "managementQuery(" in line and ", false)" in line and "managementQuery(MUTATION_SQL, false)" not in line]
if other_false:
    raise SystemExit(f"unexpected additional writable Management API call(s): {other_false}")
for required in (
    "managementQuery(inspectionSql(), true)",
    "structuralStateSha256",
    "mutationSha256",
    "workStatusIndexShape !== 'full'",
    "workStatusIndexShape !== 'partial'",
    "plannerEvidence()",
    "databaseBelowHaltAfter",
    "rowMutationPerformed: false",
    "vacuumPerformed: false",
    "schedulerMutationPerformed: false",
    "deploymentPerformed: false",
    "mainnetDisabled: true",
):
    if required not in manager:
        raise SystemExit(f"manager missing fail-closed requirement: {required}")
print("R5 work-status partial-index apply contract: PASS")
PY
