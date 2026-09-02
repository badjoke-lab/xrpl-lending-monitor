#!/usr/bin/env bash
set -euo pipefail

probe='scripts/r5-terminal-archive-v2-readonly-preflight.mjs'
workflow='.github/workflows/r5-terminal-archive-v2-preflight.yml'
policy="$(mktemp)"
trap 'rm -f "$policy"' EXIT
for file in "$probe" "$workflow"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done
node --check "$probe"
python scripts/compile-current-actions-policy.py "$policy"

for required in \
  "const MIN_ARCHIVE_ROWS = 1500" \
  "xrpl_phase_archive_v1.terminal_messages" \
  'as "nullPayloadRows"' \
  'as "missingWorkIdRows"' \
  'as "workIdRows"' \
  'as "payloadColumnBytes"' \
  'as "workIdMinBytes"' \
  'as "workIdMaxBytes"' \
  'as "workIdAvgBytes"' \
  'as "orderedPayloadDigest"' \
  "archive_consumers" \
  "mentions_archived_payload" \
  "reads_payload_work_id" \
  "read_only: true" \
  "'schemaMutationAuthorized',false" \
  "'archiveRewriteAuthorized',false" \
  "'phaseBMovementAuthorized',false" \
  "'physicalCompactionAuthorized',false" \
  "'r5RearmAuthorized',false"; do
  grep -Fq "$required" "$probe" || { echo "v2 preflight probe missing: $required" >&2; exit 1; }
done

for required in \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "github.event.comment.body == '/r5-terminal-archive-v2-preflight'" \
  "scripts/r5-terminal-archive-v2-readonly-preflight.mjs" \
  "schemaMutationAuthorized" \
  "archiveRewriteAuthorized" \
  "phaseBMovementAuthorized" \
  "physicalCompactionAuthorized" \
  "r5RearmAuthorized"; do
  grep -Fq "$required" "$workflow" || { echo "v2 preflight workflow missing: $required" >&2; exit 1; }
done

for forbidden in \
  '  push:' '  schedule:' 'workflow_dispatch' 'pull_request_target' \
  'contents: write' 'startsWith(github.event.comment.body' \
  'supabase functions deploy' 'supabase db push' 'cron.schedule' 'cron.unschedule' \
  'wrangler deploy' "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "v2 preflight workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

python - "$probe" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
match = re.search(r"const SQL = String\.raw`(.*?)`\n\nif \(!/", text, re.S)
if not match:
    raise SystemExit('v2 preflight SQL literal missing')
sql = re.sub(r"'[^']*'", "''", match.group(1))
for pattern in (
    r'\bdelete\s+from\b', r'\btruncate\b', r'\bvacuum\b', r'\breindex\b',
    r'\bcluster\b', r'\balter\s+table\b', r'\bdrop\s+', r'\bcreate\s+(?:table|index)\b',
    r'\binsert\s+into\b', r'\bupdate\s+',
):
    if re.search(pattern, sql, re.I):
        raise SystemExit(f'v2 preflight SQL contains mutation token: {pattern}')
for key in ('nullPayloadRows','missingWorkIdRows','workIdRows','payloadColumnBytes','workIdMinBytes','workIdMaxBytes','workIdAvgBytes','orderedPayloadDigest'):
    if f'as "{key}"' not in match.group(1):
        raise SystemExit(f'v2 preflight JSON key casing not pinned: {key}')
PY

grep -Fq 'r5-terminal-archive-v2-preflight.yml' "$policy"

echo 'R5 terminal archive v2 production read-only preflight contract PASS'
