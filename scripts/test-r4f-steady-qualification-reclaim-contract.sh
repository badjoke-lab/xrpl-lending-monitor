#!/usr/bin/env bash
set -euo pipefail

guard='supabase/migrations/20260811012000_xrpl_r5_steady_qualification_reclaim_guard.sql'
fix='supabase/migrations/20260811061000_xrpl_r5_steady_reclaim_tick_accounting_fix.sql'
workflow='.github/workflows/supabase-remote-probe.yml'
test -f "$guard"
test -f "$fix"
test -f "$workflow"

# Exact retained qualification boundary remains pinned to the already-applied
# guard migration and its single formal artifact chain.
grep -Fq "r4c2d-steady-msflb8fo-5ebc5adc" "$guard"
grep -Fq "30992583324" "$guard"
grep -Fq "52ebc396f7c5217ae06e595aabe2053440f1076a" "$guard"
grep -Fq "8924984813" "$guard"
grep -Fq "sha256:76f4580d83c053dadfe8a707c7bf53b53d99d361fd12c12adefe76061a9dafa3" "$guard"
grep -Fq "d5be00fddec73f24bfec5d939bc3a65278ad5fb7765d1764ba10b289350e543a" "$guard"
grep -Fq "70b391931d8f9637e07b79fef75cfd4ce804dd859edfce294b5b67c4a04aac9a" "$guard"
grep -Fq "2026-08-05T04:37:08.161Z" "$guard"

for stale in \
  "30975277983" \
  "d7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c" \
  "fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c"; do
  if grep -Fq "$stale" "$guard"; then
    echo "stale mixed provenance remains in reclaim migration: $stale" >&2
    exit 1
  fi
done

# Explicit owner authorization is mandatory and single-use.
grep -Fq "issue_number integer not null check (issue_number = 1261)" "$guard"
grep -Fq "approved_by text not null check (approved_by = 'badjoke-lab')" "$guard"
grep -Fq "used_at is not null" "$guard"
grep -Fq "set used_at = clock_timestamp()" "$guard"

# The repair retains the formal session/tick identity rows and exact production
# cross-schema dependants. None of the six truncated tables may participate in
# a cross-schema FK, and the complete retained FK set must be exactly the two
# relations observed by production diagnostic run 31499605533.
for relation in commit_chunks messages payload_chunks reference_rows sessions successors ticks works; do
  grep -Fq "'$relation'" "$fix" || grep -Fq "xrpl_steady_v1.${relation}" "$fix"
done
grep -Fq "r4f_steady_reclaim_unexpected_isolated_table_set" "$fix"
grep -Fq "v_target_cross_schema_fk_count" "$fix"
grep -Fq "r4f_steady_reclaim_target_cross_schema_fk_present" "$fix"
grep -Fq "v_cross_schema_fks" "$fix"
grep -Fq "r4f_steady_reclaim_retained_cross_schema_fk_drift" "$fix"
grep -Fq "attempts_session_id_fkey" "$fix"
grep -Fq "xrpl_resource_guard_v2.attempts" "$fix"
grep -Fq "xrpl_steady_v1.sessions" "$fix"
grep -Fq "tick_accounting_session_id_tick_id_fkey" "$fix"
grep -Fq "xrpl_resource_guard_v2.tick_accounting" "$fix"
grep -Fq "xrpl_steady_v1.ticks" "$fix"

grep -Fq "v_formal_session_count" "$fix"
grep -Fq "r4f_steady_reclaim_formal_session_identity_unexpected" "$fix"
grep -Fq "status = 'completed'" "$fix"
grep -Fq "target_ticks = 6" "$fix"
grep -Fq "batch_size = 24" "$fix"
grep -Fq "completed_ticks = 6" "$fix"
grep -Fq "committed_ledgers = 144" "$fix"
grep -Fq "v_formal_tick_count" "$fix"
grep -Fq "r4f_steady_reclaim_formal_tick_identity_unexpected" "$fix"
grep -Fq "tick_sequence between 1 and 6" "$fix"
grep -Fq "end_ledger_index - start_ledger_index + 1 = 24" "$fix"
grep -Fq "work_count = 24" "$fix"
grep -Fq "completed_at is not null" "$fix"
grep -Fq "error_message is null" "$fix"

for forbidden_assumption in \
  'v_retained_accounting_count' \
  'v_retained_accounting_join_count' \
  'r4f_steady_reclaim_retained_accounting_evidence_unexpected'; do
  if grep -Fq "$forbidden_assumption" "$fix"; then
    echo "obsolete formal-session accounting assumption remains: $forbidden_assumption" >&2
    exit 1
  fi
done

grep -Fq "pg_catalog.pg_get_functiondef" "$fix"
grep -Fq "r4f_steady_reclaim_source_definition_drift" "$fix"
grep -Fq "r4f_steady_reclaim_partial_patch_verification_failed" "$fix"

