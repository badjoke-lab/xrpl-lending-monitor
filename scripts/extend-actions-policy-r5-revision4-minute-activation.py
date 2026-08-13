from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision4-minute-activation.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'minute activation workflow allowlist entry',
    '  r4f-revision4-resource-snapshot-refresh.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-revision4-resource-snapshot-refresh.yml\n  r5-bounded-recovery-burst.yml\n  r5-revision4-minute-activation.yml',
)
replace_once(
    'minute activation workflow count',
    'GitHub Actions workflow count must remain exactly seventeen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly eighteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'minute activation workflow symbol',
    'r4f_rev4_resource_refresh = "r4f-revision4-resource-snapshot-refresh.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_resource_refresh = "r4f-revision4-resource-snapshot-refresh.yml"\nr5_rev4_minute = "r5-revision4-minute-activation.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'minute activation trigger policy',
    '    r4f_rev4_resource_refresh: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_resource_refresh: ["issue_comment"],\n    r5_rev4_minute: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('minute activation policy insertion point is not unique')

block = r'''minute = (root / r5_rev4_minute).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-minute-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-minute-activate ')",
    "INVOCATION_HALT_31D: '400000'",
    "TARGET_MIGRATION_VERSION: '20260813072000'",
    "20260813060000",
    "xrpl-r5-minute-driver",
    "xrpl-r5-recovery-batch",
    "scripts/manage-r4f-g3-isolated-window.mjs",
    "scripts/switch-r5-revision4-minute-scheduler.mjs",
    "scripts/rollback-r5-revision4-minute-scheduler.mjs",
    "supabase functions deploy",
    "read_only:false",
    "read_only:true",
    "provider_snapshot_stale",
    "r5_recovery_monthly_invocation_halt",
    "projected_invocations_31d",
    "'* * * * *'",
    "No Mainnet, stabilization, soak, or history reduction is authorized",
):
    if required not in minute:
        raise SystemExit(f"revision-4 minute activation workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in minute:
        raise SystemExit(f"revision-4 minute activation workflow contains forbidden capability: {forbidden.strip()}")
if minute.count("issues: write") != 1:
    raise SystemExit("revision-4 minute activation workflow must have exactly one issue-write permission")
if minute.count("supabase functions deploy") != 2:
    raise SystemExit("revision-4 minute activation must deploy exactly the R5 executor and minute driver")

'''
text = text.replace(marker, block + marker)

replace_once(
    'minute activation policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)

path.write_text(text)
