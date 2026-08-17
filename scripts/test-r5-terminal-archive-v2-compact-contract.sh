#!/usr/bin/env bash
set -euo pipefail

proof='scripts/test-r5-terminal-archive-v2-compact-postgres.sh'
[[ -f "$proof" ]]
bash -n "$proof"

for required in \
  "image='postgres:15-alpine'" \
  'create table proof.archive_v1' \
  'create table proof.archive_v2' \
  'payload jsonb not null' \
  'payload_digest bytea not null' \
  'finalize_work_id text' \
  "check ((phase='finalize') = (finalize_work_id is not null))" \
  'octet_length(payload_digest)=32' \
  'proof.assert_message_identity_v2' \
  "extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256')" \
  'proof.duplicate_completion_v2' \
  'proof.revision4_archived_predecessor_ok_v2' \
  "a.finalize_work_id=p_work_id" \
  "case when phase='finalize' then work_id else null end" \
  "case when phase='scan' then jsonb_build_object" \
  'generate_series(1,35000)' \
  'scan_rows_1500' \
  'commit_rows_1500' \
  'finalize_rows_1500' \
  'finalize_work_id_rows_1500' \
  'saved_percent' \
  'production database used:' \
  'production archive mutation authorized:'; do
  grep -Fq "$required" "$proof" || { echo "v2 compact proof missing: $required" >&2; exit 1; }
done

# This proof is local-only. It must not grow a provider-side mutation path.
for forbidden in \
  'SUPABASE_ACCESS_TOKEN' \
  'SUPABASE_PROJECT_ID' \
  'api.supabase.com' \
  'read_only:false' \
  'cron.schedule' \
  'cron.unschedule' \
  'wrangler deploy' \
  'supabase functions deploy' \
  'MAINNET_ENABLED' \
  'r5Rearm' \
  'r5-revision4-resource-halt-rearm'; do
  if grep -Fq "$forbidden" "$proof"; then
    echo "v2 compact proof contains forbidden production capability: $forbidden" >&2
    exit 1
  fi
done

# V2 must never retain the full payload column, and archived work identity is
# retained only for finalize rows because production scan rows have no workId
# and current archive-aware recovery consumes archived work identity only for
# a finalize predecessor.
python - "$proof" <<'PY'
from pathlib import Path
import re, sys
text = Path(sys.argv[1]).read_text()
m = re.search(r'create table proof\.archive_v2 \((.*?)\n\);', text, re.S)
if not m:
    raise SystemExit('archive_v2 definition missing')
body = m.group(1)
if re.search(r'^\s*payload\s+jsonb\b', body, re.M):
    raise SystemExit('archive_v2 unexpectedly retains full payload')
if 'payload_digest bytea not null' not in body or 'finalize_work_id text' not in body:
    raise SystemExit('archive_v2 compact identity columns missing')
if "check ((phase='finalize') = (finalize_work_id is not null))" not in body:
    raise SystemExit('archive_v2 finalize-only work identity constraint missing')
if re.search(r'^\s*work_id\s+text\b', body, re.M):
    raise SystemExit('archive_v2 unexpectedly retains work_id on every phase')
PY

echo 'R5 terminal archive v2 production-shaped local proof contract PASS'
