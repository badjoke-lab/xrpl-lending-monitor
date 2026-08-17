#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-successor-constraint-index-physical-reindex.yml'
manager='scripts/manage-r5-successor-constraint-index-physical-reindex.mjs'
local_proof='scripts/test-r5-successor-constraint-index-reindex-postgres.sh'
local_contract='scripts/test-r5-successor-constraint-index-reindex-contract.sh'

for file in "$workflow" "$manager" "$local_proof" "$local_contract"; do
  [[ -f "$file" ]] || { echo "successor-index physical reindex production contract missing: $file" >&2; exit 1; }
done
bash -n "$local_proof"
bash -n "$local_contract"
node --check "$manager"

for required in \
  "/r5-successor-index-reindex-prepare target=pkey" \
  "/r5-successor-index-reindex-prepare target=successor_unique" \
  "startsWith(github.event.comment.body, '/r5-successor-index-reindex-authorize ')" \
  'Verify exact prior proposal and unique owner authorization' \
  'Revalidate exact authorized state read-only' \
  'Apply exact bounded single successor-index physical reindex' \
  'Independent post-commit read-only verify' \
  'rowMutationAuthorized' \
  'vacuumAuthorized' \
  'schedulerMutationAuthorized' \
  'mainnetDisabled' \
  'retention-days: 14'; do
  grep -Fq "$required" "$workflow" || { echo "successor-index reindex workflow missing: $required" >&2; exit 1; }
done

for required in \
  "const TABLE = 'public.xrpl_phase_successors'" \
  "const EXPECTED_MIGRATION_HEAD = '20260816050000'" \
  'const MAX_DATABASE_BYTES_BEFORE = 474_000_000' \
  'const MIN_TARGET_INDEX_BYTES_BEFORE = 16_000_000' \
  'const LOCAL_COMPACT_BUILD_BYTES = 14_336_000' \
  'const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000' \
  'const MAX_CONSERVATIVE_PEAK_BYTES = 490_000_000' \
  "'pkeyScans',coalesce((select idx_scan::bigint" \
  "'successorUniqueScans',coalesce((select idx_scan::bigint" \
  'public.xrpl_phase_successors_pkey' \
  'public.xrpl_phase_successors_successor_message_id_key' \
  "set local lock_timeout='5s'" \
  "set local statement_timeout='120s'" \
  'lock table public.xrpl_phase_successors in share mode' \
  'successor index authorized data drift under lock' \
  'successor constraint state drift under lock' \
  'successor index reindex safety ceiling exceeded under lock' \
  'authorized structural state mismatch' \
  'authorized data state mismatch' \
  'authorized plan mismatch' \
  'authorized mutation mismatch' \
  'post-reindex successor row/constraint state mismatch' \
  'post-reindex peer index changed' \
  'target successor index bytes were not reclaimed' \
  'independent verify structural state mismatch' \
  'productionReadOnly:true' \
  'rowMutationPerformed:false' \
  'vacuumPerformed:false' \
  'schedulerMutationPerformed:false' \
  'r5RearmPerformed:false'; do
  grep -Fq "$required" "$manager" || { echo "successor-index reindex manager missing: $required" >&2; exit 1; }
done

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re, sys
workflow=Path(sys.argv[1]).read_text()
manager=Path(sys.argv[2]).read_text()

if workflow.count('issues: write') != 1:
    raise SystemExit('successor-index workflow must have exactly one issue-write permission')
for exact in ("/r5-successor-index-reindex-prepare target=pkey", "/r5-successor-index-reindex-prepare target=successor_unique"):
    if workflow.count(exact) < 2:
        raise SystemExit(f'successor-index prepare target is not explicitly gated: {exact}')
if workflow.count("startsWith(github.event.comment.body, '/r5-successor-index-reindex-authorize ')") != 1:
    raise SystemExit('successor-index authorization gate must be unique')
for forbidden in ('  push:', '  schedule:', 'workflow_dispatch', 'pull_request_target', 'contents: write',
                  'supabase functions deploy', 'supabase db push', 'cron.schedule', 'cron.unschedule',
                  'wrangler deploy', "MAINNET_ENABLED: 'true'"):
    if forbidden in workflow:
        raise SystemExit(f'successor-index workflow contains forbidden capability: {forbidden.strip()}')

lower=manager.lower()
for forbidden in ('delete from public', 'truncate table', 'update public', 'insert into public',
                  'vacuum ', 'cluster ', 'cron.schedule', 'cron.unschedule', 'wrangler deploy'):
    if forbidden in lower:
        raise SystemExit(f'successor-index manager contains forbidden capability: {forbidden}')
if manager.count("reindexSql: 'reindex index public.xrpl_phase_successors_pkey;',") != 1:
    raise SystemExit('successor-index manager must expose exactly one pkey REINDEX literal')
if manager.count("reindexSql: 'reindex index public.xrpl_phase_successors_successor_message_id_key;',") != 1:
    raise SystemExit('successor-index manager must expose exactly one unique REINDEX literal')
if re.search(r'(?im)^\s*reindex\s+(?:table|database|system)\b', manager):
    raise SystemExit('successor-index manager broadens REINDEX scope')
if 'oneIndexOnly:true' not in manager or 'independentReadOnlyVerifyRequired:true' not in manager:
    raise SystemExit('successor-index plan must bind one-index-only apply and independent verify')

for volatile in ('pkeyScans','successorUniqueScans'):
    if volatile not in manager:
        raise SystemExit(f'successor-index manager no longer observes {volatile}')
for function_name in ('structuralState','dataState'):
    match=re.search(rf'function {function_name}\(.*?\) \{{(.*?)\n\}}',manager,re.S)
    if not match:
        raise SystemExit(f'{function_name} missing')
    if 'pkeyScans' in match.group(1) or 'successorUniqueScans' in match.group(1):
        raise SystemExit(f'volatile idx_scan participates in {function_name} authorization state')
data_state=re.search(r'function dataState\(state, target\) \{(.*?)\n\}',manager,re.S)
if not data_state or 'databaseBytes' in data_state.group(1):
    raise SystemExit('databaseBytes must remain a ceiling check, not authorization data state')

apply_pos=workflow.find('Apply exact bounded single successor-index physical reindex')
verify_pos=workflow.find('Independent post-commit read-only verify')
if min(apply_pos,verify_pos)<0 or apply_pos>=verify_pos:
    raise SystemExit('independent read-only verification must occur after bounded apply')
PY

echo 'R5 successor constraint-index physical reindex production contract PASS'
