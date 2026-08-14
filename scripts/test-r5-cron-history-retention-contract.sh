#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-cron-history-retention.yml'
manager='scripts/manage-r5-cron-history-retention.mjs'
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
    "github.event.comment.body == '/r5-cron-history-retention-prepare'",
    "startsWith(github.event.comment.body, '/r5-cron-history-retention-authorize ')",
    "persist-credentials: false",
    "Inspect retention and compaction pre-state read-only",
    "prepare.stderr.log",
    "if: always()",
    "Exact physical-compaction mutation SHA-256",
    "mutation=${MUTATION_SHA}",
    "Run-ID sequence / last value / current max runid",
    "The sequence is never reset with \\`setval\\`",
    "Revalidate authorized structural state read-only",
    "Apply exact bounded cron physical compaction",
    "--authorized-mutation \"$MUTATION_SHA\"",
    "physical compaction performed",
    "VACUUM performed",
    "payload/commit deletion: `none`",
    "public XRPL row mutation: `none`",
    "stabilization/soak/R5 restart: `not authorized`",
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
if workflow.count("/r5-cron-history-retention-authorize") != 3:
    raise SystemExit("authorization command surface drifted")

for required in (
    "const JOB_NAME = 'xrpl-r5-cron-history-retention-v1'",
    "const JOB_SCHEDULE = '17 */6 * * *'",
    "const RUN_ID_SEQUENCE = 'cron.runid_seq'",
    "const SUCCESS_HOURS = 24",
    "const FAILURE_DAYS = 7",
    "status = 'succeeded'",
    "status is distinct from 'succeeded'",
    "managementQuery(inspectionSql(), true)",
    "managementQuery(MUTATION_SQL, false)",
    "physicalCompactionMutationSha256",
    "authorized-mutation",
    "authorized mutation SHA does not match exact cron physical-compaction transaction",
    "cron history table has foreign-key dependencies",
    "cron history table has non-internal triggers",
    "pgCronExtension",
    "pgCronExtensionSha256",
    "runIdSequence",
    "runIdSequenceContractSha256",
    "cron.runid_seq",
    "cron runid sequence moved backward",
    "cron runid sequence fell behind pre-compaction max runid",
    "tableDefinitionSha256",
    "constraintsSha256",
    "foreignKeysSha256",
    "nonInternalTriggersSha256",
    "physicalCompactionPerformed: true",
    "vacuumPerformed: false",
    "schedulerMutationPerformed: true",
    "mainnetDisabled: true",
    "r5RestartAuthorized: false",
):
    if required not in manager:
        raise SystemExit(f"manager missing: {required}")
for forbidden in (
    "pg_get_serial_sequence('cron.job_run_details','runid')",
    "pg_get_serial_sequence(\"cron.job_run_details\",\"runid\")",
):
    if forbidden in manager:
        raise SystemExit(f"manager retains invalid serial/identity sequence assumption: {forbidden}")
if re.search(r"\bsetval\s*\(",manager,re.I):
    raise SystemExit("manager must never reset cron.runid_seq with setval")
if manager.count("managementQuery(MUTATION_SQL, false)") != 1:
    raise SystemExit("manager must have exactly one writable Management API call")
for line in manager.splitlines():
    if "managementQuery(" in line and ", false)" in line and "managementQuery(MUTATION_SQL, false)" not in line:
        raise SystemExit(f"unexpected additional writable Management API call: {line.strip()}")

start=manager.find("const MUTATION_SQL = `")
if start < 0:
    raise SystemExit("exact mutation SQL constant missing")
start += len("const MUTATION_SQL = `")
end=manager.find("`\n\nfor (const required",start)
if end < 0:
    raise SystemExit("exact mutation SQL terminator missing")
mutation=manager[start:end]
for required in (
    "begin;",
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '45s';",
    "lock table cron.job_run_details in access exclusive mode;",
    "create temporary table r5_cron_retained on commit drop",
    "select * from cron.job_run_details where ${KEEP_PREDICATE};",
    "'${RUN_ID_SEQUENCE}'::text as sequence_name",
    "select last_value from cron.runid_seq",
    "truncate table cron.job_run_details continue identity;",
    "insert into cron.job_run_details(jobid,runid,job_pid,database,username,command,status,return_message,start_time,end_time)",
    "cron retained-row restoration mismatch",
    "cron physical compaction retained an expired row",
    "cron runid sequence moved backward during compaction",
    "cron runid sequence fell behind pre-compaction max runid",
    "select cron.schedule('${escapedName}', '${escapedSchedule}', '${escapedCommand}');",
    "commit;",
):
    if required not in mutation:
        raise SystemExit(f"mutation SQL missing exact requirement: {required}")
if len(re.findall(r"\btruncate\s+table\b",mutation,re.I)) != 1:
    raise SystemExit("mutation SQL must contain exactly one TRUNCATE TABLE")
if not re.search(r"\btruncate\s+table\s+cron\.job_run_details\s+continue\s+identity\b",mutation,re.I):
    raise SystemExit("mutation SQL TRUNCATE target/identity mode drifted")
for forbidden in (
    r"\bdrop\s+(table|schema)\b",
    r"\balter\s+table\b",
    r"\bvacuum\b",
    r"\bdelete\s+from\s+public\.",
    r"\bupdate\s+cron\.job\b",
    r"\btruncate\s+table\s+(?!cron\.job_run_details\b)",
    r"\bsetval\s*\(",
):
    if re.search(forbidden,mutation,re.I):
        raise SystemExit(f"mutation SQL contains forbidden capability: {forbidden}")
print('R5 cron physical compaction + retention contract: PASS')
PY
