from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-archive-phase-b-tranche.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal archive Phase B allowlist entry',
    '  r5-terminal-archive-phase-a-apply.yml\n  r5-work-status-partial-index-apply.yml\n',
    '  r5-terminal-archive-phase-a-apply.yml\n  r5-terminal-archive-phase-b-tranche.yml\n  r5-work-status-partial-index-apply.yml\n',
)
replace_once(
    'terminal archive Phase B workflow count',
    'GitHub Actions workflow count must remain exactly thirty-two while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-three while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal archive Phase B workflow symbol',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"\nr5_terminal_archive_phase_b_tranche = "r5-terminal-archive-phase-b-tranche.yml"',
)
replace_once(
    'terminal archive Phase B trigger policy',
    '    r5_legacy_rev3_retirement: ["issue_comment"],',
    '    r5_legacy_rev3_retirement: ["issue_comment"],\n    r5_terminal_archive_phase_b_tranche: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal archive Phase B policy insertion point is not unique')

block = r'''terminal_archive_phase_b = (root / r5_terminal_archive_phase_b_tranche).read_text()
terminal_archive_phase_b_manager = (root / "../../scripts/manage-r5-terminal-archive-phase-b-tranche.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-archive-phase-b-prepare'",
    "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-b-authorize ')",
    "scripts/manage-r5-terminal-archive-phase-b-tranche.mjs",
    "at most 250",
    "2,000,000 logical bytes",
    "legacy full-history checkpoint",
    "physical compaction, VACUUM, REINDEX",
    "canonicalWorkReferenceHistoryMutationPerformed",
    "physicalCompactionPerformed",
    "schedulerMutationPerformed",
    "r5Rearmed",
):
    if required not in terminal_archive_phase_b:
        raise SystemExit(f"terminal archive Phase B workflow missing fail-closed requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in terminal_archive_phase_b:
        raise SystemExit(f"terminal archive Phase B workflow contains forbidden capability: {forbidden.strip()}")
if terminal_archive_phase_b.count("issues: write") != 1:
    raise SystemExit("terminal archive Phase B workflow must have exactly one issue-write permission")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "const PROFILE_ID = 'supabase-devnet'",
    "const MINIMUM_AGE_HOURS = 24",
    "const TRANCHE_LIMIT = 250",
    "const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000",
    "20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql",
    "r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint",
    "terminalize_message",
    "candidateDigestSha256",
    "structuralStateSha256",
    "selectedLogicalBytes",
    "pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b', 0))",
    "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0))",
    "authorized Phase B candidate identity drifted",
    "R5 successor is not database-guard halted",
    "terminal archive private/RLS contract drifted",
    "canonical work/reference history changed during Phase B",
    "legacy full-history checkpoint was not frozen before Phase B rows moved",
):
    if required not in terminal_archive_phase_b_manager:
        raise SystemExit(f"terminal archive Phase B manager missing guarded contract: {required}")
manager_compact = terminal_archive_phase_b_manager.replace(" ", "")
for required in (
    "terminalTransportArchiveDeletePerformed:true",
    "canonicalWorkReferenceHistoryMutationPerformed:false",
    "physicalCompactionPerformed:false",
    "vacuumPerformed:false",
    "reindexPerformed:false",
    "schedulerMutationPerformed:false",
    "deploymentPerformed:false",
    "publicReaderMutationPerformed:false",
    "mainnetDisabled:true",
    "stabilizationPerformed:false",
    "soakPerformed:false",
    "r5Rearmed:false",
):
    if required not in manager_compact:
        raise SystemExit(f"terminal archive Phase B manager missing bounded result: {required}")
for forbidden in (
    "supabase functions deploy", "supabase db push", "cron.schedule", "cron.unschedule", "wrangler deploy",
):
    if forbidden in terminal_archive_phase_b_manager:
        raise SystemExit(f"terminal archive Phase B manager contains forbidden deployment capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
