from pathlib import Path
import subprocess
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-phase-ready-index-physical-reindex.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'ready physical-reindex workflow allowlist entry',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-raw-evidence-compaction.yml',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-phase-ready-index-physical-reindex.yml\n  r5-raw-evidence-compaction.yml',
)
replace_once(
    'successor physical-reindex workflow allowlist entry',
    '  r5-revision4-resource-halt-rearm.yml\n  r5-terminal-archive-phase-a-apply.yml',
    '  r5-revision4-resource-halt-rearm.yml\n  r5-successor-constraint-index-physical-reindex.yml\n  r5-terminal-archive-phase-a-apply.yml',
)
replace_once(
    'ready and successor physical-reindex workflow count',
    'GitHub Actions workflow count must remain exactly thirty-eight while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'ready and successor physical-reindex workflow symbols',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_phase_ready_index_physical_reindex = "r5-phase-ready-index-physical-reindex.yml"\nr5_successor_constraint_index_physical_reindex = "r5-successor-constraint-index-physical-reindex.yml"',
)
replace_once(
    'ready and successor physical-reindex trigger policies',
    '    r5_phase_ready_index_apply: ["issue_comment"],',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_phase_ready_index_physical_reindex: ["issue_comment"],\n    r5_successor_constraint_index_physical_reindex: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('ready/successor physical-reindex policy insertion point is not unique')

block = r'''phase_ready_physical_reindex = (root / r5_phase_ready_index_physical_reindex).read_text()
phase_ready_physical_reindex_manager = (root / "../../scripts/manage-r5-phase-ready-index-physical-reindex.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-phase-ready-index-reindex-prepare'",
    "startsWith(github.event.comment.body, '/r5-phase-ready-index-reindex-authorize ')",
    "scripts/manage-r5-phase-ready-index-physical-reindex.mjs",
    "rowMutationAuthorized",
    "vacuumAuthorized",
    "schedulerMutationAuthorized",
    "mainnetDisabled",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded ready-index physical reindex",
):
    if required not in phase_ready_physical_reindex:
        raise SystemExit(f"ready physical-reindex workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in phase_ready_physical_reindex:
        raise SystemExit(f"ready physical-reindex workflow contains forbidden capability: {forbidden.strip()}")
if phase_ready_physical_reindex.count("issues: write") != 1:
    raise SystemExit("ready physical-reindex workflow must have exactly one issue-write permission")

for required in (
    "const INDEX = 'public.xrpl_phase_messages_ready_idx'",
    "const TABLE = 'public.xrpl_phase_messages'",
    "const EXPECTED_MIGRATION_HEAD = '20260816050000'",
    "const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'",
    "const MAX_DATABASE_BYTES_BEFORE = 480_000_000",
    "const MAX_INDEX_BYTES_BEFORE = 8_000_000",
    "const MAX_READY_ROWS = 100",
    "function mutationSql(expected)",
    "lock table public.xrpl_phase_messages in share mode",
    "ready index authorized data drift under lock",
    "ready index reindex safety ceiling exceeded under lock",
    "reindex index public.xrpl_phase_messages_ready_idx",
    "authorized structural state mismatch",
    "authorized data state mismatch",
    "authorized plan mismatch",
    "authorized mutation mismatch",
    "post-reindex phase-message row state mismatch",
    "post-reindex table heap bytes changed",
    "ready index bytes were not reclaimed",
    "database bytes were not reclaimed",
    "rowMutationPerformed: false",
    "vacuumPerformed: false",
    "schedulerMutationPerformed: false",
    "r5RearmPerformed: false",
):
    if required not in phase_ready_physical_reindex_manager:
        raise SystemExit(f"ready physical-reindex manager missing guard: {required}")
manager_lower = phase_ready_physical_reindex_manager.lower()
for forbidden in (
    "delete from public", "truncate table", "update public", "insert into public",
    "vacuum ", "cluster ", "cron.schedule", "cron.unschedule", "wrangler deploy",
):
    if forbidden in manager_lower:
        raise SystemExit(f"ready physical-reindex manager contains forbidden capability: {forbidden}")
if phase_ready_physical_reindex_manager.count("reindex index public.xrpl_phase_messages_ready_idx;") != 1:
    raise SystemExit("ready physical-reindex manager must contain exactly one executable REINDEX statement")
if phase_ready_physical_reindex_manager.find("ready index authorized data drift under lock") > phase_ready_physical_reindex_manager.find("reindex index public.xrpl_phase_messages_ready_idx;"):
    raise SystemExit("ready physical-reindex manager must revalidate authorized data under lock before REINDEX")

successor_physical_reindex = (root / r5_successor_constraint_index_physical_reindex).read_text()
successor_physical_reindex_manager = (root / "../../scripts/manage-r5-successor-constraint-index-physical-reindex.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "/r5-successor-index-reindex-prepare target=pkey",
    "/r5-successor-index-reindex-prepare target=successor_unique",
    "startsWith(github.event.comment.body, '/r5-successor-index-reindex-authorize ')",
    "scripts/manage-r5-successor-constraint-index-physical-reindex.mjs",
    "Verify exact prior proposal and unique owner authorization",
    "Revalidate exact authorized state read-only",
    "Apply exact bounded single successor-index physical reindex",
    "Independent post-commit read-only verify",
    "rowMutationAuthorized",
    "vacuumAuthorized",
    "schedulerMutationAuthorized",
    "mainnetDisabled",
):
    if required not in successor_physical_reindex:
        raise SystemExit(f"successor physical-reindex workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in successor_physical_reindex:
        raise SystemExit(f"successor physical-reindex workflow contains forbidden capability: {forbidden.strip()}")
if successor_physical_reindex.count("issues: write") != 1:
    raise SystemExit("successor physical-reindex workflow must have exactly one issue-write permission")

for required in (
    "const TABLE = 'public.xrpl_phase_successors'",
    "const EXPECTED_MIGRATION_HEAD = '20260816050000'",
    "const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'",
    "const MAX_DATABASE_BYTES_BEFORE = 474_000_000",
    "const LOCAL_COMPACT_BUILD_BYTES = 14_336_000",
    "const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000",
    "const MAX_CONSERVATIVE_PEAK_BYTES = 490_000_000",
    "public.xrpl_phase_successors_pkey",
    "public.xrpl_phase_successors_successor_message_id_key",
    "lock table public.xrpl_phase_successors in share mode",
    "successor index authorized data drift under lock",
    "successor constraint state drift under lock",
    "successor index reindex safety ceiling exceeded under lock",
    "authorized structural state mismatch",
    "authorized data state mismatch",
    "authorized plan mismatch",
    "authorized mutation mismatch",
    "post-reindex successor row/constraint state mismatch",
    "post-reindex peer index changed",
    "target successor index bytes were not reclaimed",
    "independent verify structural state mismatch",
    "productionReadOnly:true",
    "rowMutationPerformed:false",
    "vacuumPerformed:false",
    "schedulerMutationPerformed:false",
    "r5RearmPerformed:false",
):
    if required not in successor_physical_reindex_manager:
        raise SystemExit(f"successor physical-reindex manager missing guard: {required}")
manager_lower = successor_physical_reindex_manager.lower()
for forbidden in (
    "delete from public", "truncate table", "update public", "insert into public",
    "vacuum ", "cluster ", "cron.schedule", "cron.unschedule", "wrangler deploy",
):
    if forbidden in manager_lower:
        raise SystemExit(f"successor physical-reindex manager contains forbidden capability: {forbidden}")
if successor_physical_reindex_manager.count("reindex index public.xrpl_phase_successors_pkey;") != 1:
    raise SystemExit("successor physical-reindex manager must expose one exact pkey REINDEX")
if successor_physical_reindex_manager.count("reindex index public.xrpl_phase_successors_successor_message_id_key;") != 1:
    raise SystemExit("successor physical-reindex manager must expose one exact unique REINDEX")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
subprocess.run([sys.executable, 'scripts/extend-actions-policy-r5-phase-message-pkey-physical-reindex.py', sys.argv[1]], check=True)
