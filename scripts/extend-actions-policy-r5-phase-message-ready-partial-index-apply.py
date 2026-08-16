from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-phase-message-ready-partial-index-apply.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'phase ready-index workflow allowlist entry',
    '  r5-bounded-recovery-burst.yml\n  r5-revision4-db-footprint-probe.yml',
    '  r5-bounded-recovery-burst.yml\n  r5-phase-message-ready-partial-index-apply.yml\n  r5-revision4-db-footprint-probe.yml',
)
replace_once(
    'phase ready-index workflow count',
    'GitHub Actions workflow count must remain exactly twenty while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-one while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'phase ready-index workflow symbol',
    'r5_rev4_db_footprint = "r5-revision4-db-footprint-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r5_rev4_db_footprint = "r5-revision4-db-footprint-probe.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'phase ready-index trigger policy',
    '    r5_rev4_db_footprint: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r5_rev4_db_footprint: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('phase ready-index policy insertion point is not unique')

block = r'''phase_ready_index = (root / r5_phase_ready_index_apply).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-phase-ready-index-prepare'",
    "startsWith(github.event.comment.body, '/r5-phase-ready-index-authorize ')",
    "TARGET_MIGRATION_VERSION: '20260814130000'",
    "scripts/manage-r5-phase-message-ready-live-safe.mjs",
    "node \"$MANAGER_PATH\" prepare",
    "head=${MIGRATION_HEAD}",
    "--authorized-state",
    "Authorization expires",
    "Current production migration head",
    "strictly behind the current production migration head",
    "structural authorization digest",
    "lock timeout",
    "statement timeout",
    "Canonical history row mutation authorized: \\`false\\`",
    "Scheduler mutation: \\`none\\`",
    "Public reader: \\`unchanged\\`",
    "Mainnet: \\`disabled\\`",
    "Stabilization/soak/R5 restart: \\`not authorized\\`",
):
    if required not in phase_ready_index:
        raise SystemExit(f"phase ready-index apply workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase functions deploy",
    "supabase db push",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
    "PREVIOUS_MIGRATION_VERSION",
):
    if forbidden in phase_ready_index:
        raise SystemExit(f"phase ready-index apply workflow contains forbidden capability: {forbidden.strip()}")
if phase_ready_index.count("issues: write") != 1:
    raise SystemExit("phase ready-index apply workflow must have exactly one issue-write permission")
if phase_ready_index.count("github.event.comment.body == '/r5-phase-ready-index-prepare'") != 1:
    raise SystemExit("phase ready-index apply workflow must have one exact owner prepare gate")
if phase_ready_index.count("startsWith(github.event.comment.body, '/r5-phase-ready-index-authorize ')") != 1:
    raise SystemExit("phase ready-index apply workflow must have one exact owner authorize gate")

'''
text = text.replace(marker, block + marker)

replace_once(
    'phase ready-index policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, one read-only revision-4 database-footprint probe, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, one read-only revision-4 database-footprint probe, one authorization-gated phase-message ready-index replacement workflow with exact live-head structural binding, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)

path.write_text(text)
