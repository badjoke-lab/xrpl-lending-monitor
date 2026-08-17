from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-archive-phase-b-preflight.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'Phase B preflight allowlist entry',
    '  r5-terminal-archive-phase-a-apply.yml\n  r5-work-status-partial-index-apply.yml\n',
    '  r5-terminal-archive-phase-a-apply.yml\n  r5-terminal-archive-phase-b-preflight.yml\n  r5-work-status-partial-index-apply.yml\n',
)
replace_once(
    'Phase B preflight workflow count',
    'GitHub Actions workflow count must remain exactly thirty-one while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-two while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'Phase B preflight workflow symbol',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"\nr5_terminal_archive_phase_b_preflight = "r5-terminal-archive-phase-b-preflight.yml"',
)
replace_once(
    'Phase B preflight trigger policy',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],\n    r5_terminal_archive_phase_b_preflight: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('Phase B preflight policy insertion point is not unique')

block = r'''terminal_archive_phase_b = (root / r5_terminal_archive_phase_b_preflight).read_text()
terminal_archive_phase_b_manager = (root / "../../scripts/manage-r5-terminal-archive-phase-b-preflight.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-archive-phase-b-preflight'",
    "Inspect Phase B preconditions read-only",
    "readyForLegacyRetirement",
    "readyForPhaseBDataMutation",
    "No terminal transport mutation",
    "R5 rearm",
):
    if required not in terminal_archive_phase_b:
        raise SystemExit(f"terminal archive Phase B workflow missing fail-closed requirement: {required}")
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
):
    if forbidden in terminal_archive_phase_b:
        raise SystemExit(f"terminal archive Phase B workflow contains forbidden capability: {forbidden.strip()}")
if terminal_archive_phase_b.count("github.event.comment.body == '/r5-terminal-archive-phase-b-preflight'") != 1:
    raise SystemExit("terminal archive Phase B workflow must have one exact owner preflight gate")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const INTERNAL_DB_HALT = 400_000_000",
    "read_only: true",
    "xrpl_phase_archive_v1.terminal_messages",
    "retainedToEligible",
    "eligibleToRetained",
    "currentR5ArchiveCompatible",
    "legacyRetirementRequired",
    "readyForLegacyRetirement",
    "readyForPhaseBDataMutation",
    "productionDatabaseReadOnly: true",
    "terminalTransportMutationAuthorized: false",
    "legacyConsumerRetirementAuthorized: false",
    "physicalCompactionAuthorized: false",
    "schedulerMutationAuthorized: false",
    "publicReaderMutationAuthorized: false",
    "mainnetDisabled: true",
    "r5RearmAuthorized: false",
):
    if required not in terminal_archive_phase_b_manager:
        raise SystemExit(f"terminal archive Phase B manager missing guarded contract: {required}")
for forbidden in (
    "read_only: false",
    "delete from public.xrpl_phase_messages",
    "delete from public.xrpl_phase_successors",
    "truncate",
    "vacuum",
    "reindex",
    "supabase functions deploy",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
):
    if forbidden in terminal_archive_phase_b_manager.lower():
        raise SystemExit(f"terminal archive Phase B manager contains forbidden mutation capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
