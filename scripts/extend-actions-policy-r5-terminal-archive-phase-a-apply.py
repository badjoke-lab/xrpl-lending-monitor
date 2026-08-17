from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-archive-phase-a-apply.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal archive Phase A allowlist entry',
    '  r5-phase-message-ready-partial-index-apply.yml\n',
    '  r5-phase-message-ready-partial-index-apply.yml\n  r5-terminal-archive-phase-a-apply.yml\n',
)
replace_once(
    'terminal archive Phase A workflow count',
    'GitHub Actions workflow count must remain exactly thirty while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-one while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal archive Phase A workflow symbol',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"',
    'r5_phase_ready_index_apply = "r5-phase-message-ready-partial-index-apply.yml"\nr5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"',
)
replace_once(
    'terminal archive Phase A trigger policy',
    '    r5_phase_ready_index_apply: ["issue_comment"],',
    '    r5_phase_ready_index_apply: ["issue_comment"],\n    r5_terminal_archive_phase_a_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal archive Phase A policy insertion point is not unique')

block = r'''terminal_archive_phase_a = (root / r5_terminal_archive_phase_a_apply).read_text()
terminal_archive_manager = (root / "../../scripts/manage-r5-terminal-archive-production-apply.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-archive-phase-a-prepare'",
    "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-a-authorize ')",
    "scripts/manage-r5-terminal-archive-production-apply.mjs",
    "Prepare exact Phase A production pre-state read-only",
    "Exact five-file plan digest",
    "terminal transport backfill",
    "physical rewrite/compaction",
    "R5 rearm",
    "archiveRowsAfter",
    "canonicalHistoryRowMutationPerformed",
    "terminalTransportBackfillPerformed",
    "physicalCompactionPerformed",
    "schedulerMutationPerformed",
    "publicReaderMutationPerformed",
):
    if required not in terminal_archive_phase_a:
        raise SystemExit(f"terminal archive Phase A workflow missing fail-closed requirement: {required}")
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
    if forbidden in terminal_archive_phase_a:
        raise SystemExit(f"terminal archive Phase A workflow contains forbidden capability: {forbidden.strip()}")
if terminal_archive_phase_a.count("issues: write") != 1:
    raise SystemExit("terminal archive Phase A workflow must have exactly one issue-write permission")
if terminal_archive_phase_a.count("github.event.comment.body == '/r5-terminal-archive-phase-a-prepare'") != 1:
    raise SystemExit("terminal archive Phase A workflow must have one exact owner prepare gate")
if terminal_archive_phase_a.count("startsWith(github.event.comment.body, '/r5-terminal-archive-phase-a-authorize ')") != 1:
    raise SystemExit("terminal archive Phase A workflow must have one exact owner authorize gate")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const INTERNAL_DB_HALT = 400_000_000",
    "20260816183000_xrpl_phase_terminal_archive_contract.sql",
    "20260816190000_xrpl_phase_terminal_archive_window.sql",
    "20260816193000_xrpl_r5_revision4_terminal_archive_completion_patch.sql",
    "20260816200000_xrpl_phase_terminal_archive_core_compat_patch.sql",
    "20260816201000_xrpl_r5_revision4_archive_prepare_compat_patch.sql",
    "read_only: readOnly",
    "planDigestSha256",
    "structuralStateSha256",
    "R5 successor is not database-guard halted",
    "lock table public.xrpl_phase_messages in share mode;",
    "lock table public.xrpl_phase_successors in share mode;",
    "archiveSecurity.rows",
    "canonical transport/history row counts changed during Phase A",
    "R5 halted run state changed during Phase A",
    "scheduler state changed during Phase A",
    "canonicalHistoryRowMutationPerformed: false",
    "terminalTransportBackfillPerformed: false",
    "terminalTransportDeletionPerformed: false",
    "physicalCompactionPerformed: false",
    "vacuumPerformed: false",
    "schedulerMutationPerformed: false",
    "publicReaderMutationPerformed: false",
    "mainnetDisabled: true",
    "r5RearmAuthorized: false",
):
    if required not in terminal_archive_manager:
        raise SystemExit(f"terminal archive Phase A manager missing guarded contract: {required}")
for forbidden in (
    "supabase functions deploy",
    "supabase db push",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
):
    if forbidden in terminal_archive_manager:
        raise SystemExit(f"terminal archive Phase A manager contains forbidden deployment capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
