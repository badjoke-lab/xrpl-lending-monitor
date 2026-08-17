from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-archive-v2-preflight.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal archive v2 preflight allowlist entry',
    '  r5-terminal-archive-phase-b-tranche.yml\n  r5-terminal-transport-compaction-preflight.yml\n',
    '  r5-terminal-archive-phase-b-tranche.yml\n  r5-terminal-archive-v2-preflight.yml\n  r5-terminal-transport-compaction-preflight.yml\n',
)
replace_once(
    'terminal archive v2 preflight workflow count',
    'GitHub Actions workflow count must remain exactly thirty-five while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-six while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal archive v2 preflight workflow symbol',
    'r5_terminal_transport_compaction_preflight = "r5-terminal-transport-compaction-preflight.yml"',
    'r5_terminal_transport_compaction_preflight = "r5-terminal-transport-compaction-preflight.yml"\nr5_terminal_archive_v2_preflight = "r5-terminal-archive-v2-preflight.yml"',
)
replace_once(
    'terminal archive v2 preflight trigger policy',
    '    r5_terminal_transport_compaction_preflight: ["issue_comment"],',
    '    r5_terminal_transport_compaction_preflight: ["issue_comment"],\n    r5_terminal_archive_v2_preflight: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal archive v2 preflight insertion point is not unique')

block = r'''terminal_archive_v2_preflight = (root / r5_terminal_archive_v2_preflight).read_text()
terminal_archive_v2_probe = (root / "../../scripts/r5-terminal-archive-v2-readonly-preflight.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-archive-v2-preflight'",
    "scripts/r5-terminal-archive-v2-readonly-preflight.mjs",
    "schemaMutationAuthorized",
    "archiveRewriteAuthorized",
    "phaseBMovementAuthorized",
    "physicalCompactionAuthorized",
    "r5RearmAuthorized",
):
    if required not in terminal_archive_v2_preflight:
        raise SystemExit(f"terminal archive v2 preflight workflow missing read-only requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
    "- name: Apply", "- name: Execute", "startsWith(github.event.comment.body",
):
    if forbidden in terminal_archive_v2_preflight:
        raise SystemExit(f"terminal archive v2 preflight workflow contains forbidden capability: {forbidden.strip()}")
if terminal_archive_v2_preflight.count("issues: write") != 1:
    raise SystemExit("terminal archive v2 preflight must have exactly one issue-write permission")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const MIN_ARCHIVE_ROWS = 1500",
    "xrpl_phase_archive_v1.terminal_messages",
    "missing_work_id_rows",
    "payload_column_bytes",
    "archive_consumers",
    "mentions_archived_payload",
    "reads_payload_work_id",
    "read_only: true",
    "schemaMutationAuthorized',false",
    "archiveRewriteAuthorized',false",
    "phaseBMovementAuthorized',false",
    "physicalCompactionAuthorized',false",
    "r5RearmAuthorized',false",
):
    if required not in terminal_archive_v2_probe:
        raise SystemExit(f"terminal archive v2 preflight probe missing read-only guard: {required}")
for forbidden in (
    "read_only: false", "truncate table", "vacuum full", "reindex index",
    "delete from public.", "update public.", "insert into public.",
):
    if forbidden in terminal_archive_v2_probe.lower():
        raise SystemExit(f"terminal archive v2 preflight probe contains mutation capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
