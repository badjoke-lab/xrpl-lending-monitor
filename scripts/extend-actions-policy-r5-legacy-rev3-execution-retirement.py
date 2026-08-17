from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-legacy-rev3-execution-retirement.py <generated-policy>')
path = Path(sys.argv[1])
text = path.read_text()

def replace_once(name, old, new):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)

replace_once(
    'legacy rev3 retirement allowlist entry',
    '  r5-index-footprint-readonly-probe.yml\n  r5-phase-message-ready-partial-index-apply.yml\n',
    '  r5-index-footprint-readonly-probe.yml\n  r5-legacy-rev3-execution-retirement.yml\n  r5-phase-message-ready-partial-index-apply.yml\n',
)
replace_once(
    'legacy rev3 retirement workflow count',
    'GitHub Actions workflow count must remain exactly thirty-one while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-two while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'legacy rev3 retirement workflow symbol',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"',
    'r5_terminal_archive_phase_a_apply = "r5-terminal-archive-phase-a-apply.yml"\nr5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"',
)
replace_once(
    'legacy rev3 retirement trigger policy',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],',
    '    r5_terminal_archive_phase_a_apply: ["issue_comment"],\n    r5_legacy_rev3_retirement: ["issue_comment"],',
)
marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('legacy rev3 retirement policy insertion point is not unique')
block = r'''legacy_retirement = (root / r5_legacy_rev3_retirement).read_text()
legacy_retirement_manager = (root / "../../scripts/manage-r5-legacy-rev3-execution-retirement.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-legacy-rev3-execution-retirement-prepare'",
    "startsWith(github.event.comment.body, '/r5-legacy-rev3-execution-retirement-authorize ')",
    "scripts/manage-r5-legacy-rev3-execution-retirement.mjs",
    "permissionMutationPerformed",
    "transportRowMutationPerformed",
    "physicalCompactionPerformed",
    "r5RearmPerformed",
):
    if required not in legacy_retirement:
        raise SystemExit(f"legacy rev3 retirement workflow missing fail-closed requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
):
    if forbidden in legacy_retirement:
        raise SystemExit(f"legacy rev3 retirement workflow contains forbidden capability: {forbidden.strip()}")
for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "20260817074500_xrpl_r5_legacy_rev3_execution_retirement.sql",
    "xrpl_create_r5_active_checkpoint_strict",
    "xrpl_prepare_r5_active_recovery",
    "xrpl_claim_r5_active_recovery_batch",
    "xrpl_complete_r5_active_recovery_batch",
    "legacy revision-3 recovery is active",
    "target has executable caller",
    "unapplied_expected",
    "applied_consistent",
):
    if required not in legacy_retirement_manager:
        raise SystemExit(f"legacy rev3 retirement manager missing guarded contract: {required}")
manager_compact = legacy_retirement_manager.replace(" ", "")
for required in (
    "transportRowMutationPerformed:false",
    "canonicalHistoryRowMutationPerformed:false",
    "physicalCompactionPerformed:false",
    "schedulerMutationPerformed:false",
    "mainnetDisabled:true",
    "r5RearmPerformed:false",
):
    if required not in manager_compact:
        raise SystemExit(f"legacy rev3 retirement manager missing bounded result: {required}")
'''
text = text.replace(marker, block + marker)
path.write_text(text)
