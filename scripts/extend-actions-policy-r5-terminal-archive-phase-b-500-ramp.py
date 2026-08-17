from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-archive-phase-b-500-ramp.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal archive Phase B 500-ramp allowlist entry',
    '  r5-terminal-archive-phase-b-tranche.yml\n  r5-work-status-partial-index-apply.yml\n',
    '  r5-terminal-archive-phase-b-500-ramp.yml\n  r5-terminal-archive-phase-b-tranche.yml\n  r5-work-status-partial-index-apply.yml\n',
)
replace_once(
    'terminal archive Phase B 500-ramp workflow count',
    'GitHub Actions workflow count must remain exactly thirty-three while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-four while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal archive Phase B 500-ramp workflow symbol',
    'r5_terminal_archive_phase_b_tranche = "r5-terminal-archive-phase-b-tranche.yml"',
    'r5_terminal_archive_phase_b_tranche = "r5-terminal-archive-phase-b-tranche.yml"\nr5_terminal_archive_phase_b_500_ramp = "r5-terminal-archive-phase-b-500-ramp.yml"',
)
replace_once(
    'terminal archive Phase B 500-ramp trigger policy',
    '    r5_terminal_archive_phase_b_tranche: ["issue_comment"],',
    '    r5_terminal_archive_phase_b_tranche: ["issue_comment"],\n    r5_terminal_archive_phase_b_500_ramp: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal archive Phase B 500-ramp policy insertion point is not unique')

block = r'''terminal_archive_phase_b_500 = (root / r5_terminal_archive_phase_b_500_ramp).read_text()
terminal_archive_phase_b_500_runner = (root / "../../scripts/run-r5-terminal-archive-phase-b-500-ramp.mjs").read_text()
terminal_archive_phase_b_base_manager = (root / "../../scripts/manage-r5-terminal-archive-phase-b-tranche.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "concurrency:\n  group: r5-terminal-archive-phase-b-tranche",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-terminal-archive-phase-b-500-prepare'",
    "startsWith(github.event.comment.body, '/r5-terminal-archive-phase-b-500-authorize ')",
    "scripts/run-r5-terminal-archive-phase-b-500-ramp.mjs",
    "at most 500",
    "2,000,000 logical bytes",
    "180-second database statement timeout",
    "physical compaction, VACUUM, REINDEX",
    "canonicalWorkReferenceHistoryMutationPerformed",
    "physicalCompactionPerformed",
    "schedulerMutationPerformed",
    "r5Rearmed",
):
    if required not in terminal_archive_phase_b_500:
        raise SystemExit(f"terminal archive Phase B 500-ramp workflow missing fail-closed requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in terminal_archive_phase_b_500:
        raise SystemExit(f"terminal archive Phase B 500-ramp workflow contains forbidden capability: {forbidden.strip()}")
if terminal_archive_phase_b_500.count("issues: write") != 1:
    raise SystemExit("terminal archive Phase B 500-ramp workflow must have exactly one issue-write permission")

for required in (
    "const BASE_MANAGER = 'scripts/manage-r5-terminal-archive-phase-b-tranche.mjs'",
    "const EXPECTED_BASE_SHA256 = '03d1af2aff0546a5c348e5847d19e2449d421fe25650b9ad52a588e2acd87b43'",
    "const SOURCE_MARKER = 'const TRANCHE_LIMIT = 250'",
    "const RAMP_MARKER = 'const TRANCHE_LIMIT = 500'",
    "const BYTE_LIMIT_MARKER = 'const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000'",
    "source.split(SOURCE_MARKER).length !== 2",
    "source.replace(SOURCE_MARKER, RAMP_MARKER)",
    "spawnSync(process.execPath",
    "await rm(generated, { force: true })",
):
    if required not in terminal_archive_phase_b_500_runner:
        raise SystemExit(f"terminal archive Phase B 500-ramp runner missing exact transform guard: {required}")
if terminal_archive_phase_b_500_runner.count("source.replace(SOURCE_MARKER, RAMP_MARKER)") != 1:
    raise SystemExit("terminal archive Phase B 500-ramp runner must perform exactly one row-limit transform")
base_sha = __import__('hashlib').sha256(terminal_archive_phase_b_base_manager.encode()).hexdigest()
if base_sha != '03d1af2aff0546a5c348e5847d19e2449d421fe25650b9ad52a588e2acd87b43':
    raise SystemExit(f"terminal archive Phase B base manager SHA drifted: {base_sha}")
for required in (
    "const TRANCHE_LIMIT = 250",
    "const TRANCHE_LOGICAL_BYTE_LIMIT = 2_000_000",
    "set local statement_timeout = '180s'",
    "pg_advisory_xact_lock(hashtextextended('xrpl-terminal-archive-phase-b', 0))",
    "authorized Phase B candidate identity drifted",
    "canonical work/reference history changed during Phase B",
):
    if required not in terminal_archive_phase_b_base_manager:
        raise SystemExit(f"terminal archive Phase B base manager missing retained safety guard: {required}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
