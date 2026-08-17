#!/usr/bin/env bash
set -euo pipefail

planner='scripts/r5-terminal-archive-capacity-readonly-planner.mjs'
workflow='.github/workflows/r5-index-footprint-readonly-probe.yml'

for file in "$planner" "$workflow"; do
  test -s "$file"
done

node --check "$planner"

for required in \
  'const PROVIDER_DATABASE_LIMIT_BYTES = 500_000_000' \
  'const OPERATIONAL_SAFETY_CEILING_BYTES = 490_000_000' \
  'const INTERNAL_DB_HALT_BYTES = 400_000_000' \
  'const TRANCHE_ROWS = 250' \
  'read_only:true' \
  'safeAdditionalTranches' \
  'vacuumFullMessageConservativePeakBytes' \
  'vacuumFullSuccessorConservativePeakBytes' \
  'additionalTrancheExecutionAuthorized:false' \
  'secondaryIndexMutationAuthorized:false' \
  'physicalCompactionAuthorized:false' \
  'r5RearmAuthorized:false' \
  'productionDatabaseReadOnly:true'; do
  grep -Fq "$required" "$planner"
done

python - "$planner" <<'PY'
from pathlib import Path
import re
import sys

text = Path(sys.argv[1]).read_text()
match = re.search(r"const SQL = String\.raw`(.*?)`;", text, re.S)
if not match:
    raise SystemExit('capacity planner SQL block missing')
sql = match.group(1).lower()
for pattern in (
    r'\bdelete\s+from\b',
    r'\btruncate\b',
    r'\bvacuum\b',
    r'\breindex\b',
    r'\balter\s+table\b',
    r'\bdrop\s+(?:table|index)\b',
    r'\bcreate\s+(?:table|index)\b',
    r'\bupdate\s+',
    r'\binsert\s+into\b',
):
    if re.search(pattern, sql):
        raise SystemExit(f'capacity planner SQL contains forbidden mutation capability: {pattern}')
for forbidden in ('read_only:false', 'cron.schedule', 'cron.unschedule', 'wrangler deploy', 'supabase db push'):
    if forbidden in text.lower():
        raise SystemExit(f'capacity planner contains forbidden execution capability: {forbidden}')
PY

grep -Fq 'Plan terminal archive capacity read-only' "$workflow"
grep -Fq 'r5-terminal-archive-capacity-readonly-planner.mjs' "$workflow"
grep -Fq 'terminal-archive-capacity-planner-summary.md' "$workflow"

echo 'R5 terminal archive capacity read-only planner contract PASS'
