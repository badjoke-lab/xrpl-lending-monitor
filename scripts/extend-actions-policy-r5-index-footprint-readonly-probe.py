from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-index-footprint-readonly-probe.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'index footprint allowlist',
    '  r5-cron-history-retention.yml\n  r5-phase-message-ready-partial-index-apply.yml',
    '  r5-cron-history-retention.yml\n  r5-index-footprint-readonly-probe.yml\n  r5-phase-message-ready-partial-index-apply.yml',
)
replace_once(
    'index footprint workflow count',
    'GitHub Actions workflow count must remain exactly twenty-three while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-four while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'index footprint symbol',
    'r5_cron_history_retention = "r5-cron-history-retention.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
    'r5_cron_history_retention = "r5-cron-history-retention.yml"\nr5_index_footprint_probe = "r5-index-footprint-readonly-probe.yml"\nr5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
)
replace_once(
    'index footprint trigger',
    '    r5_cron_history_retention: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],',
    '    r5_cron_history_retention: ["issue_comment"],\n    r5_index_footprint_probe: ["issue_comment"],\n    r5_phase_ready_index_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('index footprint insertion point is not unique')
block = r'''index_footprint_probe = (root / r5_index_footprint_probe).read_text()
index_footprint_manager = (root / "scripts/r5-index-footprint-readonly-probe.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-index-footprint-readonly-probe'",
    "scripts/r5-index-footprint-readonly-probe.mjs",
    "Read production index footprint only",
    "Upload sanitized read-only index evidence",
    "Publish sanitized read-only index result",
):
    if required not in index_footprint_probe:
        raise SystemExit(f"index footprint read-only workflow missing requirement: {required}")
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
    "DELETE FROM",
    "delete from",
    "VACUUM (",
    "vacuum (",
    "DROP INDEX",
    "drop index",
):
    if forbidden in index_footprint_probe:
        raise SystemExit(f"index footprint read-only workflow contains forbidden capability: {forbidden.strip()}")
if index_footprint_probe.count("issues: write") != 1:
    raise SystemExit("index footprint workflow must have exactly one issue-write permission")
for required in (
    "body: JSON.stringify({ query, read_only: true })",
    "noIndexMutationAuthorized",
    "noDeleteAuthorized",
    "noVacuumAuthorized",
    "noSchedulerMutationAuthorized",
    "noDeploymentAuthorized",
    "mainnetDisabled",
):
    if required not in index_footprint_manager:
        raise SystemExit(f"index footprint manager missing read-only boundary: {required}")
if "read_only: false" in index_footprint_manager:
    raise SystemExit("index footprint manager contains writable management query")

'''
text = text.replace(marker, block + marker)
replace_once(
    'index footprint summary',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one owner-triggered read-only retention preflight, one authorization-gated bounded pg_cron history retention workflow, one owner-triggered read-only index-footprint probe, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)
path.write_text(text)
