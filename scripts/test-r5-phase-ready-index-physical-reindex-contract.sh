#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-phase-ready-index-physical-reindex-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'create index messages_ready_idx' \
  "where status in ('pending','retry','leased')" \
  'generate_series(1,40000)' \
  '[[ "$before_ready_rows" -eq 2 ]]' \
  'reindex index proof.messages_ready_idx' \
  'injected_ready_reindex_failure' \
  'rowDigestPreserved' \
  'indexOidPreserved' \
  'tableOidPreserved' \
  'indexDefinitionPreserved' \
  'heapBytesPreserved' \
  'rollbackVerified' \
  'indexBytesReclaimed' \
  'peakOverheadBytes' \
  'productionDatabaseUsed' \
  'productionReindexAuthorized'; do
  grep -Fq "$required" "$proof" || { echo "ready reindex proof missing: $required" >&2; exit 1; }
done

for forbidden in \
  'SUPABASE_ACCESS_TOKEN' \
  'SUPABASE_PROJECT_ID' \
  'api.supabase.com' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  'supabase functions deploy' \
  'MAINNET_ENABLED' \
  'r5Rearm' \
  'r5-revision4-resource-halt-rearm'; do
  if grep -Fq "$forbidden" "$proof"; then
    echo "ready reindex proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
if text.count('reindex index proof.messages_ready_idx;') != 2:
    raise SystemExit('ready reindex proof must contain exactly rollback and success REINDEX statements')
if 'delete from' in text.lower() or 'truncate table' in text.lower():
    raise SystemExit('ready reindex proof must not use row deletion or truncation')
if '[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]' not in text:
    raise SystemExit('ready reindex heap preservation assertion missing')
PY

echo 'R5 phase ready-index physical reindex local proof contract PASS'
