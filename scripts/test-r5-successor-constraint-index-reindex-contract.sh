#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-successor-constraint-index-reindex-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'current_message_id text primary key references proof.messages(message_id)' \
  'successor_message_id text not null unique references proof.messages(message_id)' \
  'generate_series(1,65235)' \
  "repeat('x',21)" \
  '[[ "$before_rows" -eq 50235 ]]' \
  '[[ "$avg_current_bytes" == '\''227.000'\'' ]]' \
  '[[ "$avg_successor_bytes" == '\''227.000'\'' ]]' \
  'create unique index successor_shadow_current_idx' \
  'create unique index successor_shadow_successor_idx' \
  'reindex index proof.successors_pkey' \
  'reindex index proof.successors_successor_message_id_key' \
  'injected_successor_pkey_reindex_failure' \
  'injected_successor_unique_reindex_failure' \
  'rowDigestPreserved' \
  'constraintDigestPreserved' \
  'heapBytesPreserved' \
  'pkeyOidPreserved' \
  'uniqueOidPreserved' \
  'compactShadowCurrentBytes' \
  'compactShadowSuccessorBytes' \
  'conservativeCurrentBuildOverheadBytes' \
  'conservativeSuccessorBuildOverheadBytes' \
  'productionDatabaseUsed' \
  'productionReindexAuthorized'; do
  grep -Fq "$required" "$proof" || { echo "successor index reindex proof missing: $required" >&2; exit 1; }
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
    echo "successor index reindex proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text()
if text.count('reindex index proof.successors_pkey;') != 2:
    raise SystemExit('successor pkey proof must contain rollback and success REINDEX statements')
if text.count('reindex index proof.successors_successor_message_id_key;') != 2:
    raise SystemExit('successor unique proof must contain rollback and success REINDEX statements')
if 'delete from proof.successors' not in text.lower():
    raise SystemExit('successor proof must model historical btree bloat')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b',text):
    raise SystemExit('successor proof broadens REINDEX scope')
if '[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]' not in text:
    raise SystemExit('successor proof heap preservation assertion missing')
PY

echo 'R5 successor constraint-index reindex local proof contract PASS'
