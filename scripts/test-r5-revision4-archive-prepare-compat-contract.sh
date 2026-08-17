#!/usr/bin/env bash
set -euo pipefail
sql='ops/production-sql/20260816201000_xrpl_r5_revision4_archive_prepare_compat_patch.sql'
test -s "$sql"
grep -Fq 'aaf2014c2553813458bec1b14fc06edc3901364cd0cfc9b2370a056b9432f494' "$sql"
grep -Fq '2795e4abe98f2dea95adb8a937446e824e85b3708b6aaeca2d2047a16dff3d5c' "$sql"
grep -Fq 'v_archived_predecessor xrpl_phase_archive_v1.terminal_messages' "$sql"
grep -Fq 'successor_hash = extensions.digest' "$sql"
grep -Fq "v_archived_predecessor.phase <> ''finalize''" "$sql"
grep -Fq "v_archived_predecessor.payload->>''workId'' <> v_watermark.work_id" "$sql"
grep -Fq 'revision4 archive prepare source drift' "$sql"
grep -Fq 'revision4 archive prepare patched digest mismatch' "$sql"
grep -Fq 'revision4 archive prepare post-apply digest mismatch' "$sql"
if grep -Eiq '\b(delete[[:space:]]+from|truncate|vacuum|cluster|cron\.|net\.)\b' "$sql"; then
  echo 'revision4 archive prepare patch contains forbidden storage/scheduler mutation' >&2
  exit 1
fi
