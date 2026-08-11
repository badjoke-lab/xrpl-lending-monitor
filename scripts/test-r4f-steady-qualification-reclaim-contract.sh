#!/usr/bin/env bash
set -euo pipefail

file='supabase/migrations/20260811012000_xrpl_r5_steady_qualification_reclaim_guard.sql'
workflow='.github/workflows/supabase-remote-probe.yml'
test -f "$file"
test -f "$workflow"

# Exact retained qualification boundary. These values are all from the same
# formal artifact chain: workflow 30992583324 -> commit 52ebc396... ->
# artifact 8924984813.
grep -Fq "r4c2d-steady-msflb8fo-5ebc5adc" "$file"
grep -Fq "30992583324" "$file"
grep -Fq "52ebc396f7c5217ae06e595aabe2053440f1076a" "$file"
grep -Fq "8924984813" "$file"
grep -Fq "sha256:76f4580d83c053dadfe8a707c7bf53b53d99d361fd12c12adefe76061a9dafa3" "$file"
grep -Fq "d5be00fddec73f24bfec5d939bc3a65278ad5fb7765d1764ba10b289350e543a" "$file"
grep -Fq "70b391931d8f9637e07b79fef75cfd4ce804dd859edfce294b5b67c4a04aac9a" "$file"
grep -Fq "2026-08-05T04:37:08.161Z" "$file"

# Do not regress to the older retained-source lineage as the top-level reclaim
# provenance. Those values were the source of the mixed-chain bug in PR #1300.
for stale in \
  "30975277983" \
  "d7e6eb86eb0e660dffd3ad5e54d2fd995ba8a54c" \
  "fb78d4600a955a9f208cc8418786437eec367c709f7cd5b7476e43b0abeaae7c"; do
  if grep -Fq "$stale" "$file"; then
    echo "stale mixed provenance remains in reclaim migration: $stale" >&2
    exit 1
  fi
done

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

# The production runner is owner-comment-only and has no automatic trigger.
grep -Fq "github.event.issue.number == 1261" "$workflow"
grep -Fq "github.event.comment.user.login == 'badjoke-lab'" "$workflow"
grep -Fq "github.event.comment.body == '/r4f-steady-reclaim-prepare'" "$workflow"
grep -Fq "startsWith(github.event.comment.body, '/r4f-steady-reclaim-authorize ')" "$workflow"
if grep -Eq '^  (push|schedule|pull_request_target):' "$workflow"; then
  echo 'bounded reclaim runner gained an automatic or unsafe trigger' >&2
  exit 1
fi

# Only the exact guarded migration can be applied, and it is previewed before mutation.
grep -Fq "MIGRATION_VERSION: '20260811012000'" "$workflow"
grep -Fq 'supabase db push --linked --dry-run' "$workflow"
grep -Fq 'supabase db push --linked --yes' "$workflow"
grep -Fq 'Unexpected pending migration set' "$workflow"
grep -Fq 'xrpl_preview_steady_qualification_reclaim' "$workflow"
grep -Fq 'xrpl_execute_steady_qualification_reclaim' "$workflow"
grep -Fq 'api-keys?reveal=true' "$workflow"
grep -Fq 'database/query' "$workflow"
grep -Fq 'authorization-insert.json' "$workflow"
grep -Fq 'database-before.json' "$workflow"
grep -Fq 'database-after.json' "$workflow"

# The service-role credential is resolved only at runtime and is never a repository secret binding.
if grep -Fq 'SUPABASE_SERVICE_ROLE_KEY' "$workflow"; then
  echo 'static service-role secret binding is forbidden for reclaim runner' >&2
  exit 1
fi
grep -Fq '::add-mask::${service_role_key}' "$workflow"
grep -Fq 'rm -f /tmp/project-api-keys.json' "$workflow"

# Keep dangerous adjacent capabilities out of this one-shot runner.
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

# Static execution order: dry-run -> possible migration -> preview -> auth row -> exactly one RPC -> post-measure.
python - "$workflow" <<'PY'
from pathlib import Path
import sys
text = Path(sys.argv[1]).read_text()
needles = [
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
