from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-revision3-restore-schema-retirement.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'restore schema retirement workflow allowlist entry',
    '  r5-retention-readonly-preflight.yml\n  r5-revision4-db-footprint-probe.yml\n',
    '  r5-retention-readonly-preflight.yml\n  r5-revision3-restore-schema-retirement.yml\n  r5-revision4-db-footprint-probe.yml\n',
)
replace_once(
    'restore schema retirement workflow count',
    'GitHub Actions workflow count must remain exactly forty-four while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty-five while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'restore schema retirement workflow symbol',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"\nr5_revision3_restore_schema_retirement = "r5-revision3-restore-schema-retirement.yml"',
)
replace_once(
    'restore schema retirement trigger policy',
    '    r5_legacy_rev3_retirement: ["issue_comment"],',
    '    r5_legacy_rev3_retirement: ["issue_comment"],\n    r5_revision3_restore_schema_retirement: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('restore schema retirement policy insertion point is not unique')

block = r'''restore_schema_retirement = (root / r5_revision3_restore_schema_retirement).read_text()
restore_schema_retirement_manager = (root / "../../scripts/manage-r5-revision3-restore-schema-retirement.mjs").read_text()
restore_schema_retirement_sql = (root / "../../ops/production-sql/20260827153500_xrpl_revision3_restore_schema_retirement.sql").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-revision3-restore-schema-retirement-prepare'",
    "startsWith(github.event.comment.body, '/r5-revision3-restore-schema-retirement-authorize ')",
    "scripts/manage-r5-revision3-restore-schema-retirement.mjs",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized restore schema retirement state read-only",
    "Apply exact no-CASCADE restore schema retirement",
    "Independent post-commit read-only verify",
    "exactFunctionDropCount",
    "exactTableDropCount",
    "cascadePerformed",
    "rowMutationPerformed",
    "schedulerMutationPerformed",
    "publicReaderMutationPerformed",
    "r5RearmPerformed",
):
    if required not in restore_schema_retirement:
        raise SystemExit(f"restore schema retirement workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in restore_schema_retirement:
        raise SystemExit(f"restore schema retirement workflow contains forbidden capability: {forbidden.strip()}")
if restore_schema_retirement.count("issues: write") != 1:
    raise SystemExit("restore schema retirement workflow must have exactly one issue-write permission")

for required in (
    "20260827153500_xrpl_revision3_restore_schema_retirement.sql",
    "301e4b7c2c6b229330a8b291b489987c12b2302389b0c3470a4878978757b990",
    "835d6200b8897889553b9d857fbad4c61b33a3eab0f3fad4dec9013f70909187",
    "c920ed138140e4698f707a0702ed6d478d3de0ac779ccd14055ac82838f8d5d6",
    "e855f67c4847cdf0f472f468471bfec78e2f6ce6e0e58a846322f782d52e104b",
    "bac17dd7f28fb056053a064aa1d34de0d7bd8264181b271f20afcb32224b443f",
    "EXPECTED_DEPENDENCIES",
    "lock table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets in access exclusive mode",
    "xrpl_resource_guard_v2.tick_accounting, xrpl_resource_guard_v2.transfer_qualifications in share mode",
    "lock table cron.job, supabase_migrations.schema_migrations in access share mode",
    "extensionOwnedAccessShareLockVerified: true",
    "schedulerMigrationGuardStrategy: 'access_share_plus_transaction_pre_post_exact_recheck'",
    "function controlStateGuardSql(expectedScheduler, phase)",
    "controlStateGuardSql(expectedScheduler, 'before')",
    "controlStateGuardSql(expectedScheduler, 'after')",
    "schedulerMigrationTransactionRevalidated: true",
    "extensionOwnedPrivilegeMutationPerformed: false",
    "managementQuery(bundle, false)",
    "functionDropPerformed: true",
    "exactFunctionDropCount: 5",
    "tableDropPerformed: true",
    "exactTableDropCount: 3",
    "schemaDropPerformed: true",
    "cascadePerformed: false",
    "rowMutationPerformed: false",
    "schedulerMutationPerformed: false",
    "deploymentPerformed: false",
    "publicReaderMutationPerformed: false",
    "r5RearmPerformed: false",
    "mainnetDisabled: true",
):
    if required not in restore_schema_retirement_manager:
        raise SystemExit(f"restore schema retirement manager missing fail-closed guard: {required}")
for forbidden in (
    "set local role supabase_admin",
    "lock table cron.job, supabase_migrations.schema_migrations in share mode",
):
    if forbidden in restore_schema_retirement_manager:
        raise SystemExit(f"restore schema retirement manager contains forbidden extension-owner capability: {forbidden}")
if restore_schema_retirement_manager.count("managementQuery(bundle, false)") != 1:
    raise SystemExit("restore schema retirement manager must expose exactly one production mutation request")

normalized_sql = ' '.join(restore_schema_retirement_sql.lower().split())
expected_sql = ' '.join((
    'drop function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization();',
    'drop function xrpl_resource_guard_v2.qualify_transfer_on_completion();',
    'drop function public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone);',
    'drop function public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone);',
    'drop function xrpl_resource_restore_v1.build_restored_accounting_state(text);',
    'drop table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets;',
    'drop schema xrpl_resource_restore_v1;',
))
if normalized_sql != expected_sql:
    raise SystemExit('restore schema retirement SQL is not the exact bounded no-CASCADE plan')
for forbidden in ('cascade', 'if exists', 'delete', 'truncate', 'update', 'insert', 'alter', 'grant', 'revoke', 'vacuum', 'reindex', 'cluster'):
    if forbidden in normalized_sql:
        raise SystemExit(f'restore schema retirement SQL contains forbidden expansion: {forbidden}')

'''
text = text.replace(marker, block + marker)
path.write_text(text)
