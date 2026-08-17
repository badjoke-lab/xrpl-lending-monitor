from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-transport-compaction-preflight.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal transport compaction preflight allowlist entry',
    '  r5-terminal-archive-phase-b-tranche.yml\n  r5-work-status-partial-index-apply.yml\n',
    '  r5-terminal-archive-phase-b-tranche.yml\n  r5-terminal-transport-compaction-preflight.yml\n  r5-work-status-partial-index-apply.yml\n',
)
replace_once(
    'terminal transport compaction preflight workflow count',
    'GitHub Actions workflow count must remain exactly thirty-four while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-five while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal transport compaction preflight workflow symbol',
    'r5_terminal_archive_phase_b_500_ramp = "r5-terminal-archive-phase-b-500-ramp.yml"',
    'r5_terminal_archive_phase_b_500_ramp = "r5-terminal-archive-phase-b-500-ramp.yml"\nr5_terminal_transport_compaction_preflight = "r5-terminal-transport-compaction-preflight.yml"',
)
replace_once(
    'terminal transport compaction preflight trigger policy',
    '    r5_terminal_archive_phase_b_500_ramp: ["issue_comment"],',
    '    r5_terminal_archive_phase_b_500_ramp: ["issue_comment"],\n    r5_terminal_transport_compaction_preflight: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal transport compaction preflight insertion point is not unique')

block = r'''terminal_transport_compaction_preflight = (root / r5_terminal_transport_compaction_preflight).read_text()
terminal_transport_compaction_probe = (root / "../../scripts/r5-terminal-transport-compaction-readonly-preflight.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-transport-compaction-preflight'",
    "scripts/r5-terminal-transport-compaction-readonly-preflight.mjs",
    "Management API \\`read_only:true\\` SELECT only",
    "physicalCompactionAuthorized",
    "vacuumAuthorized",
    "reindexAuthorized",
    "clusterAuthorized",
    "r5RearmAuthorized",
):
    if required not in terminal_transport_compaction_preflight:
        raise SystemExit(f"terminal transport compaction preflight workflow missing read-only requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
    "- name: Apply", "- name: Execute", "startsWith(github.event.comment.body",
):
    if forbidden in terminal_transport_compaction_preflight:
        raise SystemExit(f"terminal transport compaction preflight workflow contains forbidden capability: {forbidden.strip()}")
if terminal_transport_compaction_preflight.count("issues: write") != 1:
    raise SystemExit("terminal transport compaction preflight must have exactly one issue-write permission")
for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const MIN_ARCHIVE_ROWS = 1500",
    "public.xrpl_phase_messages",
    "public.xrpl_phase_successors",
    "inboundForeignKeys",
    "userTriggers",
    "dependentViews",
    "n_dead_tup",
    "r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint",
    "read_only: true",
    "physicalCompactionAuthorized',false",
    "vacuumAuthorized',false",
    "reindexAuthorized',false",
    "clusterAuthorized',false",
    "r5RearmAuthorized',false",
):
    if required not in terminal_transport_compaction_probe:
        raise SystemExit(f"terminal transport compaction probe missing read-only guard: {required}")
for forbidden in (
    "read_only: false", "managementQuery(MUTATION", "truncate table", "vacuum full",
    "reindex table", "cluster public.", "delete from public.", "update public.",
):
    if forbidden in terminal_transport_compaction_probe.lower():
        raise SystemExit(f"terminal transport compaction probe contains mutation capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
