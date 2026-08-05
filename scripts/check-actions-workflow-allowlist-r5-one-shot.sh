#!/usr/bin/env bash
set -euo pipefail

source_script='scripts/check-actions-workflow-allowlist.sh'
generated_script="$(mktemp)"
trap 'rm -f "$generated_script"' EXIT

python - "$source_script" "$generated_script" <<'PY'
from pathlib import Path
import sys

source_path = Path(sys.argv[1])
generated_path = Path(sys.argv[2])
text = source_path.read_text()

def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{name} expected exactly one source occurrence, found {count}")
    if new in text:
        raise SystemExit(f"{name} is already present in the canonical policy")
    updated = text.replace(old, new)
    if updated == text or old in updated or new not in updated:
        raise SystemExit(f"{name} did not converge exactly")
    text = updated

replace_once(
    "R5 read-only diagnostic trigger policy",
    '    r5_burst: ["workflow_dispatch", "issue_comment"],',
    '    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)
replace_once(
    "R5 memory-halt diagnostic and owner burst marker contract",
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
    "github.event_name == 'push'",
    "github.ref == 'refs/heads/main'",
    "diagnose-pending-scan",
    "ops/r5/run-once-20260804-8x900-observable-v2.marker",
    "f75fc25c9f6b1e255f773115cbd447cae7ced88a7afc401b22b898d7110eef08",
    "author_login=",
    "gh api",
    "--jq '.author.login'",
    'test "$author_login" = badjoke-lab',
    "node scripts/diagnose-supabase-r5-pending-scan.mjs",
    "supabase-r5-pending-scan-diagnostic",
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
)
replace_once(
    "R5 read-only diagnostic push exception",
    '''for forbidden in (
    "  schedule:",
    "  push:",
    "pull_request_target",
    "contents: write",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabase db",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in burst:
        raise SystemExit(f"R5 bounded burst workflow contains forbidden capability: {forbidden.strip()}")''',
    '''for forbidden in (
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabase db",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in burst:
        raise SystemExit(f"R5 bounded burst workflow contains forbidden capability: {forbidden.strip()}")''',
)
replace_once(
    "R5 diagnostic and burst locator count",
    '''if burst.count("issues: write") != 1 or burst.count("gh issue comment 1175") != 1:
    raise SystemExit("R5 bounded burst issue-write capability must remain bound to one permission and Issue #1175")''',
    '''if burst.count("issues: write") != 1 or burst.count("gh issue comment 1175") != 2:
    raise SystemExit("R5 workflow issue-write capability must remain bound to one permission, one bounded-burst locator, and one read-only diagnostic locator")''',
)

generated_path.write_text(text)
PY
chmod 700 "$generated_script"
bash "$generated_script" "$@"
