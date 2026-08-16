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
    'minute successor and resource diagnostic workflow allowlist entries',
    '  r4f-revision4-resource-snapshot-refresh.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-revision4-resource-snapshot-refresh.yml\n  r5-bounded-recovery-burst.yml\n  r5-revision4-minute-successor.yml\n  r5-revision4-resource-halt-diagnostic.yml',
)
replace_once(
    'minute successor and resource diagnostic workflow count',
    'GitHub Actions workflow count must remain exactly seventeen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly nineteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'minute successor and resource diagnostic workflow symbols',
    'r4f_rev4_resource_refresh = "r4f-revision4-resource-snapshot-refresh.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_resource_refresh = "r4f-revision4-resource-snapshot-refresh.yml"\nr5_rev4_minute = "r5-revision4-minute-successor.yml"\nr5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'minute successor and resource diagnostic trigger policy',
    '    r4f_rev4_resource_refresh: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_resource_refresh: ["issue_comment"],\n    r5_rev4_minute: ["issue_comment"],\n    r5_rev4_resource_diagnostic: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('minute successor policy insertion point is not unique')

block = r'''minute = (root / r5_rev4_minute).read_text()
minute_successor_manager = (root / "../../scripts/manage-r5-revision4-minute-successor.mjs").read_text()
minute_successor_transformer = (root / "../../scripts/prepare-r5-minute-successor-source.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-minute-successor-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-minute-successor-activate ')",
    "INVOCATION_HALT_31D: '400000'",
    "CURRENT_MIGRATION_VERSION: '20260816040000'",
    "SUCCESSOR_MIGRATION_VERSION: '20260816050000'",
    "r5-recovery-selected-revision4-minute-entry",
    "r5-recovery-selected-revision4-minute2-entry",
    "scripts/manage-r5-revision4-minute-successor.mjs",
    "scripts/prepare-r5-minute-successor-source.mjs",
    "scripts/verify-r5-revision4-minute-followup.mjs",
    "xrpl_drain_r5_checkpoint_boundary",
    "failedMinuteRunPreservedExactly",
    "failedMinuteBatchesPreservedExactly",
    "failedMinuteRunRemovedFromContinuousHeadAdmission",
    "xrpl-r5-minute-driver",
    "xrpl-r5-recovery-batch",
    "scripts/manage-r4f-g3-isolated-window.mjs",
    "scripts/switch-r5-revision4-minute-scheduler.mjs",
    "scripts/rollback-r5-revision4-minute-scheduler.mjs",
    "supabase functions deploy",
    "version: 2.114.0",
    "resourceSnapshot.fresh == true",
    "projectedInvocations31d < 400000",
    "'* * * * *'",
    "No Mainnet, stabilization, soak, or history reduction is authorized.",
    "No history deletion or public-reader rewrite is authorized.",
):
    if required not in minute:
        raise SystemExit(f"revision-4 minute successor workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
    "version: latest",
    "/r5-revision4-minute-activate ",
    "github.event.comment.body == '/r5-revision4-minute-prepare'",
):
    if forbidden in minute:
        raise SystemExit(f"revision-4 minute successor workflow contains forbidden capability: {forbidden.strip()}")
if minute.count("issues: write") != 1:
    raise SystemExit("revision-4 minute successor workflow must have exactly one issue-write permission")
if minute.count("supabase functions deploy") != 2:
    raise SystemExit("revision-4 minute successor must deploy exactly the R5 executor and minute driver")
for required in (
    "const FAILED_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'",
    "const TARGET_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "public.xrpl_drain_r5_checkpoint_boundary",
    "failedMinuteRunPreservedExactly: true",
    "failedMinuteBatchesPreservedExactly: true",
    "formalEvidencePreservedExactly: true",
    "failedMinuteRunRemovedFromContinuousHeadAdmission: true",
    "publicReaderMutationPerformed: false",
    "mainnetDisabled: true",
):
    if required not in minute_successor_manager:
        raise SystemExit(f"revision-4 minute successor manager missing guarded contract: {required}")
for forbidden in (
    "delete from xrpl_r5_v1.recovery_batches",
    "delete from xrpl_r5_v1.recovery_runs",
    "truncate table",
    "cron.schedule",
    "cron.unschedule",
):
    if forbidden in minute_successor_manager.lower():
        raise SystemExit(f"revision-4 minute successor manager contains forbidden operation: {forbidden}")
for required in (
    "const FAILED_RUN_ID = 'r5-recovery-selected-revision4-minute-entry'",
    "const NEW_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "expected exactly one formal revision4 run binding",
    "failedRunIdExcluded",
    "mainnetDisabled: true",
):
    if required not in minute_successor_transformer:
        raise SystemExit(f"revision-4 minute successor transformer missing exact-source contract: {required}")

resource_diagnostic = (root / r5_rev4_resource_diagnostic).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-resource-halt-diagnose'",
    "scripts/diagnose-r5-revision4-resource-halt.ts",
    "r5-revision4-resource-halt-diagnostic/diagnostic.json",
    "productionDatabaseReadOnly == true",
    "noRunMutation == true",
    "noBatchMutation == true",
    "noPublicReaderMutation == true",
    "mainnetDisabled == true",
):
    if required not in resource_diagnostic:
        raise SystemExit(f"revision-4 resource diagnostic workflow is missing read-only requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase functions deploy",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in resource_diagnostic:
        raise SystemExit(f"revision-4 resource diagnostic contains forbidden capability: {forbidden.strip()}")
if resource_diagnostic.count("issues: write") != 1:
    raise SystemExit("revision-4 resource diagnostic must have exactly one issue-write permission")

'''
text = text.replace(marker, block + marker)

replace_once(
    'minute successor policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)

path.write_text(text)
