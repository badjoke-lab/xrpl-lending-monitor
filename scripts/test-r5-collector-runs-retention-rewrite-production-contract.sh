#!/usr/bin/env bash
set -euo pipefail

manager='scripts/manage-r5-collector-runs-retention-rewrite.mjs'
workflow='.github/workflows/r5-collector-runs-retention-rewrite.yml'
policy='scripts/extend-actions-policy-r5-collector-runs-retention-rewrite.py'
for file in "$manager" "$workflow" "$policy"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done
node --check "$manager"
python -m py_compile "$policy"

for required in \
  "const RETAIN_LATEST_ROWS=256" \
  "const EXPECTED_MIGRATION_HEAD='20260816050000'" \
  "const MAX_DATABASE_BYTES_BEFORE=490_000_000" \
  "read_only:readOnly" \
  "order by completed_at desc,id desc" \
  "truncate table public.xrpl_collector_runs" \
  "overriding system value" \
  "collector retained identity mismatch after rewrite" \
  "collector identity sequence drift after rewrite" \
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
m=re.search(r"const MUTATION_SQL=String\.raw`(.*?)`\n\nfor\(const required",text,re.S)
if not m:
    raise SystemExit('collector production mutation SQL missing')
sql=m.group(1)
if len(re.findall(r'\btruncate\s+table\b',sql,re.I)) != 1:
    raise SystemExit('collector production mutation must contain exactly one TRUNCATE')
for pattern in (r'\bdelete\s+from\b',r'\brestart\s+identity\b',r'\bcascade\b',r'\bvacuum\b',r'\breindex\b',r'\bcluster\b'):
    if re.search(pattern,sql,re.I):
        raise SystemExit(f'collector production mutation contains forbidden token: {pattern}')
for required in ('limit ${RETAIN_LATEST_ROWS}','overriding system value','sequence_last_value','sequence_is_called'):
    if required not in sql:
        raise SystemExit(f'collector production mutation missing identity guard: {required}')
PY

echo 'R5 collector run retention production rewrite contract PASS'
