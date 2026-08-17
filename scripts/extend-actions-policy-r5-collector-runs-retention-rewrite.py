from pathlib import Path
import sys

if len(sys.argv)!=2:
    raise SystemExit('usage: extend-actions-policy-r5-collector-runs-retention-rewrite.py <generated-policy>')
path=Path(sys.argv[1]); text=path.read_text()

def replace_once(name,old,new):
    global text
    count=text.count(old)
    if count!=1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text=text.replace(old,new)

replace_once('collector rewrite allowlist',
    '  r5-collector-runs-retention-preflight.yml\n  r5-cron-history-retention.yml\n',
    '  r5-collector-runs-retention-preflight.yml\n  r5-collector-runs-retention-rewrite.yml\n  r5-cron-history-retention.yml\n')
replace_once('collector rewrite workflow count',
    'GitHub Actions workflow count must remain exactly thirty-seven while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-eight while R4F qualification and the guarded R5 workflows are active.')
replace_once('collector rewrite symbol',
    'r5_collector_runs_retention_preflight = "r5-collector-runs-retention-preflight.yml"',
    'r5_collector_runs_retention_preflight = "r5-collector-runs-retention-preflight.yml"\nr5_collector_runs_retention_rewrite = "r5-collector-runs-retention-rewrite.yml"')
replace_once('collector rewrite trigger',
    '    r5_collector_runs_retention_preflight: ["issue_comment"],',
    '    r5_collector_runs_retention_preflight: ["issue_comment"],\n    r5_collector_runs_retention_rewrite: ["issue_comment"],')

marker='burst = (root / r5_burst).read_text()\n'
if text.count(marker)!=1:
    raise SystemExit('collector rewrite insertion point is not unique')
block=r'''collector_runs_retention_rewrite = (root / r5_collector_runs_retention_rewrite).read_text()
collector_runs_retention_manager = (root / "../../scripts/manage-r5-collector-runs-retention-rewrite.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-collector-runs-retention-rewrite-prepare'",
    "startsWith(github.event.comment.body, '/r5-collector-runs-retention-rewrite-authorize ')",
    "scripts/manage-r5-collector-runs-retention-rewrite.mjs",
    "retentionMutationAuthorized",
    "physicalRewriteAuthorized",
    "sequenceMutationAuthorized",
    "r5RearmAuthorized",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded collector retention rewrite",
):
    if required not in collector_runs_retention_rewrite:
        raise SystemExit(f"collector retention rewrite workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in collector_runs_retention_rewrite:
        raise SystemExit(f"collector retention rewrite workflow contains forbidden capability: {forbidden.strip()}")
if collector_runs_retention_rewrite.count("issues: write") != 1:
    raise SystemExit("collector retention rewrite must have exactly one issue-write permission")

for required in (
    "const RETAIN_LATEST_ROWS=256",
    "const EXPECTED_MIGRATION_HEAD='20260816050000'",
    "const EXPECTED_SCHEDULER_COMMAND_SHA='98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'",
    "const MAX_DATABASE_BYTES_BEFORE=490_000_000",
    "read_only:readOnly",
    "function mutationSql(expected)",
    "assertDataStateForMutation(expected)",
    "lock table public.xrpl_collector_runs in access exclusive mode",
    "collector authorized data state drift under lock",
    "order by completed_at desc,id desc",
    "truncate table public.xrpl_collector_runs",
    "overriding system value",
    "collector retained identity mismatch after rewrite",
    "collector identity sequence drift after rewrite",
    "transactionLockRevalidation:true",
    "authorized structural state mismatch",
    "authorized data state mismatch",
    "authorized plan mismatch",
    "const exactMutation=mutationSql(before.dataState)",
    "post-rewrite structural state mismatch",
    "relation bytes were not reclaimed",
    "database bytes were not reclaimed",
    "r5RearmPerformed:false",
):
    if required not in collector_runs_retention_manager:
        raise SystemExit(f"collector retention manager missing guard: {required}")
manager_lower = collector_runs_retention_manager.lower()
for forbidden in (
    "restart identity", "truncate table public.xrpl_phase_", "delete from public.xrpl_phase_",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "mainnet_enabled",
):
    if forbidden in manager_lower:
        raise SystemExit(f"collector retention manager contains forbidden capability: {forbidden}")
if collector_runs_retention_manager.find("collector authorized data state drift under lock") > collector_runs_retention_manager.find("truncate table public.xrpl_collector_runs"):
    raise SystemExit("collector retention manager must revalidate authorized data under lock before TRUNCATE")

'''
text=text.replace(marker,block+marker)
path.write_text(text)
