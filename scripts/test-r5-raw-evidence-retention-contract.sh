#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-raw-evidence-retention.yml'
manager='scripts/manage-r5-raw-evidence-retention.mjs'
for path in "$workflow" "$manager"; do test -f "$path" || { echo "missing $path" >&2; exit 1; }; done
node --check "$manager"

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re,sys
workflow=Path(sys.argv[1]).read_text()
manager=Path(sys.argv[2]).read_text()

for required in (
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-raw-evidence-retention-prepare'",
    "startsWith(github.event.comment.body, '/r5-raw-evidence-retention-authorize ')",
    "persist-credentials: false",
    "Inspect raw-evidence retention pre-state read-only",
    "prepare.stderr.log",
    "if: always()",
    "Exact initial mutation SHA-256",
    "mutation=${MUTATION_SHA}",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded raw-evidence retention",
    "--authorized-mutation \"$MUTATION_SHA\"",
    "writable targets: `xrpl_phase_payload_chunks / xrpl_phase_commit_chunks only`",
    "VACUUM/TRUNCATE/schema DDL: `none`",
    "deployment/Mainnet/stabilization/soak/R5 restart: `not authorized`",
):
    if required not in workflow:
        raise SystemExit(f"workflow missing: {required}")
for forbidden in (
    "supabase db push","supabase functions deploy","wrangler deploy","MAINNET_ENABLED: 'true'",
    "workflow_dispatch","pull_request_target","  push:","  schedule:","contents: write",
):
    if forbidden in workflow:
        raise SystemExit(f"workflow contains forbidden capability: {forbidden}")
if workflow.count("issues: write") != 1:
    raise SystemExit("workflow issue-write permission drifted")
if workflow.count("/r5-raw-evidence-retention-authorize") != 3:
    raise SystemExit("authorization command surface drifted")

for required in (
    "const PROFILE_ID = 'supabase-devnet'",
    "const JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'",
    "const JOB_SCHEDULE = '47 */6 * * *'",
    "const RETENTION_HOURS = 24",
    "managementQuery(inspectionSql(), true)",
    "managementQuery(MUTATION_SQL, false)",
    "delete from public.xrpl_phase_payload_chunks",
    "delete from public.xrpl_phase_commit_chunks",
    "protected_integrity as materialized",
    "candidate_work_ids as materialized",
    "w.committed_at < now() - interval '${RETENTION_HOURS} hours'",
    "c.status='completed'",
    "set local lock_timeout = '5s'",
    "set local statement_timeout = '45s'",
    "authorized mutation SHA does not match exact raw-evidence retention transaction",
    "current payload evidence is incomplete",
    "current commit evidence is incomplete",
    "predecessor payload evidence is incomplete",
    "predecessor commit evidence is incomplete",
    "rowMutationTargets: ['public.xrpl_phase_payload_chunks', 'public.xrpl_phase_commit_chunks']",
    "workRowMutationPerformed: false",
    "canonicalReferenceMutationPerformed: false",
    "messageMutationPerformed: false",
    "successorMutationPerformed: false",
    "vacuumPerformed: false",
    "deploymentPerformed: false",
    "mainnetDisabled: true",
    "stabilizationAuthorized: false",
    "soakAuthorized: false",
    "r5RestartAuthorized: false",
):
    if required not in manager:
        raise SystemExit(f"manager missing: {required}")
if manager.count("managementQuery(MUTATION_SQL, false)") != 1:
    raise SystemExit("manager must have exactly one writable Management API call")
for line in manager.splitlines():
    if "managementQuery(" in line and ", false)" in line and "managementQuery(MUTATION_SQL, false)" not in line:
        raise SystemExit(f"unexpected additional writable Management API call: {line.strip()}")

start=manager.find("const MUTATION_SQL = String.raw`")
if start < 0:
    raise SystemExit("exact mutation SQL constant missing")
start += len("const MUTATION_SQL = String.raw`")
end=manager.find("`\n\nfor (const required",start)
if end < 0:
    raise SystemExit("exact mutation SQL terminator missing")
mutation=manager[start:end]
if len(re.findall(r"\bdelete\s+from\b",mutation,re.I)) != 2:
    raise SystemExit("mutation must contain exactly two DELETE FROM targets")
for required in (
    "delete from public.xrpl_phase_payload_chunks",
    "delete from public.xrpl_phase_commit_chunks",
    "protected_integrity as materialized",
    "select cron.schedule('${escapedName}','${escapedSchedule}','${escapedCommand}');",
):
    if required not in mutation:
        raise SystemExit(f"mutation SQL missing: {required}")
for forbidden in (
    r"\bdelete\s+from\s+public\.(?!xrpl_phase_payload_chunks\b|xrpl_phase_commit_chunks\b)",
    r"\bupdate\b",r"\binsert\b",r"\btruncate\b",r"\balter\b",r"\bdrop\b",r"\bvacuum\b",
):
    if re.search(forbidden,mutation,re.I):
        raise SystemExit(f"mutation SQL contains forbidden capability: {forbidden}")
print('R5 guarded raw-evidence retention contract: PASS')
PY
