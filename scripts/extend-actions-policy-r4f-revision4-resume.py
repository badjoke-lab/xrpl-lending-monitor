from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r4f-revision4-resume.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'revision4 resume workflow allowlist entry',
    '  r4f-revision4-12-ledger-qualification.yml\n  r4f-revision4-partial-state-probe.yml\n  r4f-revision4-residue-cleanup.yml',
    '  r4f-revision4-12-ledger-qualification.yml\n  r4f-revision4-12-ledger-resume.yml\n  r4f-revision4-partial-state-probe.yml\n  r4f-revision4-residue-cleanup.yml',
)
replace_once(
    'revision4 resume workflow count',
    'GitHub Actions workflow count must remain exactly fifteen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly sixteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'revision4 resume workflow symbol',
    'r4f_rev4_cleanup = "r4f-revision4-residue-cleanup.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_cleanup = "r4f-revision4-residue-cleanup.yml"\nr4f_rev4_resume = "r4f-revision4-12-ledger-resume.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'revision4 resume trigger policy',
    '    r4f_rev4_cleanup: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_cleanup: ["issue_comment"],\n    r4f_rev4_resume: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('revision4 resume policy insertion point is not unique')

block = r'''rev4_resume = (root / r4f_rev4_resume).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-revision4-12-ledger-resume-prepare'",
    "startsWith(github.event.comment.body, '/r4f-revision4-12-ledger-resume-authorize ')",
    "resume_state=prepared_zero_progress",
    "runrow=([a-f0-9]{64})",
    "checkpointrow=([a-f0-9]{64})",
    "checkpoint_id=(r5-checkpoint-revision4-proof-[0-9]+)",
    "PROOF_FUNCTION: 'xrpl-r4f-revision4-proof-batch'",
    "ACTIVE_FUNCTION: 'xrpl-r5-recovery-batch'",
    "MAX_LEDGER_COUNT: '12'",
    "MAX_PER_LEDGER_BYTES: '4581'",
    "MAX_TOTAL_BYTES: '54972'",
    "Verify exact prepared zero-progress qualification residue read-only",
    "Reverify bound prepared residue after pause read-only",
    "Resume exact prepared run with one 12-ledger proof invocation",
    "generated proof bundle contains unsupported Edge environment mutation",
    "__XRPL_R5_REVISION4_PROOF_RUNTIME_CONFIG__",
    "supabase functions deploy \"$PROOF_FUNCTION\"",
    "supabase functions delete \"$PROOF_FUNCTION\"",
    "--no-verify-jwt",
    "--mode pause",
    "--mode resume",
    "capture-supabase-revision4-r5-accounting-qualification.mjs",
    "qualification.pass == true",
    "progressive claim must rebind the prepared run to the current active boundary before reservation",
    "does not delete/recreate the bound checkpoint/run",
):
    if required not in rev4_resume:
        raise SystemExit(f"revision-4 prepared-run resume workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "workflow_dispatch",
    "pull_request_target",
    "contents: write",
    "supabase db push",
    "SUPABASE_DB_PASSWORD",
    "supabase link",
    "MAINNET_ENABLED: 'true'",
    "wrangler deploy",
    "supabase functions deploy xrpl-r5-recovery-batch",
    "supabase functions delete xrpl-r5-recovery-batch",
    "delete from xrpl_r5_v1.recovery_runs",
    "delete from xrpl_r5_v1.active_checkpoints",
):
    if forbidden in rev4_resume:
        raise SystemExit(f"revision-4 prepared-run resume workflow contains forbidden capability: {forbidden.strip()}")
if rev4_resume.count("issues: write") != 1:
    raise SystemExit("revision-4 prepared-run resume workflow must have exactly one issue-write permission")
if rev4_resume.count('supabase functions deploy "$PROOF_FUNCTION"') != 1:
    raise SystemExit("revision-4 prepared-run resume workflow must deploy exactly one temporary proof function")
if rev4_resume.count('supabase functions delete "$PROOF_FUNCTION"') != 1:
    raise SystemExit("revision-4 prepared-run resume workflow must delete exactly one temporary proof function")
if rev4_resume.count("--mode pause") != 1 or rev4_resume.count("--mode resume") != 1:
    raise SystemExit("revision-4 prepared-run resume workflow must contain exactly one bounded pause and restore")
if rev4_resume.count("read_only:true") < 4:
    raise SystemExit("revision-4 prepared-run resume workflow must revalidate state read-only before authorization and mutation")

'''
text = text.replace(marker, block + marker)

replace_once(
    'revision4 resume policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one authorization-gated revision-4 prepared-run resume workflow, and one finite R5 recovery burst; no scheduled workflows.',
)

path.write_text(text)
