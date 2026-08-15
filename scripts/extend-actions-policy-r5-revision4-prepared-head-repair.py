from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision4-prepared-head-repair.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'prepared-head repair allowlist',
    '  r5-revision4-resource-halt-rearm.yml\n  r5-work-status-partial-index-apply.yml',
    '  r5-revision4-resource-halt-rearm.yml\n  r5-revision4-prepared-head-repair.yml\n  r5-work-status-partial-index-apply.yml',
)
replace_once(
    'prepared-head repair workflow count',
    'GitHub Actions workflow count must remain exactly twenty-eight while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly twenty-nine while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'prepared-head repair symbol',
    'r5_rev4_resource_rearm = "r5-revision4-resource-halt-rearm.yml"',
    'r5_rev4_resource_rearm = "r5-revision4-resource-halt-rearm.yml"\nr5_rev4_prepared_head_repair = "r5-revision4-prepared-head-repair.yml"',
)
replace_once(
    'prepared-head repair trigger',
    '    r5_rev4_resource_rearm: ["issue_comment"],',
    '    r5_rev4_resource_rearm: ["issue_comment"],\n    r5_rev4_prepared_head_repair: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('prepared-head repair policy insertion point is not unique')
block = r'''prepared_head_repair = (root / r5_rev4_prepared_head_repair).read_text()
prepared_head_manager = (root / "../scripts/manage-r5-revision4-prepared-head-memory-retry-fix.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision4-prepared-head-repair-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision4-prepared-head-repair ')",
    "ops/production-sql/20260815211500_xrpl_r5_revision4_prepared_head_memory_retry_fix.sql",
    "scripts/manage-r5-revision4-prepared-head-memory-retry-fix.mjs",
    "Audit exact rolled-back production state read-only",
    "Revalidate exact authorized production state read-only",
    "Apply exact bounded revision4 prepared-head repair",
    "revision4MemoryRetryCalls",
    "revision3MemoryRetryCalls",
    "schedulerMutationAuthorized",
    "canonicalHistoryMutationAuthorized",
    "No Mainnet",
):
    if required not in prepared_head_repair:
        raise SystemExit(f"revision-4 prepared-head repair workflow missing fail-closed requirement: {required}")
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
    if forbidden in prepared_head_repair:
        raise SystemExit(f"revision-4 prepared-head repair workflow contains forbidden capability: {forbidden.strip()}")
if prepared_head_repair.count("issues: write") != 1:
    raise SystemExit("revision-4 prepared-head repair workflow must have exactly one issue-write permission")
for required in (
    "const SQL_PATH = `ops/production-sql/${VERSION}_${NAME}.sql`",
    "read_only: readOnly",
    "classification !== 'unapplied_expected'",
    "authorizationStateSha256 !== expectedState",
    "revision4MemoryRetryCalls",
    "revision3MemoryRetryCalls",
    "runIsZeroProgressPrepared",
    "schedulerIsRestoredCollector",
    "set local lock_timeout = '5s'",
    "set local statement_timeout = '45s'",
    "insert into supabase_migrations.schema_migrations",
    "classification !== 'applied_consistent'",
    "schedulerMutationPerformed: false",
    "canonicalHistoryMutationPerformed: false",
    "mainnetDisabled: true",
):
    if required not in prepared_head_manager:
        raise SystemExit(f"revision-4 prepared-head repair manager missing guarded contract: {required}")
for forbidden in (
    "truncate table",
    "delete from xrpl_r5_v1.recovery_batches",
    "cron.schedule",
    "cron.unschedule",
):
    if forbidden in prepared_head_manager.lower():
        raise SystemExit(f"revision-4 prepared-head repair manager contains forbidden operation: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
