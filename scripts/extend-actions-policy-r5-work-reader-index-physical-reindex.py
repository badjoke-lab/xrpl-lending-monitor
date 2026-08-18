from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-work-reader-index-physical-reindex.py <generated-policy>')
path=Path(sys.argv[1]); text=path.read_text()

def replace_once(name,old,new):
    global text
    count=text.count(old)
    if count!=1: raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text=text.replace(old,new)

replace_once(
    'work reader workflow allowlist entry',
    '  r5-work-status-partial-index-apply.yml',
    '  r5-work-reader-index-physical-reindex.yml\n  r5-work-status-partial-index-apply.yml',
)
replace_once(
    'work reader workflow count',
    'GitHub Actions workflow count must remain exactly forty-one while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty-two while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'work reader workflow symbol',
    'r5_work_status_index_apply = "r5-work-status-partial-index-apply.yml"',
    'r5_work_reader_index_physical_reindex = "r5-work-reader-index-physical-reindex.yml"\nr5_work_status_index_apply = "r5-work-status-partial-index-apply.yml"',
)
replace_once(
    'work reader workflow trigger policy',
    '    r5_work_status_index_apply: ["issue_comment"],',
    '    r5_work_reader_index_physical_reindex: ["issue_comment"],\n    r5_work_status_index_apply: ["issue_comment"],',
)
marker='burst = (root / r5_burst).read_text()\n'
if text.count(marker)!=1: raise SystemExit('work reader policy insertion point is not unique')
block=r'''work_reader_reindex = (root / r5_work_reader_index_physical_reindex).read_text()
work_reader_manager = (root / "../../scripts/manage-r5-work-reader-index-physical-reindex.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-work-reader-index-reindex-prepare'",
    "startsWith(github.event.comment.body, '/r5-work-reader-index-reindex-authorize ')",
    "scripts/manage-r5-work-reader-index-physical-reindex.mjs",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded work reader-index physical reindex",
    "Independent post-commit read-only verify",
    "rowMutationAuthorized",
    "vacuumAuthorized",
    "schedulerMutationAuthorized",
    "mainnetDisabled",
):
    if required not in work_reader_reindex:
        raise SystemExit(f"work reader workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in work_reader_reindex:
        raise SystemExit(f"work reader workflow contains forbidden capability: {forbidden.strip()}")
if work_reader_reindex.count("issues: write") != 1:
    raise SystemExit("work reader workflow must have exactly one issue-write permission")
for required in (
    "const TABLE = 'public.xrpl_phase_work'",
    "const TARGET = 'public.xrpl_phase_work_committed_reader_idx'",
    "const EXPECTED_MIGRATION_HEAD = '20260816050000'",
    "const MAX_DATABASE_BYTES_BEFORE = 420_000_000",
    "const MIN_TARGET_BYTES_BEFORE = 12_000_000",
    "const MAX_TARGET_BYTES_BEFORE = 18_000_000",
    "const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 12_000_000",
    "const MAX_CONSERVATIVE_PEAK_BYTES = 435_000_000",
    "lock table public.xrpl_phase_work in share mode",
    "work reader authorized data drift under lock",
    "work constraint state drift under lock",
    "work reader reindex safety ceiling exceeded under lock",
    "reindex index public.xrpl_phase_work_committed_reader_idx",
    "authorized structural state mismatch",
    "authorized data state mismatch",
    "authorized plan mismatch",
    "authorized mutation mismatch",
    "post-reindex work row/constraint state mismatch",
    "post-reindex work pkey changed",
    "post-reindex work identity unique changed",
    "post-reindex work status index changed",
    "work reader index bytes increased",
    "independent verify structural state mismatch",
    "productionReadOnly: true",
    "rowMutationPerformed: false",
    "vacuumPerformed: false",
    "schedulerMutationPerformed: false",
    "r5RearmPerformed: false",
):
    if required not in work_reader_manager:
        raise SystemExit(f"work reader manager missing guard: {required}")
lower=work_reader_manager.lower()
for forbidden in (
    "delete from public", "truncate table", "update public", "insert into public",
    "vacuum ", "cluster ", "cron.schedule", "cron.unschedule", "wrangler deploy",
):
    if forbidden in lower:
        raise SystemExit(f"work reader manager contains forbidden capability: {forbidden}")
if work_reader_manager.count("reindex index public.xrpl_phase_work_committed_reader_idx;") != 1:
    raise SystemExit("work reader manager must contain exactly one reader REINDEX")
'''
text=text.replace(marker,block+marker)
path.write_text(text)
subprocess.run([sys.executable,'scripts/extend-actions-policy-r5-reference-pkey-physical-reindex.py',sys.argv[1]],check=True)
