from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r4f-revision4-invocation-probe.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'revision4 invocation probe workflow allowlist entry',
    '  r4f-revision4-residue-cleanup.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-revision4-residue-cleanup.yml\n  r4f-revision4-invocation-probe.yml\n  r5-bounded-recovery-burst.yml',
)
replace_once(
    'revision4 invocation probe workflow count',
    'GitHub Actions workflow count must remain exactly fifteen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly sixteen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'revision4 invocation probe workflow symbol',
    'r4f_rev4_cleanup = "r4f-revision4-residue-cleanup.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_cleanup = "r4f-revision4-residue-cleanup.yml"\nr4f_rev4_invocations = "r4f-revision4-invocation-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'revision4 invocation probe trigger policy',
    '    r4f_rev4_cleanup: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_cleanup: ["issue_comment"],\n    r4f_rev4_invocations: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('revision4 invocation probe policy insertion point is not unique')

block = r'''rev4_invocations = (root / r4f_rev4_invocations).read_text()
for required in (
    "contents: read",
    "issues: write",
    "cancel-in-progress: false",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-revision4-invocation-probe'",
    "scripts/record-supabase-runtime-resource-log-snapshot.mjs",
    "xrpl_resource_guard_v1.external_snapshots",
    "xrpl_resource_guard_v2.attempts",
    "xrpl_r5_v1.recovery_batches",
    "read_only:true",
    "INVOCATION_HALT_31D: '400000'",
    "SNAPSHOT_MAX_AGE_SECONDS: '90000'",
    "currentProjectedInvocations31d",
    "internalProjectedInvocations31d",
    "claimProviderInvocations31d",
    "claimProjectedInvocations31d",
    "staleSnapshotForcesHalt",
    "production mutation: \\`none\\`",
    "collector pause/deploy/Mainnet/public-reader/stabilization/soak: \\`none\\`",
):
    if required not in rev4_invocations:
        raise SystemExit(f"revision-4 invocation probe is missing read-only requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "read_only:false",
    "supabase db",
    "supabase functions deploy",
    "supabase functions delete",
    "wrangler deploy",
    "--mode pause",
    "--mode resume",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in rev4_invocations:
        raise SystemExit(f"revision-4 invocation probe contains forbidden capability: {forbidden.strip()}")
if rev4_invocations.count("issues: write") != 1:
    raise SystemExit("revision-4 invocation probe must have exactly one issue-write permission")
if rev4_invocations.count("read_only:true") != 1:
    raise SystemExit("revision-4 invocation probe must issue exactly one explicit read-only database query")
if rev4_invocations.count("/database/query") != 1:
    raise SystemExit("revision-4 invocation probe must contain exactly one database query call")

'''
text = text.replace(marker, block + marker)

replace_once(
    'revision4 invocation probe policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, and one finite R5 recovery burst; no scheduled workflows.',
)

path.write_text(text)
