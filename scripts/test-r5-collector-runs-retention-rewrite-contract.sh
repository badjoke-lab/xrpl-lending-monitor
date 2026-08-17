#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-collector-runs-retention-rewrite-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'generated always as identity primary key' \
  'generate_series(1,21329)' \
  'order by completed_at desc,id desc limit 256' \
  'truncate table proof.xrpl_collector_runs' \
  'overriding system value' \
  'injected_collector_retention_failure' \
  'sequence_after_restore' \
  "nextval('proof.xrpl_collector_runs_id_seq')" \
  'retainedDigestPreserved' \
  'schemaFingerprintPreserved' \
  'relationOidPreserved' \
  'rollbackVerified' \
  'production database used:' \
  'production retention / physical rewrite authorized:'; do
  grep -Fq "$required" "$proof" || { echo "collector retention rewrite proof missing: $required" >&2; exit 1; }
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
    echo "collector retention rewrite proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

python - "$proof" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
if text.count('truncate table proof.xrpl_collector_runs') != 2:
    raise SystemExit('collector rewrite must have exactly rollback and apply TRUNCATE paths')
if 'overriding system value' not in text.lower():
    raise SystemExit('collector rewrite does not preserve identity IDs explicitly')
if '[[ "$sequence_after_restore" -eq 21329 ]]' not in text:
    raise SystemExit('collector rewrite sequence preservation assertion missing')
if '[[ "$next_id" -eq 21330 ]]' not in text:
    raise SystemExit('collector rewrite next identity assertion missing')
PY

echo 'R5 collector run retention rewrite local proof contract PASS'
