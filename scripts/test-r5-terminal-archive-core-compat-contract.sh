#!/usr/bin/env bash
set -euo pipefail

sql='ops/production-sql/20260816200000_xrpl_phase_terminal_archive_core_compat_patch.sql'
test -s "$sql"

for function_name in \
  xrpl_phase_insert_message \
  xrpl_phase_reserve_successor \
  xrpl_complete_caught_up_scan \
  xrpl_complete_scan_phase \
  xrpl_complete_commit_phase \
  xrpl_complete_finalize_phase \
  xrpl_complete_portable_scan_phase \
  xrpl_complete_portable_commit_phase_strict \
  xrpl_complete_portable_finalize_phase
do
  grep -Fq "'$function_name'" "$sql"
done

for helper in \
  xrpl_phase_archive_v1.assert_message_identity \
  xrpl_phase_archive_v1.assert_successor_identity \
  xrpl_phase_archive_v1.duplicate_completion
do
  grep -Fq "$helper" "$sql"
done

grep -Fq 'terminal archive core source drift' "$sql"
grep -Fq 'terminal archive core patched digest mismatch' "$sql"
grep -Fq 'terminal archive core post-apply digest mismatch' "$sql"
grep -Fq 'pg_get_function_identity_arguments' "$sql"
grep -Fq '39f4bbe6c9e15e1f03549e7a389a30b30bf343c3bdf9e840468ebe58cd6f96ce' "$sql"
grep -Fq 'c6a2bc130386d9e5c6001e005ba299fc1cc874124e7a70b557208441377a4df9' "$sql"
grep -Fq 'e1541a3c93835662a8f0f255eb12e4726b26c00f125b4d6048fa983dfa2a3a0c' "$sql"
grep -Fq '583f7c6acbad42430c9b7c18c159667b01c4384bfdbb69900644d193d01e57f6' "$sql"
grep -Fq '5dfe3d3f2b5ea079b6efbd89ffb8794cc50fa7a2b25abd1525f8ee5c6dd38ad8' "$sql"
grep -Fq 'f66e1276e0f35ee16e5d91462fa8004acbe4174a76db1246d98c6749b4d38cf2' "$sql"
grep -Fq '74cf2ff52d821515a93cfaa40386fb88a3ea16aea550c8f8346189104e78fab7' "$sql"
grep -Fq 'd3fe3b081fd25299bfa27bce53d2d8d1a5065690eccd0aaf2c1f1d27356d1fe5' "$sql"
grep -Fq '6b6b5fabc8ce71e4d1985b2a4af917ccf9de3615fcbd5ec467cb8928f70bf898' "$sql"

if grep -Eiq '\b(delete[[:space:]]+from|truncate|vacuum|cluster|cron\.|net\.)\b' "$sql"; then
  echo 'core compatibility patch contains forbidden storage/scheduler mutation' >&2
  exit 1
fi

# This is staging only. Production apply must be separately authorized.
test "$(grep -c "'complete', '" "$sql")" -eq 7
