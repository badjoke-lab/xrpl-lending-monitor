from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-checkpoint-archive-fail-close-apply.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'checkpoint fail-close allowlist entry',
    '  r5-bounded-recovery-burst.yml\n  r5-cron-history-retention.yml\n',
    '  r5-bounded-recovery-burst.yml\n  r5-checkpoint-archive-fail-close-apply.yml\n  r5-cron-history-retention.yml\n',
)
replace_once(
    'checkpoint fail-close workflow count',
    'GitHub Actions workflow count must remain exactly thirty-two while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirty-three while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'checkpoint fail-close workflow symbol',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"',
    'r5_legacy_rev3_retirement = "r5-legacy-rev3-execution-retirement.yml"\nr5_checkpoint_archive_fail_close_apply = "r5-checkpoint-archive-fail-close-apply.yml"',
)
replace_once(
    'checkpoint fail-close trigger policy',
    '    r5_legacy_rev3_retirement: ["issue_comment"],',
    '    r5_legacy_rev3_retirement: ["issue_comment"],\n    r5_checkpoint_archive_fail_close_apply: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('checkpoint fail-close policy insertion point is not unique')

block = r'''checkpoint_archive_fail_close = (root / r5_checkpoint_archive_fail_close_apply).read_text()
checkpoint_archive_fail_close_manager = (root / "../../scripts/manage-r5-checkpoint-archive-fail-close-apply.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-checkpoint-archive-fail-close-prepare'",
    "startsWith(github.event.comment.body, '/r5-checkpoint-archive-fail-close-authorize ')",
    "scripts/manage-r5-checkpoint-archive-fail-close-apply.mjs",
    "archiveRows",
    "functionDefinitionMutationPerformed",
    "terminalTransportMutationPerformed",
    "physicalCompactionPerformed",
    "r5RearmPerformed",
):
    if required not in checkpoint_archive_fail_close:
        raise SystemExit(f"checkpoint archive fail-close workflow missing fail-closed requirement: {required}")
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
    if forbidden in checkpoint_archive_fail_close:
        raise SystemExit(f"checkpoint archive fail-close workflow contains forbidden capability: {forbidden.strip()}")
if checkpoint_archive_fail_close.count("github.event.comment.body == '/r5-checkpoint-archive-fail-close-prepare'") != 1:
    raise SystemExit("checkpoint archive fail-close workflow must have one exact owner prepare gate")
if checkpoint_archive_fail_close.count("startsWith(github.event.comment.body, '/r5-checkpoint-archive-fail-close-authorize ')") != 1:
    raise SystemExit("checkpoint archive fail-close workflow must have one exact owner authorize gate")

for required in (
    "const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'",
    "20260817110500_xrpl_r5_checkpoint_terminal_archive_fail_close.sql",
    "bc135435e0d729526aff6940c96b3ef78530b4612586f82ef73a7b99e145da10",
    "d17d392292b4ca38c9b1f85fb0d8f2bebe3cd6db978ca42a70cfd3bc3deb133c",
    "e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733",
    "r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint",
    "checkpoint fail-close must be installed before the first terminal archive row",
    "R5 successor is not database-guard halted",
    "legacy revision-3 recovery entry point is not retired",
    "authorized checkpoint fail-close structural state drifted before mutation",
    "postVerificationReadOnly: true",
):
    if required not in checkpoint_archive_fail_close_manager:
        raise SystemExit(f"checkpoint archive fail-close manager missing guarded contract: {required}")
manager_compact = checkpoint_archive_fail_close_manager.replace(" ", "")
for required in (
    "functionDefinitionMutationPerformed:true",
    "terminalTransportMutationPerformed:false",
    "canonicalHistoryRowMutationPerformed:false",
    "physicalCompactionPerformed:false",
    "vacuumPerformed:false",
    "schedulerMutationPerformed:false",
    "deploymentPerformed:false",
    "publicReaderMutationPerformed:false",
    "mainnetDisabled:true",
    "r5RearmPerformed:false",
):
    if required not in manager_compact:
        raise SystemExit(f"checkpoint archive fail-close manager missing bounded result: {required}")
for forbidden in (
    "supabase functions deploy",
    "supabase db push",
    "cron.schedule",
    "cron.unschedule",
    "wrangler deploy",
):
    if forbidden in checkpoint_archive_fail_close_manager:
        raise SystemExit(f"checkpoint archive fail-close manager contains forbidden deployment capability: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
