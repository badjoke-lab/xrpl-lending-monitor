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
  'work_id text' \
  'octet_length(payload_digest)=32' \
  'proof.assert_message_identity_v2' \
  "extensions.digest(convert_to(p_payload::text,'UTF8'),'sha256')" \
  'proof.duplicate_completion_v2' \
  'proof.revision4_archived_predecessor_ok_v2' \
  'generate_series(1,35000)' \
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

# V2 must never retain the full payload column.
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
if 'payload_digest bytea not null' not in body or 'work_id text' not in body:
    raise SystemExit('archive_v2 compact identity columns missing')
PY

echo 'R5 terminal archive v2 digest-only local proof contract PASS'
