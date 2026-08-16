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
    'resource guard allowlist',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-work-status-partial-index-apply.yml',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-revision4-resource-halt-rearm.yml\n  r5-work-status-partial-index-apply.yml',
)
replace_once(
    'resource guard workflow count',
    'GitHub Actions workflow count must remain exactly twenty-seven while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-eight while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'resource guard symbol',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"\nr5_rev4_resource_rearm = "r5-revision4-resource-halt-rearm.yml"',
)
replace_once(
    'resource guard trigger',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],\n    r5_rev4_resource_rearm: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('resource guard policy insertion point is not unique')
block = r'''resource_rearm = (root / r5_rev4_resource_rearm).read_text()
for required in (
    "name: R5 revision4 database guard apply",
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-database-guard-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-database-guard-authorize ')",
    "scripts/manage-r5-revision4-database-guard.mjs prepare",
    "scripts/manage-r5-revision4-database-guard.mjs apply",
    "scripts/manage-r5-revision4-database-guard.mjs wait-for-halt",
    "structuralStateSha256",
    "guardSqlSha256",
    "sha256sum scripts/manage-r5-revision4-database-guard.mjs",
    "databaseBytes",
    "400000000",
    "r5-recovery-selected-revision4-minute2-entry",
    "r5_recovery_database_halt",
    "manualClaimInvoked == false",
    "mainnetDisabled == true",
    "rearmAuthorized == false",
    "The authorization applies only the staged claim guard",
):
    if required not in resource_rearm:
        raise SystemExit(f"revision-4 database-guard workflow missing fail-closed requirement: {required}")
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
    "delete from xrpl_r5_v1.recovery_batches",
    "set status = 'prepared'",
    "/r5-revision4-resource-halt-rearm-prepare",
):
    if forbidden in resource_rearm:
        raise SystemExit(f"revision-4 database-guard workflow contains forbidden capability: {forbidden.strip()}")
if resource_rearm.count("issues: write") != 1:
    raise SystemExit("revision-4 database-guard workflow must have exactly one issue-write permission")
if resource_rearm.count("scripts/manage-r5-revision4-database-guard.mjs apply") != 1:
    raise SystemExit("revision-4 database-guard workflow must have exactly one authorized apply step")
if resource_rearm.count("scripts/manage-r5-revision4-database-guard.mjs wait-for-halt") != 1:
    raise SystemExit("revision-4 database-guard workflow must observe exactly one natural halt path")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
