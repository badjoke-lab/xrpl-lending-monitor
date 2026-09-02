#!/usr/bin/env bash
set -euo pipefail

manager='scripts/manage-r5-collector-runs-retention-rewrite.mjs'
workflow='.github/workflows/r5-collector-runs-retention-rewrite.yml'
policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
for file in "$manager" "$workflow"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done
node --check "$manager"
python scripts/compile-current-actions-policy.py "$policy"

for required in \
  "const RETAIN_LATEST_ROWS=256" \
  "const EXPECTED_MIGRATION_HEAD='20260816050000'" \
  "const MAX_DATABASE_BYTES_BEFORE=490_000_000" \
  "read_only:readOnly" \
  "function mutationSql(expected)" \
  "assertDataStateForMutation(expected)" \
  "lock table public.xrpl_collector_runs in access exclusive mode" \
  "collector authorized data state drift under lock" \
  "order by completed_at desc,id desc" \
  "truncate table public.xrpl_collector_runs" \
  "overriding system value" \
  "collector retained identity mismatch after rewrite" \
  "collector identity sequence drift after rewrite" \
  "transactionLockRevalidation:true" \
  "authorized structural state mismatch" \
  "authorized data state mismatch" \
  "authorized plan mismatch" \
  "post-rewrite structural state mismatch" \
  "relation bytes were not reclaimed" \
  "database bytes were not reclaimed" \
  "r5RearmPerformed:false"; do
  grep -Fq "$required" "$manager" || { echo "collector production manager missing: $required" >&2; exit 1; }
done

for required in \
  "github.event.comment.body == '/r5-collector-runs-retention-rewrite-prepare'" \
  "startsWith(github.event.comment.body, '/r5-collector-runs-retention-rewrite-authorize ')" \
  "Verify exact prior proposal and unique owner authorization" \
  "Revalidate exact authorized state read-only" \
  "Apply exact bounded collector retention rewrite" \
  "authorized-state" \
  "authorized-data" \
  "authorized-plan" \
  "authorized-mutation"; do
  grep -Fq "$required" "$workflow" || { echo "collector production workflow missing: $required" >&2; exit 1; }
done

for forbidden in \
  '  push:' '  schedule:' 'workflow_dispatch' 'pull_request_target' \
  'contents: write' 'supabase functions deploy' 'supabase db push' \
  'cron.schedule' 'cron.unschedule' 'wrangler deploy' "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "collector production workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

python - "$manager" <<'PY'
from pathlib import Path
import re, sys
text=Path(sys.argv[1]).read_text()
start=text.find('function mutationSql(expected)')
end=text.find('const MUTATION_CONTRACT_SAMPLE=', start)
if start < 0 or end < 0:
    raise SystemExit('collector production mutation renderer missing')
body=text[start:end]
for required in (
    "lock table public.xrpl_collector_runs in access exclusive mode",
    "collector authorized data state drift under lock",
    "truncate table public.xrpl_collector_runs",
    "overriding system value",
    "expected.retainedDigest",
    "expected.candidateDigest",
    "expected.sequenceState.lastValue",
):
    if required not in body:
        raise SystemExit(f'collector production mutation renderer missing: {required}')
if body.find('collector authorized data state drift under lock') > body.find('truncate table public.xrpl_collector_runs'):
    raise SystemExit('authorized data revalidation must occur before TRUNCATE')
if len(re.findall(r'\btruncate\s+table\b',body,re.I)) != 1:
    raise SystemExit('collector production mutation must contain exactly one TRUNCATE')
for pattern in (r'\bdelete\s+from\b',r'\brestart\s+identity\b',r'\bcascade\b',r'\bvacuum\b',r'\breindex\b',r'\bcluster\b'):
    if re.search(pattern,body,re.I):
        raise SystemExit(f'collector production mutation contains forbidden token: {pattern}')
if "const exactMutation=mutationSql(before.dataState)" not in text or "sha256(exactMutation)!==authorizedMutation" not in text:
    raise SystemExit('authorized dynamic mutation reconstruction missing')
PY

grep -Fq 'r5-collector-runs-retention-rewrite.yml' "$policy"

echo 'R5 collector run retention production rewrite contract PASS'
