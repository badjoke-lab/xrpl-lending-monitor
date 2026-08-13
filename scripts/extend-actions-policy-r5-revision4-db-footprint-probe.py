from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision4-db-footprint-probe.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'database footprint workflow allowlist entry',
    '  r5-revision4-resource-halt-diagnostic.yml\n  read-only-production-qualification.yml',
    '  r5-revision4-resource-halt-diagnostic.yml\n  r5-revision4-db-footprint-probe.yml\n  read-only-production-qualification.yml',
)
replace_once(
    'database footprint workflow count',
    'GitHub Actions workflow count must remain exactly nineteen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'database footprint workflow symbol',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r5_rev4_resource_diagnostic = "r5-revision4-resource-halt-diagnostic.yml"\nr5_rev4_db_footprint = "r5-revision4-db-footprint-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'database footprint trigger policy',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r5_rev4_resource_diagnostic: ["issue_comment"],\n    r5_rev4_db_footprint: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('database footprint policy insertion point is not unique')

block = r'''db_footprint = (root / r5_rev4_db_footprint).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-db-footprint-probe'",
    "pg_database_size(current_database())",
    "pg_total_relation_size(c.oid)",
    "pg_indexes_size(c.oid)",
    "read_only:true",
    "productionDatabaseReadOnly",
    "noDatabaseMutation",
    "noSchedulerMutation",
    "noDeployment",
    "noMigration",
    "noPublicReaderMutation",
    "mainnetDisabled",
):
    if required not in db_footprint:
        raise SystemExit(f"revision-4 database footprint probe is missing read-only requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase functions deploy",
    "cron.schedule",
    "cron.unschedule",
    "supabase db push",
    "wrangler deploy",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in db_footprint:
        raise SystemExit(f"revision-4 database footprint probe contains forbidden capability: {forbidden.strip()}")
if db_footprint.count("issues: write") != 1:
    raise SystemExit("revision-4 database footprint probe must have exactly one issue-write permission")

'''
text = text.replace(marker, block + marker)

replace_once(
    'database footprint policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, and one finite R5 recovery burst; no scheduled GitHub workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, one authorization-gated revision-4 one-minute runtime activation workflow, one read-only revision-4 resource-halt diagnostic workflow, one read-only revision-4 database-footprint probe, and one finite R5 recovery burst; no scheduled GitHub workflows.',
)

path.write_text(text)