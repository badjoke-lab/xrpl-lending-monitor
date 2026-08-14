from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-work-status-partial-index-apply.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'work status allowlist',
    '  r5-revision4-resource-halt-diagnostic.yml\n  read-only-production-qualification.yml',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-work-status-partial-index-apply.yml\n  read-only-production-qualification.yml',
)
replace_once(
    'work status workflow count',
    'GitHub Actions workflow count must remain exactly twenty-four while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-five while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'work status symbol',
    'r5_index_footprint_probe = "r5-index-footprint-readonly-probe.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
    'r5_index_footprint_probe = "r5-index-footprint-readonly-probe.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_work_status_index_apply = "r5-work-status-partial-index-apply.yml"',
)
replace_once(
    'work status trigger',
    '    r5_index_footprint_probe: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],',
    '    r5_index_footprint_probe: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_work_status_index_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('work status insertion point is not unique')
block = r'''work_status_index_apply = (root / r5_work_status_index_apply).read_text()
work_status_index_manager = (root.parent.parent / "scripts/manage-r5-work-status-partial-index.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-work-status-index-prepare'",
    "startsWith(github.event.comment.body, '/r5-work-status-index-authorize ')",
    "scripts/manage-r5-work-status-partial-index.mjs",
    "Inspect exact work-status pre-state read-only",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact work-status partial-index replacement",
):
    if required not in work_status_index_apply:
        raise SystemExit(f"work-status partial-index workflow missing requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase db push",
    "supabase functions deploy",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in work_status_index_apply:
        raise SystemExit(f"work-status partial-index workflow contains forbidden capability: {forbidden.strip()}")
if work_status_index_apply.count("issues: write") != 1:
    raise SystemExit("work-status partial-index workflow must have exactly one issue-write permission")
for required in (
    "managementQuery(inspectionSql(), true)",
    "await managementQuery(MUTATION_SQL, false)",
    "where status <> 'committed'",
    "set local lock_timeout = '5s'",
    "set local statement_timeout = '45s'",
    "lock table public.xrpl_phase_work in share mode",
    "drop index public.xrpl_phase_work_status_idx",
    "rename to xrpl_phase_work_status_idx",
    "rowMutationAuthorized: false",
    "vacuumAuthorized: false",
    "schedulerMutationAuthorized: false",
    "deploymentAuthorized: false",
    "mainnetDisabled: true",
):
    if required not in work_status_index_manager:
        raise SystemExit(f"work-status partial-index manager missing contract: {required}")

'''
text = text.replace(marker, block + marker)
replace_once(
    'work status summary',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one owner-triggered read-only index-footprint probe, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one owner-triggered read-only index-footprint probe, one authorization-gated work-status partial-index replacement, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)
path.write_text(text)
