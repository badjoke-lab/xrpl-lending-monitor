#!/usr/bin/env bash
set -euo pipefail

workflow='.github/workflows/r5-phase-ready-index-physical-reindex.yml'
manager='scripts/manage-r5-phase-ready-index-physical-reindex.mjs'
local_proof='scripts/test-r5-phase-ready-index-physical-reindex-postgres.sh'
local_contract='scripts/test-r5-phase-ready-index-physical-reindex-contract.sh'

for file in "$workflow" "$manager" "$local_proof" "$local_contract"; do
  [[ -f "$file" ]] || { echo "ready-index physical reindex production contract missing: $file" >&2; exit 1; }
done
bash -n "$local_proof"
bash -n "$local_contract"
node --check "$manager"

for required in \
  "github.event.comment.body == '/r5-phase-ready-index-reindex-prepare'" \
  "startsWith(github.event.comment.body, '/r5-phase-ready-index-reindex-authorize ')" \
  'Verify exact prior proposal and unique owner authorization' \
  'Revalidate exact authorized state read-only' \
  'Apply exact bounded ready-index physical reindex' \
  'rowMutationAuthorized' \
  'vacuumAuthorized' \
  'schedulerMutationAuthorized' \
  'mainnetDisabled' \
  'retention-days: 14'; do
  grep -Fq "$required" "$workflow" || { echo "ready-index reindex workflow missing: $required" >&2; exit 1; }
done

for required in \
  "const INDEX = 'public.xrpl_phase_messages_ready_idx'" \
  "const TABLE = 'public.xrpl_phase_messages'" \
  "const EXPECTED_MIGRATION_HEAD = '20260816050000'" \
  'const MAX_DATABASE_BYTES_BEFORE = 480_000_000' \
  'const MAX_INDEX_BYTES_BEFORE = 8_000_000' \
  'const MAX_READY_ROWS = 100' \
  "set local lock_timeout='5s'" \
  "set local statement_timeout='45s'" \
  "lock table public.xrpl_phase_messages in share mode" \
  'ready index authorized data drift under lock' \
  'ready index reindex safety ceiling exceeded under lock' \
  'reindex index public.xrpl_phase_messages_ready_idx' \
  'authorized structural state mismatch' \
  'authorized data state mismatch' \
  'authorized plan mismatch' \
  'authorized mutation mismatch' \
  'post-reindex phase-message row state mismatch' \
  'post-reindex table heap bytes changed' \
  'ready index bytes were not reclaimed' \
  'database bytes were not reclaimed' \
  'rowMutationPerformed: false' \
  'vacuumPerformed: false' \
  'schedulerMutationPerformed: false' \
  'r5RearmPerformed: false'; do
  grep -Fq "$required" "$manager" || { echo "ready-index reindex manager missing: $required" >&2; exit 1; }
done

python - "$workflow" "$manager" <<'PY'
from pathlib import Path
import re, sys
workflow=Path(sys.argv[1]).read_text()
manager=Path(sys.argv[2]).read_text()

if workflow.count("issues: write") != 1:
    raise SystemExit('ready-index reindex workflow must have exactly one issue-write permission')
if workflow.count("github.event.comment.body == '/r5-phase-ready-index-reindex-prepare'") != 1:
    raise SystemExit('ready-index reindex workflow prepare gate must be exact and unique')
if workflow.count("startsWith(github.event.comment.body, '/r5-phase-ready-index-reindex-authorize ')") != 1:
    raise SystemExit('ready-index reindex workflow authorization gate must be unique')
for forbidden in ('  push:', '  schedule:', 'workflow_dispatch', 'pull_request_target', 'contents: write',
                  'supabase functions deploy', 'supabase db push', 'cron.schedule', 'cron.unschedule',
                  'wrangler deploy', "MAINNET_ENABLED: 'true'"):
    if forbidden in workflow:
        raise SystemExit(f'ready-index reindex workflow contains forbidden capability: {forbidden.strip()}')

lower=manager.lower()
for forbidden in ('delete from public', 'truncate table', 'update public', 'insert into public',
                  'vacuum ', 'cluster ', 'cron.schedule', 'cron.unschedule', 'wrangler deploy'):
    if forbidden in lower:
        raise SystemExit(f'ready-index reindex manager contains forbidden capability: {forbidden}')
if manager.count('reindex index public.xrpl_phase_messages_ready_idx') != 1:
    raise SystemExit('ready-index reindex manager must contain exactly one REINDEX statement')
lock_pos=manager.find('lock table public.xrpl_phase_messages in share mode')
revalidate_pos=manager.find('ready index authorized data drift under lock')
reindex_pos=manager.find('reindex index public.xrpl_phase_messages_ready_idx')
if min(lock_pos,revalidate_pos,reindex_pos) < 0 or not (lock_pos < revalidate_pos < reindex_pos):
    raise SystemExit('ready-index reindex must lock and revalidate before REINDEX')
if re.search(r'\breindex\s+(?:table|database|system)\b', manager, re.I):
    raise SystemExit('ready-index reindex manager broadens REINDEX scope')
PY

echo 'R5 phase ready-index physical reindex production contract PASS'
