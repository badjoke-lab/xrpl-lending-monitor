#!/usr/bin/env bash
set -euo pipefail

manager='scripts/r5-post-retention-readonly-gate.mjs'
workflow='.github/workflows/r5-retention-readonly-preflight.yml'
for path in "$manager" "$workflow"; do
  test -f "$path" || { echo "missing $path" >&2; exit 1; }
done
node --check "$manager"

python - "$manager" "$workflow" <<'PY'
from pathlib import Path
import re,sys
manager=Path(sys.argv[1]).read_text()
workflow=Path(sys.argv[2]).read_text()

for required in (
    "const DATABASE_HALT_BYTES = 400_000_000",
    "const CRON_JOB_NAME = 'xrpl-r5-cron-history-retention-v1'",
    "const CRON_JOB_SCHEDULE = '17 */6 * * *'",
    "const CRON_JOB_COMMAND_SHA256 = 'ac60d960ced46834e5046f0911d4127cb58e5036f679005d3900d10a7b57ac72'",
    "const RAW_JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'",
    "const RAW_JOB_SCHEDULE = '47 */6 * * *'",
    "const RAW_JOB_COMMAND_SHA256 = 'a7029e464b56f7652b7690b6a8f5b90331d5dfbb0812e3a0ab2788987c64ec98'",
    "const CRON_CADENCE_LAG_BUDGET_ROWS = 360",
    "const RAW_CADENCE_LAG_BUDGET_WORK = 120",
    "body: JSON.stringify({ query, parameters: [], read_only: true })",
    "databaseUnderHalt",
    "activeEvidenceComplete",
    "cronLagWithinCadence",
    "rawLagWithinCadence",
    "productionMutationAuthorized: false",
    "deploymentAuthorized: false",
    "mainnetDisabled: true",
    "r5RestartAuthorized: false",
):
    if required not in manager:
        raise SystemExit(f"manager missing: {required}")
if "read_only: false" in manager or "managementQuery(MUTATION" in manager:
    raise SystemExit("read-only gate contains writable Management API capability")

sql_start=manager.find("const SQL = String.raw`")
if sql_start < 0:
    raise SystemExit("read-only SQL missing")
sql_start += len("const SQL = String.raw`")
sql_end=manager.find("`\n\nfunction integrity", sql_start)
if sql_end < 0:
    raise SystemExit("read-only SQL terminator missing")
sql=manager[sql_start:sql_end]
for forbidden in (r"\bdelete\b",r"\bupdate\b",r"\binsert\b",r"\btruncate\b",r"\balter\b",r"\bdrop\b",r"\bvacuum\b"):
    if re.search(forbidden,sql,re.I):
        raise SystemExit(f"read-only SQL contains forbidden mutation: {forbidden}")
for required in (
    "old_complete_work as (",
    "w.committed_at < now()-interval '24 hours'",
    "status='succeeded' and end_time is not null and start_time < now()-interval '24 hours'",
    "status is distinct from 'succeeded' and end_time is not null and start_time < now()-interval '7 days'",
    "cron.job_run_details",
    "cron.job",
):
    if required not in sql:
        raise SystemExit(f"read-only SQL missing: {required}")

for required in (
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-retention-readonly-preflight'",
    "persist-credentials: false",
    "node scripts/r5-post-retention-readonly-gate.mjs",
    "post-retention-gate.json",
    "post-retention-gate.md",
    ".boundary.readOnly",
    ".boundary.productionMutationAuthorized",
    ".boundary.r5RestartAuthorized",
):
    if required not in workflow:
        raise SystemExit(f"workflow missing: {required}")
for forbidden in (
    "workflow_dispatch","pull_request_target","  push:","  schedule:",
    "supabase db push","supabase functions deploy","wrangler deploy","MAINNET_ENABLED: 'true'",
):
    if forbidden in workflow:
        raise SystemExit(f"workflow contains forbidden capability: {forbidden}")
print('R5 post-retention read-only gate contract: PASS')
PY
