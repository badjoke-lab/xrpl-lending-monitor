from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r4f-revision4-cleanup.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'revision4 cleanup workflow allowlist entry',
    '  r4f-revision4-12-ledger-qualification.yml\n  r4f-revision4-partial-state-probe.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-revision4-12-ledger-qualification.yml\n  r4f-revision4-partial-state-probe.yml\n  r4f-revision4-residue-cleanup.yml\n  r5-bounded-recovery-burst.yml',
)
replace_once(
    'revision4 cleanup workflow count',
    'GitHub Actions workflow count must remain exactly fourteen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly fifteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'revision4 cleanup workflow symbol',
    'r4f_rev4_probe = "r4f-revision4-partial-state-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_probe = "r4f-revision4-partial-state-probe.yml"\nr4f_rev4_cleanup = "r4f-revision4-residue-cleanup.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'revision4 cleanup trigger policy',
    '    r4f_rev4_probe: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_probe: ["issue_comment"],\n    r4f_rev4_cleanup: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('revision4 cleanup policy insertion point is not unique')

block = r'''rev4_cleanup = (root / r4f_rev4_cleanup).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-revision4-residue-cleanup-prepare'",
    "startsWith(github.event.comment.body, '/r4f-revision4-residue-cleanup-authorize ')",
    "scripts/r4f-revision4-residue-cleanup.mjs",
    "scripts/test-r4f-revision4-residue-cleanup-contract.sh",
    "--expect residue",
    "--expect clean",
    "--authorized-pgstate",
    "state=([a-f0-9]{64})",
    "pgstate=([a-f0-9]{32})",
    "test $((expires_epoch - auth_epoch)) -le 7200",
    "Verify exact prior proposal and unique owner authorization",
    "Drop only the exact six authorized runtime residue functions atomically",
    "No CASCADE is used.",
    "migration-history mutation",
    "table/row mutation",
    "collector mutation",
    "Edge Function mutation",
):
    if required not in rev4_cleanup:
        raise SystemExit(f"revision-4 residue cleanup workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
    "supabase db push",
    "supabase functions deploy",
    "supabase functions delete",
    "--mode pause",
    "--mode resume",
):
    if forbidden in rev4_cleanup:
        raise SystemExit(f"revision-4 residue cleanup workflow contains forbidden capability: {forbidden.strip()}")
if rev4_cleanup.count("issues: write") != 1:
    raise SystemExit("revision-4 residue cleanup workflow must have exactly one issue-write permission")
if rev4_cleanup.count('node "$CLEANUP_SCRIPT" cleanup') != 1:
    raise SystemExit("revision-4 residue cleanup workflow must expose exactly one production cleanup call")

'''
text = text.replace(marker, block + marker)

replace_once(
    'revision4 cleanup policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, and one finite R5 recovery burst; no scheduled workflows.',
)

path.write_text(text)
