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


# R4F changes are applied first so the current eleven-workflow surface is explicit
# before the retained R5 one-shot diagnostic exceptions are layered on top.
replace_once(
    "R4F G3 workflow allowlist entries",
    "  r4c2c-devnet-historical-witness.yml\n  r5-bounded-recovery-burst.yml",
    "  r4c2c-devnet-historical-witness.yml\n  r4f-g3-isolated-window.yml\n  r4f-g3-one-shot-probe.yml\n  r5-bounded-recovery-burst.yml",
)
replace_once(
    "R4F G3 workflow count",
    "GitHub Actions workflow count must remain exactly nine while the guarded R5 recovery workflows are active.",
    "GitHub Actions workflow count must remain exactly eleven while R4F qualification and the guarded R5 workflows are active.",
)
replace_once(
    "R4F G3 workflow policy symbols",
    'historical_witness = "r4c2c-devnet-historical-witness.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"\nsupabase_remote = "supabase-remote-probe.yml"',
    'historical_witness = "r4c2c-devnet-historical-witness.yml"\ng3_isolation = "r4f-g3-isolated-window.yml"\ng3_probe = "r4f-g3-one-shot-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"\nsupabase_remote = "supabase-remote-probe.yml"',
)
replace_once(
    "R4F G3 trigger policy",
    '    historical_witness: ["workflow_dispatch", "push"],\n    r5_burst: ["workflow_dispatch", "issue_comment"],',
    '    historical_witness: ["workflow_dispatch", "push"],\n    g3_isolation: ["issue_comment"],\n    g3_probe: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment"],',
)
replace_once(
    "halt legacy Supabase automatic trigger policy",
    '    supabase_remote: ["workflow_dispatch", "push"],',
    '    supabase_remote: ["workflow_dispatch"],',
)

supabase_start = text.index('supabase = (root / supabase_remote).read_text()')
scheduled_start = text.index('\nscheduled = []', supabase_start)
replacement = r'''supabase = (root / supabase_remote).read_text()
for required in (
    "workflow_dispatch:",
    "contents: read",
    "Legacy Supabase remote probe is halted",
    "R5 recovery, migration, deployment, and remote mutation are not authorized by this workflow.",
    "exit 1",
):
    if required not in supabase:
        raise SystemExit(f"halted Supabase remote workflow is missing fail-closed boundary: {required}")
for forbidden in (
    "  push:",
    "issue_comment:",
    "schedule:",
    "issues: write",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_DB_PASSWORD",
    "supabase link",
    "supabase db",
    "supabase functions deploy",
    "xrpl-r5-recovery-batch",
):
    if forbidden in supabase:
        raise SystemExit(f"halted Supabase remote workflow contains forbidden capability: {forbidden.strip()}")

g3 = (root / g3_probe).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-g3-prepare'",
    "startsWith(github.event.comment.body, '/r4f-g3-authorize ')",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_ID",
    "supabase functions deploy xrpl-r4f-g3-directional-probe",
    "supabase functions delete xrpl-r4f-g3-directional-probe",
    "supabase secrets unset R4F_G3_PROBE_VERIFY_TOKEN R4F_G3_PROBE_SOURCE_COMMIT",
    "r4f-g3-one-shot-evidence",
    "retention-days: 14",
    "gh issue comment",
):
    if required not in g3:
        raise SystemExit(f"R4F G3 workflow is missing bounded requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabase link",
    "supabase db",
    "xrpl-r5-recovery-batch",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in g3:
        raise SystemExit(f"R4F G3 workflow contains forbidden capability: {forbidden.strip()}")
if g3.count("issues: write") != 1:
    raise SystemExit("R4F G3 issue-write capability must remain exactly one permission")

g3_isolated = (root / g3_isolation).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-g3-isolation-prepare'",
    "SUPABASE_ACCESS_TOKEN",
    "SUPABASE_PROJECT_ID",
    "node scripts/prepare-r4f-g3-isolated-window.mjs",
    "r4f-g3-isolated-window-prepare-evidence",
    "retention-days: 14",
    "This preparation is read-only.",
    "gh issue comment",
):
    if required not in g3_isolated:
        raise SystemExit(f"R4F G3 isolation workflow is missing read-only preparation boundary: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "SUPABASE_DB_PASSWORD",
    "SUPABASE_SERVICE_ROLE_KEY",
    "supabase link",
    "supabase db",
    "supabase functions deploy",
    "supabase functions delete",
    "supabase secrets set",
    "supabase secrets unset",
    "cron.unschedule",
    "cron.schedule",
    "xrpl-r5-recovery-batch",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in g3_isolated:
        raise SystemExit(f"R4F G3 isolation workflow contains forbidden direct capability: {forbidden.strip()}")
if g3_isolated.count("issues: write") != 1:
    raise SystemExit("R4F G3 isolation issue-write capability must remain exactly one permission")
'''
text = text[:supabase_start] + replacement + text[scheduled_start:]
replace_once(
    "R4F G3 policy summary",
    "Actions workflow allowlist passed: CI, guarded legacy recovery workflows, one read-only production probe, one read-only R4C2c witness discovery, one guarded Supabase deployment verifier, and one finite R5 recovery burst with exact owner-command activation; no scheduled workflows.",
    "Actions workflow allowlist passed: CI, guarded legacy recovery workflows, one read-only production probe, one read-only R4C2c witness discovery, one fail-closed halted legacy Supabase workflow, one bounded R4F G3 isolation-control workflow, one isolated R4F G3 probe workflow, and one finite R5 recovery burst; no scheduled workflows.",
)

# Existing R5 one-shot diagnostic policy exceptions.
replace_once(
    "R5 egress halt V2 diagnostic trigger policy",
    '    r5_burst: ["workflow_dispatch", "issue_comment"],',
    '    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)
replace_once(
    "R5 egress halt V2 diagnostic and owner burst contract",
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
    '''    "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
    "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
    "github.event_name == 'push'",
    "github.ref == 'refs/heads/main'",
    "diagnose-r5-egress-halt",
    "ops/r5/run-once-20260805-pending-scan-readonly.marker",
    "6d2b17c6bd72b1edd2976f149d030dc52f9de59de495a7e8f59726fa61368c4f",
    "55911f23638fcbf24c157ed2a39235b42d3cef2b",
    "fetch-depth: 2",
    "git diff-tree --no-commit-id --name-status",
    "node scripts/diagnose-supabase-r5-egress-halt-v2.mjs",
    "supabase-r5-egress-halt-diagnostic",
    "R5_RECOVERY_BURST_BATCH_LIMIT",''',
)
replace_once(
    "R5 read-only egress V2 diagnostic push exception",
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
    raise SystemExit("R5 workflow issue-write capability must remain bound to one permission, one burst locator, and one read-only diagnostic locator")''',
)

generated_path.write_text(text)
PY
chmod 700 "$generated_script"
bash "$generated_script" "$@"
node scripts/check-r4f-g3-isolation-control-policy.mjs
