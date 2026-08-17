#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-phase-message-pkey-reindex-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'generate_series(1,65237)' \
  "repeat('x',21)" \
  '[[ "$before_rows" -eq 50238 ]]' \
  '[[ "$avg_key_bytes" == '\''227.000'\'' ]]' \
  '[[ "$ready_rows" -eq 2 ]]' \
  'create unique index message_shadow_pkey_idx' \
  'reindex index proof.messages_pkey' \
  'injected_message_pkey_reindex_failure' \
  'compactShadowBytes' \
  'conservativeBuildOverheadBytes' \
  'heapBytesPreserved' \
  'readyIndexBytesPreserved' \
  'rowDigestPreserved' \
  'constraintDigestPreserved' \
  'pkeyOidPreserved' \
  'readyIndexOidPreserved' \
  'productionDatabaseUsed' \
  'productionReindexAuthorized'; do
  grep -Fq "$required" "$proof" || { echo "message pkey proof missing: $required" >&2; exit 1; }
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
    echo "message pkey proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text()
if text.count('reindex index proof.messages_pkey;') != 2:
    raise SystemExit('message pkey proof must contain rollback and success REINDEX statements')
if 'delete from proof.messages' not in text.lower():
    raise SystemExit('message pkey proof must model historical btree bloat')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b',text):
    raise SystemExit('message pkey proof broadens REINDEX scope')
if '[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]' not in text:
    raise SystemExit('message pkey proof heap preservation assertion missing')
if '[[ "$after_ready_bytes" -eq "$before_ready_bytes" ]]' not in text:
    raise SystemExit('message pkey proof ready-index preservation assertion missing')
PY

echo 'R5 phase-message pkey reindex local proof contract PASS'
