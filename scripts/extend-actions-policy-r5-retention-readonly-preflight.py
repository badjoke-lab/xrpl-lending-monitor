from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-retention-readonly-preflight.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'retention preflight workflow allowlist entry',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-revision4-db-footprint-probe.yml',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-retention-readonly-preflight.yml\n  r5-revision4-db-footprint-probe.yml',
)
replace_once(
    'retention preflight workflow count',
    'GitHub Actions workflow count must remain exactly twenty-one while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-two while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'retention preflight workflow symbol',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_retention_preflight = "r5-retention-readonly-preflight.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'retention preflight trigger policy',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_retention_preflight: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('retention preflight policy insertion point is not unique')

block = r'''retention_preflight = (root / r5_retention_preflight).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-retention-readonly-preflight'",
    "scripts/r5-retention-readonly-preflight.mjs",
    "Read retention candidates and dependencies only",
    "retentionBoundary.probeReadOnly",
    "retentionBoundary.noDeleteAuthorized",
    "retentionBoundary.noVacuumAuthorized",
    "retentionBoundary.noSchedulerMutationAuthorized",
    "retentionBoundary.noDeploymentAuthorized",
    "retentionBoundary.mainnetDisabled",
    "Upload sanitized read-only evidence",
    "Publish sanitized read-only result",
):
    if required not in retention_preflight:
        raise SystemExit(f"retention read-only preflight workflow is missing fail-closed requirement: {required}")
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
    "DELETE FROM",
    "delete from",
    "VACUUM",
    "vacuum",
):
    if forbidden in retention_preflight:
        raise SystemExit(f"retention read-only preflight workflow contains forbidden capability: {forbidden.strip()}")
if retention_preflight.count("issues: write") != 1:
    raise SystemExit("retention read-only preflight workflow must have exactly one issue-write permission")

'''
text = text.replace(marker, block + marker)

replace_once(
    'retention preflight policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, one read-only revision-4 database-footprint probe, one authorization-gated phase-message ready-index replacement workflow with read-only state classification, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, one read-only revision-4 database-footprint probe, one authorization-gated phase-message ready-index replacement workflow with read-only state classification, one owner-triggered read-only retention preflight, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)

path.write_text(text)
