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
    "pre-apply complete candidate works",
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
    "return readOnly ? rowsFromResponse(body) : body",
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
    "candidateWorkCountBefore",
    "candidatePayloadRowsBefore",
    "candidateCommitRowsBefore",
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
if "CLEANUP_SQL.match(/\\bdelete\\s+from\\b/giu)" not in manager:
    raise SystemExit("runtime DELETE-count guard must inspect CLEANUP_SQL")
if "MUTATION_SQL.match(/\\bdelete\\s+from\\b/giu)" in manager:
    raise SystemExit("runtime DELETE-count guard must not inspect expanded MUTATION_SQL")

cleanup_start=manager.find("const CLEANUP_SQL = String.raw`")
if cleanup_start < 0:
    raise SystemExit("cleanup SQL constant missing")
cleanup_start += len("const CLEANUP_SQL = String.raw`")
cleanup_end=manager.find("`\n\nconst escapedCommand",cleanup_start)
if cleanup_end < 0:
    raise SystemExit("cleanup SQL terminator missing")
cleanup=manager[cleanup_start:cleanup_end]
if len(re.findall(r"\bdelete\s+from\b",cleanup,re.I)) != 2:
    raise SystemExit("cleanup must contain exactly two DELETE FROM targets")
for required in (
    "protected_integrity as materialized",
    "candidate_work_ids as materialized",
    "delete from public.xrpl_phase_payload_chunks",
    "delete from public.xrpl_phase_commit_chunks",
    "w.committed_at < now() - interval '${RETENTION_HOURS} hours'",
    "c.status='completed'",
):
    if required not in cleanup:
        raise SystemExit(f"cleanup SQL missing: {required}")
for forbidden in (
    r"\bdelete\s+from\s+public\.(?!xrpl_phase_payload_chunks\b|xrpl_phase_commit_chunks\b)",
    r"\bupdate\b",r"\binsert\b",r"\btruncate\b",r"\balter\b",r"\bdrop\b",r"\bvacuum\b",
):
    if re.search(forbidden,cleanup,re.I):
        raise SystemExit(f"cleanup SQL contains forbidden capability: {forbidden}")

mutation_start=manager.find("const MUTATION_SQL = String.raw`")
if mutation_start < 0:
    raise SystemExit("exact mutation SQL constant missing")
mutation_start += len("const MUTATION_SQL = String.raw`")
mutation_end=manager.find("`\n\nfor (const required",mutation_start)
if mutation_end < 0:
    raise SystemExit("exact mutation SQL terminator missing")
mutation=manager[mutation_start:mutation_end]
for required in (
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '45s';",
    "${CLEANUP_SQL}",
    "select cron.schedule('${escapedName}','${escapedSchedule}','${escapedCommand}');",
    "commit;",
):
    if required not in mutation:
        raise SystemExit(f"mutation SQL missing exact requirement: {required}")
if re.search(r"\b(delete|update|insert|truncate|alter|drop|vacuum)\b",mutation,re.I):
    raise SystemExit("mutation wrapper must not add writable SQL outside CLEANUP_SQL and cron.schedule")
print('R5 guarded raw-evidence retention contract: PASS')
PY
