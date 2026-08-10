#!/usr/bin/env bash
set -euo pipefail

file='supabase/migrations/20260811012000_xrpl_r5_steady_qualification_reclaim_guard.sql'
test -f "$file"

# Exact retained qualification boundary.
grep -Fq "r4c2d-steady-msflb8fo-5ebc5adc" "$file"
grep -Fq "30975277983" "$file"
grep -Fq "8924984813" "$file"
grep -Fq "fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c" "$file"

# Explicit owner authorization is mandatory and single-use.
grep -Fq "issue_number integer not null check (issue_number = 1261)" "$file"
grep -Fq "approved_by text not null check (approved_by = 'badjoke-lab')" "$file"
grep -Fq "used_at is not null" "$file"
grep -Fq "set used_at = clock_timestamp()" "$file"

# The destructive operation is isolated to the qualification schema only.
if grep -Eq '(^|[^a-z_])(delete[[:space:]]+from|drop[[:space:]]+schema|drop[[:space:]]+table)' "$file"; then
  echo 'unexpected destructive SQL outside the bounded TRUNCATE contract' >&2
  exit 1
fi
grep -Fq 'truncate table' "$file"
for relation in payload_chunks reference_rows commit_chunks messages successors works ticks sessions; do
  grep -Fq "xrpl_steady_v1.${relation}" "$file"
done

# Canonical/public watermark must be captured before and verified unchanged after reclaim.
grep -Fq "v_wm_before" "$file"
grep -Fq "v_wm_after" "$file"
grep -Fq "r4f_steady_reclaim_active_watermark_changed" "$file"

# Evidence digest is recomputed after physical reclamation, not before it.
grep -Fq "v_final_evidence := v_evidence ||" "$file"
grep -Fq "v_digest := public.xrpl_transfer_json_digest(v_final_evidence)" "$file"
grep -Fq "r4f_steady_reclaim_archive_digest_mismatch" "$file"

# Public execution is denied; only service_role may invoke the functions.
grep -Fq "revoke all on function public.xrpl_preview_steady_qualification_reclaim() from public, anon, authenticated" "$file"
grep -Fq "revoke all on function public.xrpl_execute_steady_qualification_reclaim(text) from public, anon, authenticated" "$file"
grep -Fq "grant execute on function public.xrpl_preview_steady_qualification_reclaim() to service_role" "$file"
grep -Fq "grant execute on function public.xrpl_execute_steady_qualification_reclaim(text) to service_role" "$file"

echo 'steady qualification reclaim contract: PASS'
