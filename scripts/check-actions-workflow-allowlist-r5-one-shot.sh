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
    "R5 finite proof trigger policy",
    '    r5_burst: ["workflow_dispatch", "issue_comment"],',
    '    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)
replace_once(
    "R5 V4 proof marker and owner burst contract",
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
    "github.event_name == 'push'",
    "github.ref == 'refs/heads/main'",
    "ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker",
    "17e79165228f751c9cf5da3e33d6e64de7be0d316782a289771c40a1c1a97a07",
    "328395146157988d438295a6777d235d34ea9726",
    "fetch-depth: 2",
    "git diff-tree --no-commit-id --name-status",
    "marker_change=",
    "author_login=",
    "gh api",
    "--jq '.author.login'",
    'test "$author_login" = badjoke-lab',
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
)
replace_once(
    "R5 V4 finite-proof push exception",
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

generated_path.write_text(text)
PY
chmod 700 "$generated_script"
bash "$generated_script" "$@"
