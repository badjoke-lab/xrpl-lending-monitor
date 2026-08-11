from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r4f-revision4-proof.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'revision4 proof workflow allowlist entry',
    '  r4f-g3-one-shot-probe.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-g3-one-shot-probe.yml\n  r4f-revision4-12-ledger-qualification.yml\n  r5-bounded-recovery-burst.yml',
)
replace_once(
    'revision4 proof workflow count',
    'GitHub Actions workflow count must remain exactly twelve while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly thirteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'revision4 proof workflow symbol',
    'g3_dual = "r4f-g3-dual-provider-verdict.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'g3_dual = "r4f-g3-dual-provider-verdict.yml"\nr4f_rev4_proof = "r4f-revision4-12-ledger-qualification.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'revision4 proof trigger policy',
    '    g3_dual: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    g3_dual: ["issue_comment"],\n    r4f_rev4_proof: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('revision4 proof policy insertion point is not unique')
block = r'''rev4_proof = (root / r4f_rev4_proof).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-revision4-12-ledger-prepare'",
    "startsWith(github.event.comment.body, '/r4f-revision4-12-ledger-authorize ')",
    "RUNTIME_VERSION: '20260809151000'",
    "EGRESS_VERSION: '20260810123000'",
    "EVIDENCE_VERSION: '20260810133000'",
    "PROOF_FUNCTION: 'xrpl-r4f-revision4-proof-batch'",
    "ACTIVE_FUNCTION: 'xrpl-r5-recovery-batch'",
    "MAX_LEDGER_COUNT: '12'",
    "MAX_PER_LEDGER_BYTES: '4581'",
    "MAX_TOTAL_BYTES: '54972'",
    "supabase db push --linked --include-all --dry-run",
    "supabase db push --linked --include-all --yes",
    "supabase functions deploy \"$PROOF_FUNCTION\"",
    "supabase functions delete \"$PROOF_FUNCTION\"",
    "--no-verify-jwt",
    "node scripts/manage-r4f-g3-isolated-window.mjs",
    "--mode pause",
    "--mode resume",
    "https://s.devnet.rippletest.net:51234/",
    "xrpl_create_r5_revision4_active_checkpoint",
    "xrpl_prepare_r5_revision4_active_recovery",
    "capture-supabase-revision4-r5-accounting-qualification.mjs",
    "qualification.pass == true",
    "public-reader mutation",
    "Mainnet",
    "G3 rerun",
):
    if required not in rev4_proof:
        raise SystemExit(f"revision-4 12-ledger workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
    "supabase functions deploy xrpl-r5-recovery-batch",
    "supabase functions delete xrpl-r5-recovery-batch",
    "/r4f-g3-dashboard-authorize",
    "/r4f-g3-after",
    "/r4f-g3-capture-logs",
):
    if forbidden in rev4_proof:
        raise SystemExit(f"revision-4 12-ledger workflow contains forbidden capability: {forbidden.strip()}")
if rev4_proof.count("issues: write") != 1:
    raise SystemExit("revision-4 12-ledger workflow must have exactly one issue-write permission")
if rev4_proof.count('supabase functions deploy "$PROOF_FUNCTION"') != 1:
    raise SystemExit("revision-4 12-ledger workflow must deploy exactly one temporary proof function")
if rev4_proof.count('supabase functions delete "$PROOF_FUNCTION"') != 1:
    raise SystemExit("revision-4 12-ledger workflow must delete exactly one temporary proof function")
if rev4_proof.count("--mode pause") != 1 or rev4_proof.count("--mode resume") != 1:
    raise SystemExit("revision-4 12-ledger workflow must contain exactly one bounded pause and one restore")

'''
text = text.replace(marker, block + marker)

replace_once(
    'revision4 proof policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, and one finite R5 recovery burst; no scheduled workflows.',
)

path.write_text(text)
