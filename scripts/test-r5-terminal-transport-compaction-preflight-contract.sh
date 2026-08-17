#!/usr/bin/env bash
set -euo pipefail

probe='scripts/r5-terminal-transport-compaction-readonly-preflight.mjs'
workflow='.github/workflows/r5-terminal-transport-compaction-preflight.yml'
policy='scripts/extend-actions-policy-r5-terminal-transport-compaction-preflight.py'

for file in "$probe" "$workflow" "$policy"; do
  [[ -f "$file" ]] || { echo "missing $file" >&2; exit 1; }
done

node --check "$probe"
python -m py_compile "$policy"

grep -Fq "const MIN_ARCHIVE_ROWS = 1500" "$probe"
grep -Fq "const CHECKPOINT_AFTER_DEFINITION_SHA256 = 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733'" "$probe"
grep -Fq "body: JSON.stringify({ query: sql, parameters: [], read_only: true })" "$probe"
grep -Fq "'public.xrpl_phase_messages'" "$probe"
grep -Fq "'public.xrpl_phase_successors'" "$probe"
grep -Fq "'inboundForeignKeys'" "$probe"
grep -Fq "'userTriggers'" "$probe"
grep -Fq "'dependentViews'" "$probe"
grep -Fq "n_dead_tup" "$probe"
grep -Fq "r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint" "$probe"
grep -Fq "'physicalCompactionAuthorized',false" "$probe"
grep -Fq "'vacuumAuthorized',false" "$probe"
grep -Fq "'reindexAuthorized',false" "$probe"
grep -Fq "'clusterAuthorized',false" "$probe"
grep -Fq "'r5RearmAuthorized',false" "$probe"

for required in \
  "github.event.issue.number == 1261" \
  "github.event.comment.user.login == 'badjoke-lab'" \
  "github.event.comment.body == '/r5-terminal-transport-compaction-preflight'" \
  "scripts/r5-terminal-transport-compaction-readonly-preflight.mjs" \
  'read_only:true' \
  "physicalCompactionAuthorized" \
  "vacuumAuthorized" \
  "reindexAuthorized" \
  "clusterAuthorized" \
  "r5RearmAuthorized"; do
  grep -Fq "$required" "$workflow" || { echo "workflow missing: $required" >&2; exit 1; }
done

# No execution path or production mutation is permitted in this preflight.
for forbidden in \
  '  push:' \
  '  schedule:' \
  'workflow_dispatch' \
  'pull_request_target' \
  'contents: write' \
  'startsWith(github.event.comment.body' \
  'supabase functions deploy' \
  'supabase db push' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  "MAINNET_ENABLED: 'true'"; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "preflight workflow contains forbidden capability: $forbidden" >&2
    exit 1
  fi
done

# The query must remain a single read-only SELECT. Mutation words may occur only in
# JavaScript fail-closed regexes/labels, never as executable SQL statements.
python - "$probe" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
match = re.search(r"const SQL = String\.raw`(.*?)`\n\nif \(!/", text, re.S)
if not match:
    raise SystemExit('SQL literal not found')
sql = match.group(1)
if not re.match(r'^\s*select\b', sql, re.I):
    raise SystemExit('Phase C preflight SQL is not SELECT-only')
for pattern in (
    r'\bdelete\s+from\b', r'\btruncate\b', r'\bvacuum\b', r'\breindex\b',
    r'\bcluster\b', r'\balter\s+table\b', r'\bdrop\s+', r'\bcreate\s+(?:table|index)\b',
    r'\binsert\s+into\b', r'\bupdate\s+',
):
    if re.search(pattern, sql, re.I):
        raise SystemExit(f'Phase C preflight SQL contains mutation token: {pattern}')
PY

echo 'R5 terminal transport compaction read-only preflight contract PASS'
