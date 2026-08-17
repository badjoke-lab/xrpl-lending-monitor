#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-phase-message-pkey-physical-reindex.yml'
manager='scripts/manage-r5-phase-message-pkey-physical-reindex.mjs'
local_proof='scripts/test-r5-phase-message-pkey-reindex-postgres.sh'
local_contract='scripts/test-r5-phase-message-pkey-reindex-contract.sh'

for file in "$workflow" "$manager" "$local_proof" "$local_contract"; do
  [[ -f "$file" ]] || { echo "phase-message pkey production contract missing: $file" >&2; exit 1; }
done
bash -n "$local_proof"
bash -n "$local_contract"
node --check "$manager"

for required in \
  "github.event.comment.body == '/r5-phase-message-pkey-reindex-prepare'" \
  "startsWith(github.event.comment.body, '/r5-phase-message-pkey-reindex-authorize ')" \
  'Verify exact prior proposal and unique owner authorization' \
  'Revalidate exact authorized state read-only' \
  'Apply exact bounded phase-message pkey physical reindex' \
  'Independent post-commit read-only verify' \
  'rowMutationAuthorized' \
  'vacuumAuthorized' \
  'schedulerMutationAuthorized' \
  'mainnetDisabled' \
  'retention-days: 14'; do
  grep -Fq "$required" "$workflow" || { echo "phase-message pkey workflow missing: $required" >&2; exit 1; }
done

for required in \
  "const TABLE = 'public.xrpl_phase_messages'" \
  "const PKEY = 'public.xrpl_phase_messages_pkey'" \
  "const READY = 'public.xrpl_phase_messages_ready_idx'" \
  "const EXPECTED_MIGRATION_HEAD = '20260816050000'" \
  'const MAX_DATABASE_BYTES_BEFORE = 460_000_000' \
  'const MIN_PKEY_BYTES_BEFORE = 30_000_000' \
  'const MAX_PKEY_BYTES_BEFORE = 45_000_000' \
  'const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000' \
  'const MAX_CONSERVATIVE_PEAK_BYTES = 480_000_000' \
  "'pkeyScans',coalesce((select idx_scan::bigint" \
  "'readyScans',coalesce((select idx_scan::bigint" \
  "set local lock_timeout='5s'" \
  "set local statement_timeout='120s'" \
  'lock table public.xrpl_phase_messages in share mode' \
  'phase-message pkey authorized data drift under lock' \
  'phase-message constraint state drift under lock' \
  'phase-message pkey reindex safety ceiling exceeded under lock' \
  'reindex index public.xrpl_phase_messages_pkey' \
  'authorized structural state mismatch' \
  'authorized data state mismatch' \
  'authorized plan mismatch' \
  'authorized mutation mismatch' \
  'post-reindex phase-message row/constraint state mismatch' \
  'post-reindex ready index changed' \
  'phase-message pkey bytes were not reclaimed' \
  'independent verify structural state mismatch' \
  'productionReadOnly:true' \
  'rowMutationPerformed:false' \
  'vacuumPerformed:false' \
  'schedulerMutationPerformed:false' \
  'r5RearmPerformed:false'; do
  grep -Fq "$required" "$manager" || { echo "phase-message pkey manager missing: $required" >&2; exit 1; }
done

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re,sys
workflow=Path(sys.argv[1]).read_text(); manager=Path(sys.argv[2]).read_text()
if workflow.count('issues: write') != 1:
    raise SystemExit('phase-message pkey workflow must have exactly one issue-write permission')
if workflow.count("github.event.comment.body == '/r5-phase-message-pkey-reindex-prepare'") != 1:
    raise SystemExit('phase-message pkey prepare gate must be exact and unique')
if workflow.count("startsWith(github.event.comment.body, '/r5-phase-message-pkey-reindex-authorize ')") != 1:
    raise SystemExit('phase-message pkey authorization gate must be unique')
for forbidden in ('  push:','  schedule:','workflow_dispatch','pull_request_target','contents: write','supabase functions deploy','supabase db push','cron.schedule','cron.unschedule','wrangler deploy',"MAINNET_ENABLED: 'true'"):
    if forbidden in workflow: raise SystemExit(f'phase-message pkey workflow contains forbidden capability: {forbidden.strip()}')
lower=manager.lower()
for forbidden in ('delete from public','truncate table','update public','insert into public','vacuum ','cluster ','cron.schedule','cron.unschedule','wrangler deploy'):
    if forbidden in lower: raise SystemExit(f'phase-message pkey manager contains forbidden capability: {forbidden}')
if manager.count('reindex index public.xrpl_phase_messages_pkey;') != 1:
    raise SystemExit('phase-message pkey manager must contain exactly one executable pkey REINDEX')
if 'reindex index public.xrpl_phase_messages_ready_idx' in lower:
    raise SystemExit('phase-message pkey manager must not REINDEX the ready index')
lock_pos=manager.find('lock table public.xrpl_phase_messages in share mode')
revalidate_pos=manager.find('phase-message pkey authorized data drift under lock')
reindex_pos=manager.find('reindex index public.xrpl_phase_messages_pkey;')
if min(lock_pos,revalidate_pos,reindex_pos)<0 or not(lock_pos<revalidate_pos<reindex_pos):
    raise SystemExit('phase-message pkey manager must lock and revalidate before REINDEX')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b',manager):
    raise SystemExit('phase-message pkey manager broadens REINDEX scope')
# Cumulative statistics are diagnostic only and must not enter authorization digests.
data=re.search(r'function dataState\(state\)\{(.*?)\}\nfunction mutationSql',manager,re.S)
if not data: raise SystemExit('phase-message pkey dataState missing')
if 'Scans' in data.group(1) or 'databaseBytes' in data.group(1):
    raise SystemExit('volatile statistics/database size must not participate in authorization data state')
PY

echo 'R5 phase-message pkey physical reindex production contract PASS'
