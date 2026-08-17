#!/usr/bin/env bash
set -euo pipefail

sql='ops/production-sql/20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql'
[[ -f "$sql" ]]

grep -Fq "bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10" "$sql"
grep -Fq "d17d392292b4ca38c9b1f85fb0d8f2bebe3cd6db978ca42a70cfd3bc3deb133c" "$sql"
grep -Fq "e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733" "$sql"
grep -Fq "xrpl_create_r5_active_checkpoint_strict" "$sql"
grep -Fq "xrpl_phase_archive_v1.terminal_messages" "$sql"
grep -Fq "r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint" "$sql"
grep -Fq "R5 strict checkpoint fail-close patch marker is not unique" "$sql"
grep -Fq "R5 strict checkpoint source drift" "$sql"
grep -Fq "R5 strict checkpoint fail-close post-apply verification failed" "$sql"

# This staged patch may replace one function definition only. It must not touch rows,
# scheduler/deployment state, Mainnet, or physical storage.
if grep -Eiq '\b(delete[[:space:]]+from|truncate|vacuum|reindex|drop[[:space:]]+(table|schema)|cron\.|net\.|supabase_migrations)\b' "$sql"; then
  echo 'checkpoint archive fail-close SQL contains forbidden mutation capability' >&2
  exit 1
fi
if grep -Eiq 'terminalize_(message|completed_window)[[:space:]]*\(' "$sql"; then
  echo 'checkpoint archive fail-close SQL must not invoke terminal transport mutation' >&2
  exit 1
fi

# The guard must be inserted before the existing checkpoint advisory lock, so once
# Phase B creates any archive row all legacy/full-history checkpoint entry points
# fail closed instead of silently capturing an incomplete live-only transport set.
python - "$sql" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
replacement = "v_replacement text := E'  if exists (select 1 from xrpl_phase_archive_v1.terminal_messages) then"
if replacement not in text:
    raise SystemExit('checkpoint archive fail-close replacement is missing')
if "perform pg_advisory_xact_lock(hashtextextended(''xrpl-r5-active-checkpoint'', 0));" not in text:
    raise SystemExit('checkpoint advisory-lock boundary is missing')
if text.count("r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint") < 3:
    raise SystemExit('checkpoint fail-close marker is not verified before and after apply')
PY

echo 'R5 checkpoint terminal-archive fail-close contract PASS'
