#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-work-reader-index-physical-reindex.yml'
manager='scripts/manage-r5-work-reader-index-physical-reindex.mjs'
local_proof='scripts/test-r5-work-index-reindex-postgres.sh'
local_contract='scripts/test-r5-work-index-reindex-contract.sh'
for file in "$workflow" "$manager" "$local_proof" "$local_contract"; do
  [[ -f "$file" ]] || { echo "work reader production contract missing: $file" >&2; exit 1; }
done
bash -n "$local_proof"
bash -n "$local_contract"
node --check "$manager"

for required in \
  "github.event.comment.body == '/r5-work-reader-index-reindex-prepare'" \
  "startsWith(github.event.comment.body, '/r5-work-reader-index-reindex-authorize ')" \
  'Verify exact prior proposal and unique owner authorization' \
  'Revalidate exact authorized state read-only' \
  'Apply exact bounded work reader-index physical reindex' \
  'Independent post-commit read-only verify' \
  'rowMutationAuthorized' \
  'vacuumAuthorized' \
  'schedulerMutationAuthorized' \
  'mainnetDisabled' \
  'retention-days: 14'; do
  grep -Fq "$required" "$workflow" || { echo "work reader workflow missing: $required" >&2; exit 1; }
done

for required in \
  "const TABLE = 'public.xrpl_phase_work'" \
  "const TARGET = 'public.xrpl_phase_work_committed_reader_idx'" \
  "const EXPECTED_MIGRATION_HEAD = '20260816050000'" \
  'const MAX_DATABASE_BYTES_BEFORE = 420_000_000' \
  'const MIN_TARGET_BYTES_BEFORE = 12_000_000' \
  'const MAX_TARGET_BYTES_BEFORE = 18_000_000' \
  'const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 12_000_000' \
  'const MAX_CONSERVATIVE_PEAK_BYTES = 435_000_000' \
  "'targetScans',coalesce((select idx_scan::bigint" \
  "set local lock_timeout='5s'" \
  "set local statement_timeout='120s'" \
  'lock table public.xrpl_phase_work in share mode' \
  'work reader authorized data drift under lock' \
  'work constraint state drift under lock' \
  'work reader reindex safety ceiling exceeded under lock' \
  'reindex index public.xrpl_phase_work_committed_reader_idx' \
  'authorized structural state mismatch' \
  'authorized data state mismatch' \
  'authorized plan mismatch' \
  'authorized mutation mismatch' \
  'post-reindex work row/constraint state mismatch' \
  'post-reindex work pkey changed' \
  'post-reindex work identity unique changed' \
  'post-reindex work status index changed' \
  'work reader index bytes increased' \
  'independent verify structural state mismatch' \
  'productionReadOnly: true' \
  'rowMutationPerformed: false' \
  'vacuumPerformed: false' \
  'schedulerMutationPerformed: false' \
  'r5RearmPerformed: false'; do
  grep -Fq "$required" "$manager" || { echo "work reader manager missing: $required" >&2; exit 1; }
done

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re,sys
workflow=Path(sys.argv[1]).read_text(); manager=Path(sys.argv[2]).read_text()
if workflow.count('issues: write') != 1:
    raise SystemExit('work reader workflow must have exactly one issue-write permission')
if workflow.count("github.event.comment.body == '/r5-work-reader-index-reindex-prepare'") != 1:
    raise SystemExit('work reader prepare gate must be exact and unique')
if workflow.count("startsWith(github.event.comment.body, '/r5-work-reader-index-reindex-authorize ')") != 1:
    raise SystemExit('work reader authorization gate must be unique')
for forbidden in ('  push:','  schedule:','workflow_dispatch','pull_request_target','contents: write','supabase functions deploy','supabase db push','cron.schedule','cron.unschedule','wrangler deploy',"MAINNET_ENABLED: 'true'"):
    if forbidden in workflow: raise SystemExit(f'work reader workflow contains forbidden capability: {forbidden.strip()}')
lower=manager.lower()
for forbidden in ('delete from public','truncate table','update public','insert into public','vacuum ','cluster ','cron.schedule','cron.unschedule','wrangler deploy'):
    if forbidden in lower: raise SystemExit(f'work reader manager contains forbidden capability: {forbidden}')
if manager.count('reindex index public.xrpl_phase_work_committed_reader_idx;') != 1:
    raise SystemExit('work reader manager must contain exactly one executable reader REINDEX')
for peer in ('reindex index public.xrpl_phase_work_pkey','reindex index public.xrpl_phase_work_profile_id_start_ledger_index_expected_pare_key','reindex index public.xrpl_phase_work_status_idx'):
    if peer in lower: raise SystemExit(f'work reader manager must not REINDEX peer: {peer}')
lock_pos=manager.find('lock table public.xrpl_phase_work in share mode')
revalidate_pos=manager.find('work reader authorized data drift under lock')
reindex_pos=manager.find('reindex index public.xrpl_phase_work_committed_reader_idx;')
if min(lock_pos,revalidate_pos,reindex_pos)<0 or not(lock_pos<revalidate_pos<reindex_pos):
    raise SystemExit('work reader manager must lock and revalidate before REINDEX')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b',manager):
    raise SystemExit('work reader manager broadens REINDEX scope')
data=re.search(r'function dataState\(state\) \{(.*?)\n\}',manager,re.S)
if not data: raise SystemExit('work reader dataState missing')
if 'Scans' in data.group(1) or 'databaseBytes' in data.group(1):
    raise SystemExit('volatile index scans/database total must not participate in authorization data state')
PY

echo 'R5 work reader physical reindex production contract PASS'