python - "$fix" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
old_start = text.index('v_old_truncate constant text :=')
new_start = text.index('v_new_truncate constant text :=', old_start)
rows_start = text.index('v_old_rows_after constant text :=', new_start)
old_block = text[old_start:new_start]
new_block = text[new_start:rows_start]
for relation in ('payload_chunks', 'reference_rows', 'commit_chunks', 'messages', 'successors', 'works'):
    marker = f'xrpl_steady_v1.{relation}'
    if marker not in new_block:
        raise SystemExit(f'partial reclaim new TRUNCATE is missing {marker}')
for retained in ('xrpl_steady_v1.ticks', 'xrpl_steady_v1.sessions'):
    if retained in new_block:
        raise SystemExit(f'partial reclaim new TRUNCATE includes retained identity table {retained}')
    if retained not in old_block:
        raise SystemExit(f'exact old TRUNCATE patch target lost {retained}')
if 'xrpl_resource_guard_v2' in new_block:
    raise SystemExit('partial reclaim new TRUNCATE escaped xrpl_steady_v1')
if 'cascade' in new_block.lower():
    raise SystemExit('partial reclaim new TRUNCATE requests cascade')

# The zero-FK safety query must explicitly name every destructive target and
# must not treat retained sessions/ticks as destructive targets.
fk_start = text.index('into v_target_cross_schema_fk_count')
fk_end = text.index('if v_target_cross_schema_fk_count <> 0', fk_start)
fk_block = text[fk_start:fk_end]
for relation in ('payload_chunks', 'reference_rows', 'commit_chunks', 'messages', 'successors', 'works'):
    if f"'{relation}'" not in fk_block:
        raise SystemExit(f'target FK boundary is missing {relation}')
for retained in ("'sessions'", "'ticks'"):
    if retained in fk_block:
        raise SystemExit(f'target FK zero-boundary incorrectly includes retained identity {retained}')

# The complete retained cross-schema FK set is exact, ordered, and limited to
# parents that are retained by the partial reclaim.
required = [
    "'constraint', 'attempts_session_id_fkey'",
    "'child', 'xrpl_resource_guard_v2.attempts'",
    "'parent', 'xrpl_steady_v1.sessions'",
    "'constraint', 'tick_accounting_session_id_tick_id_fkey'",
    "'child', 'xrpl_resource_guard_v2.tick_accounting'",
    "'parent', 'xrpl_steady_v1.ticks'",
]
for marker in required:
    if marker not in text:
        raise SystemExit(f'retained cross-schema FK boundary is missing {marker}')
PY

if grep -Eq '(^|[^a-z_])(delete[[:space:]]+from|drop[[:space:]]+schema|drop[[:space:]]+table)' "$fix"; then
  echo 'unexpected destructive SQL in steady reclaim repair' >&2
  exit 1
fi
if grep -Eq '(truncate|delete[[:space:]]+from|update|insert[[:space:]]+into)[[:space:]]+xrpl_resource_guard_v2' "$fix"; then
  echo 'revision-3 accounting schema mutation is forbidden in steady reclaim repair' >&2
  exit 1
fi

# Canonical/public watermark and evidence digest guarantees stay in the original
# function. The original evidence also explicitly says revision3AccountingUntouched.
grep -Fq "v_wm_before" "$guard"
grep -Fq "v_wm_after" "$guard"
grep -Fq "r4f_steady_reclaim_active_watermark_changed" "$guard"
grep -Fq "v_final_evidence := v_evidence ||" "$guard"
grep -Fq "v_digest := public.xrpl_transfer_json_digest(v_final_evidence)" "$guard"
grep -Fq "r4f_steady_reclaim_archive_digest_mismatch" "$guard"
grep -Fq "'revision3AccountingUntouched', true" "$guard"
grep -Fq "'reclaimScope', 'xrpl_steady_v1_only'" "$guard"

# Public execution is denied; service_role grant is retained after repair.
grep -Fq "revoke all on function public.xrpl_preview_steady_qualification_reclaim() from public, anon, authenticated" "$guard"
grep -Fq "grant execute on function public.xrpl_preview_steady_qualification_reclaim() to service_role" "$guard"
grep -Fq "revoke all on function public.xrpl_execute_steady_qualification_reclaim(text)" "$fix"
grep -Fq "grant execute on function public.xrpl_execute_steady_qualification_reclaim(text)" "$fix"

# The production runner remains exact-owner-comment-only.
grep -Fq "github.event.issue.number == 1261" "$workflow"
grep -Fq "github.event.comment.user.login == 'badjoke-lab'" "$workflow"
grep -Fq "github.event.comment.body == '/r4f-steady-reclaim-prepare'" "$workflow"
grep -Fq "startsWith(github.event.comment.body, '/r4f-steady-reclaim-authorize ')" "$workflow"
if grep -Eq '^  (push|schedule|pull_request_target):' "$workflow"; then
  echo 'bounded reclaim runner gained an automatic or unsafe trigger' >&2
  exit 1
fi

