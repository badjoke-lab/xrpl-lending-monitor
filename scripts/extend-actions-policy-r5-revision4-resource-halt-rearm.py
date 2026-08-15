from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision4-resource-halt-rearm.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'resource halt rearm allowlist',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-work-status-partial-index-apply.yml',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-revision4-resource-halt-rearm.yml\n  r5-work-status-partial-index-apply.yml',
)
replace_once(
    'resource halt rearm workflow count',
    'GitHub Actions workflow count must remain exactly twenty-seven while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-eight while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'resource halt rearm symbol',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"\nr5_rev4_resource_rearm = "r5-revision4-resource-halt-rearm.yml"',
)
replace_once(
    'resource halt rearm trigger',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],\n    r5_rev4_resource_rearm: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('resource halt rearm policy insertion point is not unique')
block = r'''resource_rearm = (root / r5_rev4_resource_rearm).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-resource-halt-rearm-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-resource-halt-rearm ')",
    "scripts/inspect-r5-revision4-minute-state.mjs",
    "scripts/diagnose-r5-revision4-resource-halt.ts",
    "no_resource_halt_reproduced",
    "read_only:false",
    "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0))",
    "v_run.status <> 'halted'",
    "v_run.last_error <> 'revision4_resource_halt'",
    "v_run.completed_batches <> 0",
    "v_run.committed_ledgers <> 0",
    "v_run.last_accounting_digest is not null",
    "v_batch.status <> 'halted'",
    "v_batch.error_message <> 'revision4_resource_halt'",
    "v_batch.rows_digest is not null",
    "v_batch.accounting_digest is not null",
    "v_batch.final_work_id is not null",
    "delete from xrpl_r5_v1.recovery_batches",
    "set status = 'prepared'",
    "remainingBatchCount == 0",
    "activationMode == \"prepared_continue\"",
    "This operation does not activate the one-minute scheduler or enable Mainnet",
):
    if required not in resource_rearm:
        raise SystemExit(f"revision-4 resource-halt rearm workflow missing fail-closed requirement: {required}")
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
):
    if forbidden in resource_rearm:
        raise SystemExit(f"revision-4 resource-halt rearm workflow contains forbidden capability: {forbidden.strip()}")
if resource_rearm.count("issues: write") != 1:
    raise SystemExit("revision-4 resource-halt rearm workflow must have exactly one issue-write permission")
if resource_rearm.count("read_only:false") != 1:
    raise SystemExit("revision-4 resource-halt rearm workflow must have exactly one writable Management API call")
if resource_rearm.count("delete from xrpl_r5_v1.recovery_batches") != 1:
    raise SystemExit("revision-4 resource-halt rearm workflow must delete exactly one guarded batch statement")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
