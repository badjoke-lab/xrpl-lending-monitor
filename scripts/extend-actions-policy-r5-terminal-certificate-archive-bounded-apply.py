from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-terminal-certificate-archive-bounded-apply.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'terminal certificate bounded apply workflow allowlist entry',
    '  r5-terminal-archive-phase-a-apply.yml',
    '  r5-terminal-archive-phase-a-apply.yml\n  r5-terminal-certificate-archive-bounded-apply.yml',
)
replace_once(
    'terminal certificate bounded apply workflow count',
    'GitHub Actions workflow count must remain exactly forty-three while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty-four while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'terminal certificate bounded apply workflow symbol',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"\nr5_terminal_certificate_archive_bounded_apply = "r5-terminal-certificate-archive-bounded-apply.yml"',
)
replace_once(
    'terminal certificate bounded apply trigger policy',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],\n    r5_terminal_certificate_archive_bounded_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('terminal certificate bounded apply policy insertion point is not unique')

block = r'''terminal_certificate_bounded_apply = (root / r5_terminal_certificate_archive_bounded_apply).read_text()
terminal_certificate_bounded_manager = (root / "../../scripts/manage-r5-terminal-certificate-archive-bounded-apply.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "startsWith(github.event.comment.body, '/r5-terminal-certificate-archive-authorize ')",
    "20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json",
    "Verify successful prepare provenance and unique OWNER command",
    "Revalidate stable safety guard read-only",
    "Apply exact atomic bundle once",
    "Independent post-apply read-only verify",
    "scripts/manage-r5-terminal-certificate-archive-bounded-apply.mjs",
    "scripts/r5-terminal-certificate-archive-readonly-verify.mjs",
    "wallClockExpiryRequired",
    "volatileMeasurementDriftInvalidatesAuthorization",
    "r5RearmAuthorized",
    "mainnetEnabled",
):
    if required not in terminal_certificate_bounded_apply:
        raise SystemExit(f"terminal certificate bounded apply workflow missing requirement: {required}")
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
    "expires=",
):
    if forbidden in terminal_certificate_bounded_apply:
        raise SystemExit(f"terminal certificate bounded apply workflow contains forbidden capability: {forbidden.strip()}")
if terminal_certificate_bounded_apply.count("issues: write") != 1:
    raise SystemExit("terminal certificate bounded apply workflow must have exactly one issue-write permission")
if terminal_certificate_bounded_apply.count("startsWith(github.event.comment.body, '/r5-terminal-certificate-archive-authorize ')") != 1:
    raise SystemExit("terminal certificate bounded apply workflow must have one owner authorization event gate")

for required in (
    "20260824031500_xrpl_terminal_certificate_archive_stable_safety_guard.json",
    "20260823053000_xrpl_terminal_certificate_archive_atomic_manifest.json",
    "r5-terminal-scan-sequence-readonly-audit.mjs",
    "managementQuery(functionInspectionSql(), true)",
    "authorization !== result.guard.command",
    "stable safety preflight failed",
    "managementQuery(result.bundle, false)",
    "certificateColumns.absent",
    "duplicateCompletion.sourceSha256",
    "scan.productiveMappingDigest",
    "scan.activeSequences",
    "volatileEvidence",
    "singleTransactionBundle: true",
    "schedulerMutationAuthorized: false",
    "publicReaderMutationAuthorized: false",
    "archiveDeleteOrStopAuthorized: false",
    "r5RearmAuthorized: false",
    "mainnetEnabled: false",
):
    if required not in terminal_certificate_bounded_manager:
        raise SystemExit(f"terminal certificate bounded apply manager missing guard: {required}")
for forbidden in (
    "supabase functions deploy",
    "supabase db push",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
    "expires=",
):
    if forbidden in terminal_certificate_bounded_manager:
        raise SystemExit(f"terminal certificate bounded apply manager contains forbidden capability: {forbidden}")
if terminal_certificate_bounded_manager.count("managementQuery(result.bundle, false)") != 1:
    raise SystemExit("terminal certificate bounded apply manager must expose exactly one production mutation request")
if terminal_certificate_bounded_manager.find("authorization !== result.guard.command") > terminal_certificate_bounded_manager.find("managementQuery(result.bundle, false)"):
    raise SystemExit("exact OWNER command must be checked before production mutation")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
