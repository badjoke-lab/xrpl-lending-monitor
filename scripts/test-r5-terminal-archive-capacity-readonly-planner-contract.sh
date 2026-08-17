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
  'const SQL = String.raw`' \
  "capacity planner must be one read-only WITH/SELECT statement" \
  "capacity planner SQL contains mutation capability" \
  'body:JSON.stringify({query:sql,read_only:true})' \
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

# The planner itself owns the SQL AST-like capability guard. This contract verifies
# that the guard and read_only Management API path remain present without duplicating
# fragile parsing of the JavaScript template literal.
for forbidden in 'read_only:false' 'cron.schedule' 'cron.unschedule' 'wrangler deploy' 'supabase db push'; do
  if grep -Fiq "$forbidden" "$planner"; then
    echo "capacity planner contains forbidden execution capability: $forbidden" >&2
    exit 1
  fi
done

grep -Fq 'Plan terminal archive capacity read-only' "$workflow"
grep -Fq 'r5-terminal-archive-capacity-readonly-planner.mjs' "$workflow"
grep -Fq 'terminal-archive-capacity-planner-summary.md' "$workflow"

echo 'R5 terminal archive capacity read-only planner contract PASS'
