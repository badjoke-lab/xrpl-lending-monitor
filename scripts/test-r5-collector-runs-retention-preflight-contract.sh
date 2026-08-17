#!/usr/bin/env bash
set -euo pipefail

probe='scripts/r5-collector-runs-retention-readonly-preflight.mjs'
workflow='.github/workflows/r5-collector-runs-retention-preflight.yml'
policy='scripts/extend-actions-policy-r5-collector-runs-retention-preflight.py'
for file in "$probe" "$workflow" "$policy"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done
node --check "$probe"
python -m py_compile "$policy"

for required in \
  "const RETAIN_LATEST_ROWS = 256" \
  "public.xrpl_collector_runs" \
  "row_number() over (order by completed_at desc nulls last, id desc)" \
  "'candidateLogicalBytes'" \
  "'candidateDigest'" \
  "'inboundForeignKeys'" \
  "sequence_state" \
  "routine_consumers" \
  "read_only: true" \
  "'retentionMutationAuthorized',false" \
  "'physicalRewriteAuthorized',false" \
  "'sequenceMutationAuthorized',false" \
  "'r5RearmAuthorized',false"; do
  grep -Fq "$required" "$probe" || { echo "collector preflight probe missing: $required" >&2; exit 1; }
done

for required in \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "github.event.comment.body == '/r5-collector-runs-retention-preflight'" \
  "scripts/r5-collector-runs-retention-readonly-preflight.mjs" \
  "retentionMutationAuthorized" \
  "physicalRewriteAuthorized" \
  "sequenceMutationAuthorized" \
  "r5RearmAuthorized"; do
  grep -Fq "$required" "$workflow" || { echo "collector preflight workflow missing: $required" >&2; exit 1; }
done

for forbidden in \
  '  push:' '  schedule:' 'workflow_dispatch' 'pull_request_target' \
  'contents: write' 'startsWith(github.event.comment.body' \
  'supabase functions deploy' 'supabase db push' 'cron.schedule' 'cron.unschedule' \
  'wrangler deploy' "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "collector preflight workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

python - "$probe" <<'PY'
from pathlib import Path
import re, sys
text=Path(sys.argv[1]).read_text()
match=re.search(r"const SQL = String\.raw`(.*?)`\n\nif \(!/",text,re.S)
if not match:
    raise SystemExit('collector preflight SQL literal missing')
sql=re.sub(r"'[^']*'","''",match.group(1))
for pattern in (
    r'\bdelete\s+from\b',r'\btruncate\b',r'\bvacuum\b',r'\breindex\b',r'\bcluster\b',
    r'\balter\s+table\b',r'\bdrop\s+',r'\bcreate\s+(?:table|index)\b',r'\binsert\s+into\b',
    r'\bupdate\s+',r'\bsetval\s*\(',
):
    if re.search(pattern,sql,re.I):
        raise SystemExit(f'collector preflight SQL contains mutation token: {pattern}')
PY

echo 'R5 collector run retention read-only preflight contract PASS'
