#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-terminal-transport-sequential-rewrite-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'create table proof.messages' \
  'create table proof.successors' \
  'delete from proof.successors' \
  'delete from proof.messages' \
  'create temp table snapshot_successors on commit drop as select * from proof.successors' \
  'truncate table proof.successors;' \
  'stage1_database_peak' \
  'stage1_database_after' \
  'create temp table snapshot_messages on commit drop as select * from proof.messages' \
  'truncate table proof.successors,proof.messages' \
  'stage2_database_peak' \
  'counterfactual_dual_peak' \
  'sequentialPeakReductionBytes' \
  'messageDigestPreserved' \
  'successorDigestPreserved' \
  'schemaFingerprintPreserved' \
  'messageOidPreserved' \
  'successorOidPreserved' \
  'production database used:' \
  'production compaction authorized:'; do
  grep -Fq "$required" "$proof" || { echo "sequential rewrite proof missing: $required" >&2; exit 1; }
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
    echo "sequential rewrite proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
first=text.find("truncate table proof.successors;")
second=text.find("truncate table proof.successors,proof.messages")
if first < 0 or second < 0 or first >= second:
    raise SystemExit('sequential rewrite order is not successors-first')
if "counterfactual_dual_peak=$((before_database_bytes + stage2_snapshot_message_bytes + stage2_snapshot_successor_bytes))" not in text:
    raise SystemExit('dual peak counterfactual formula missing')
if '[[ "$stage2_database_peak" -lt "$counterfactual_dual_peak" ]]' not in text:
    raise SystemExit('sequential peak reduction assertion missing')
PY

echo 'R5 terminal transport sequential rewrite local proof contract PASS'