# Only the single explicit repair migration may be applied. The three revision-4
# migrations remain exact-blob deferred. History repair is forbidden.
grep -Fq "RECLAIM_GUARD_VERSION: '20260811012000'" "$workflow"
grep -Fq "MIGRATION_VERSION: '20260811061000'" "$workflow"
grep -Fq "MIGRATION_PATH: supabase/migrations/20260811061000_xrpl_r5_steady_reclaim_tick_accounting_fix.sql" "$workflow"
grep -Fq "supabase_migrations.schema_migrations" "$workflow"
grep -Fq "read_only:true" "$workflow"
grep -Fq "Unexpected remote migration history for bounded reclaim repair" "$workflow"
grep -Fq "expected_tail='20260809151000 20260810123000 20260810133000 20260811012000 20260811061000'" "$workflow"
grep -Fq 'supabase db push --linked --dry-run' "$workflow"
grep -Fq 'supabase db push --linked --yes' "$workflow"
grep -Fq 'repair migration remains pending after exact scoped db push' "$workflow"
if grep -Fq 'supabase migration repair' "$workflow"; then
  echo 'reclaim runner must never rewrite migration history' >&2
  exit 1
fi
for version in 20260809151000 20260810123000 20260810133000 20260811012000 20260811061000; do
  grep -Fq "$version" "$workflow"
done
grep -Fq '623703ab8b8440ca774995592f490d0944ab97f7' "$workflow"
grep -Fq '96d8d478174866355ee798500e3eff83634a442d' "$workflow"
grep -Fq '2a986ba2872aead52119563fc43d8d49c1211949' "$workflow"

python - "$workflow" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
if text.count('supabase db push --linked --yes') != 1:
    raise SystemExit('repair migration apply must have exactly one invocation')
if text.count('supabase db push --linked --dry-run') != 2:
    raise SystemExit('repair migration must have exact pre/post dry-run checks')
if 'supabase migration repair' in text:
    raise SystemExit('migration history repair is forbidden')
PY

# Runtime key, preview, one-time authorization, one destructive RPC, and post
# measurement remain unchanged.
grep -Fq 'xrpl_preview_steady_qualification_reclaim' "$workflow"
grep -Fq 'xrpl_execute_steady_qualification_reclaim' "$workflow"
grep -Fq 'api-keys?reveal=true' "$workflow"
grep -Fq 'database/query' "$workflow"
grep -Fq 'authorization-insert.json' "$workflow"
grep -Fq 'database-before.json' "$workflow"
grep -Fq 'database-after.json' "$workflow"

if grep -Fq 'SUPABASE_SERVICE_ROLE_KEY' "$workflow"; then
  echo 'static service-role secret binding is forbidden for reclaim runner' >&2
  exit 1
fi
grep -Fq 'legacy_count=' "$workflow"
grep -Fq 'secret_count=' "$workflow"
grep -Fq '.type == "secret"' "$workflow"
grep -Fq '::add-mask::${elevated_key}' "$workflow"
grep -Fq 'SUPABASE_RECLAIM_KEY_KIND=%s' "$workflow"
grep -Fq 'if [ "$SUPABASE_RECLAIM_KEY_KIND" = legacy ]; then' "$workflow"
grep -Fq 'Authorization: Bearer ${SUPABASE_RECLAIM_SERVICE_ROLE_KEY}' "$workflow"
grep -Fq 'rm -f /tmp/project-api-keys.json' "$workflow"

python - "$workflow" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
legacy_guard = 'if [ "$SUPABASE_RECLAIM_KEY_KIND" = legacy ]; then'
bearer = 'Authorization: Bearer ${SUPABASE_RECLAIM_SERVICE_ROLE_KEY}'
if text.count(legacy_guard) != 2 or text.count(bearer) != 2:
    raise SystemExit('elevated key header branching changed')
for marker in ['Verify exact retained session with read-only preview', 'Execute exactly one bounded steady qualification reclaim']:
    start = text.index(marker)
    segment = text[start:start + 2500]
    if segment.index(legacy_guard) > segment.index(bearer):
        raise SystemExit(f'Bearer header escaped legacy-only guard in {marker}')
PY

for forbidden in \
  'supabase functions deploy' \
  'supabase functions delete' \
  'wrangler deploy' \
  'xrpl-r5-recovery-batch' \
  "MAINNET_ENABLED: 'true'" \
  '/r4f-g3-'; do
  if grep -Fq "$forbidden" "$workflow"; then
    echo "unexpected adjacent capability in reclaim runner: $forbidden" >&2
    exit 1
  fi
done

# Static order: remote history -> scoped dry-run -> exact repair apply -> preview
# -> auth row -> exactly one destructive RPC -> post measurement.
python - "$workflow" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
needles = [
    'supabase_migrations.schema_migrations',
    'supabase db push --linked --dry-run',
    'supabase db push --linked --yes',
    'rest/v1/rpc/xrpl_preview_steady_qualification_reclaim',
    'authorization-insert.json',
    'rest/v1/rpc/xrpl_execute_steady_qualification_reclaim',
    'database-after.json',
]
pos = [text.index(x) for x in needles]
if pos != sorted(pos) or len(set(pos)) != len(pos):
    raise SystemExit(f'bounded reclaim execution order changed: {list(zip(needles, pos))}')
if text.count('rest/v1/rpc/xrpl_execute_steady_qualification_reclaim') != 1:
    raise SystemExit('destructive reclaim RPC must have exactly one invocation locator')
PY

echo 'steady qualification reclaim contract: PASS'
