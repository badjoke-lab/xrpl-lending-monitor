#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-work-index-reindex-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'generate_series(1,17064)' \
  "vacuum analyze proof.xrpl_phase_work" \
  '[[ "$before_rows" -eq 17064 ]]' \
  '[[ "$before_committed" -eq 17063 ]]' \
  '[[ "$before_staged" -eq 1 ]]' \
  'create unique index shadow_pkey' \
  'create unique index shadow_unique' \
  'create index shadow_reader' \
  'reindex index proof.${target}' \
  'reindex_one xrpl_phase_work_pkey injected_work_pkey_reindex_failure pkey' \
  'reindex_one xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key injected_work_unique_reindex_failure unique' \
  'reindex_one xrpl_phase_work_committed_reader_idx injected_work_reader_reindex_failure reader' \
  'injected_work_pkey_reindex_failure' \
  'injected_work_unique_reindex_failure' \
  'injected_work_reader_reindex_failure' \
  'compactShadowPkeyBytes' \
  'compactShadowUniqueBytes' \
  'compactShadowReaderBytes' \
  'totalTargetIndexBytesReclaimed' \
  'heapBytesPreserved' \
  'statusIndexBytesPreserved' \
  'rowDigestPreserved' \
  'constraintDigestPreserved' \
  'pkeyOidPreserved' \
  'uniqueOidPreserved' \
  'readerOidPreserved' \
  'statusOidPreserved' \
  'productionDatabaseUsed' \
  'productionReindexAuthorized'; do
  grep -Fq "$required" "$proof" || { echo "work index reindex proof missing: $required" >&2; exit 1; }
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
    echo "work index reindex proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import re,sys
text=Path(sys.argv[1]).read_text()
if text.count('reindex index proof.${target};') != 2:
    raise SystemExit('work proof must contain rollback and success target-specific REINDEX statements')
for call in (
    'reindex_one xrpl_phase_work_pkey injected_work_pkey_reindex_failure pkey',
    'reindex_one xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key injected_work_unique_reindex_failure unique',
    'reindex_one xrpl_phase_work_committed_reader_idx injected_work_reader_reindex_failure reader',
):
    if text.count(call) != 1:
        raise SystemExit(f'work proof target invocation missing or duplicated: {call}')
if 'update proof.xrpl_phase_work set status=' not in text.lower():
    raise SystemExit('work proof must model status-transition bloat')
if 'vacuum analyze proof.xrpl_phase_work;' not in text.lower():
    raise SystemExit('work proof must remove dead tuples before measuring persistent btree bloat')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b',text):
    raise SystemExit('work proof broadens REINDEX scope')
if '[[ "$after_heap_bytes" -eq "$before_heap_bytes" ]]' not in text:
    raise SystemExit('work proof heap preservation assertion missing')
if '[[ "$after_status_bytes" -eq "$before_status_bytes" ]]' not in text:
    raise SystemExit('work proof status-index preservation assertion missing')
PY

echo 'R5 phase-work index reindex local proof contract PASS'
