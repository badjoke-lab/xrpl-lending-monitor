from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r4f-revision4-resource-snapshot-refresh.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'revision4 resource refresh workflow allowlist entry',
    '  r4f-revision4-residue-cleanup.yml\n  r5-bounded-recovery-burst.yml',
    '  r4f-revision4-residue-cleanup.yml\n  r4f-revision4-resource-snapshot-refresh.yml\n  r5-bounded-recovery-burst.yml',
)
replace_once(
    'revision4 resource refresh workflow count',
    'GitHub Actions workflow count must remain exactly sixteen while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly seventeen while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'revision4 resource refresh workflow symbol',
    'r4f_rev4_invocations = "r4f-revision4-invocation-probe.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
    'r4f_rev4_invocations = "r4f-revision4-invocation-probe.yml"\nr4f_rev4_resource_refresh = "r4f-revision4-resource-snapshot-refresh.yml"\nr5_burst = "r5-bounded-recovery-burst.yml"',
)
replace_once(
    'revision4 resource refresh trigger policy',
    '    r4f_rev4_invocations: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
    '    r4f_rev4_invocations: ["issue_comment"],\n    r4f_rev4_resource_refresh: ["issue_comment"],\n    r5_burst: ["workflow_dispatch", "issue_comment", "push"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('revision4 resource refresh policy insertion point is not unique')

block = r'''rev4_resource_refresh = (root / r4f_rev4_resource_refresh).read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r4f-revision4-resource-snapshot-refresh-prepare'",
    "startsWith(github.event.comment.body, '/r4f-revision4-resource-snapshot-refresh-authorize ')",
    "scripts/prepare-r4f-revision4-resource-snapshot.ts",
    "public.xrpl_record_external_resource_snapshot",
    "INVOCATION_HALT_31D: '400000'",
    "BUNDLE_HALT_BYTES: '4000000'",
    "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    "bun-version: 1.3.14",
    "function_identity=([a-f0-9]{64})",
    "bundle_identity=([a-f0-9]{64})",
    "evidence=([a-f0-9]{64})",
    "prepare_run=([0-9]+)",
    "expires=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)",
    "test $((expires_epoch - auth_epoch)) -le 7200",
    "Verify successful fresh preparation and unique prior proposal",
    "Reverify deployed function identity and same-commit bundles read-only",
    "Reverify exact production snapshot writer read-only",
    "Record exactly the authorized fresh external resource snapshot",
    "Verify exact snapshot readback read-only",
    "read_only:false",
    "read_only:true",
    "externalSnapshotFresh == true",
    "coverage.functionInvocations == true",
    "coverage.bundleSize == true",
    "No collector pause, Edge Function deploy/delete, migration, revision-4 selection/promotion, Mainnet, public-reader mutation, stabilization, or soak",
):
    if required not in rev4_resource_refresh:
        raise SystemExit(f"revision-4 resource snapshot refresh workflow is missing fail-closed requirement: {required}")
for forbidden in (
    "  push:",
    "  schedule:",
    "pull_request_target",
    "contents: write",
    "supabase db",
    "supabase functions deploy",
    "supabase functions delete",
    "wrangler deploy",
    "--mode pause",
    "--mode resume",
    "MAINNET_ENABLED: 'true'",
):
    if forbidden in rev4_resource_refresh:
        raise SystemExit(f"revision-4 resource snapshot refresh workflow contains forbidden capability: {forbidden.strip()}")
if rev4_resource_refresh.count("issues: write") != 1:
    raise SystemExit("revision-4 resource snapshot refresh workflow must have exactly one issue-write permission")
if rev4_resource_refresh.count("read_only:false") != 1:
    raise SystemExit("revision-4 resource snapshot refresh workflow must contain exactly one explicit production write query")
if rev4_resource_refresh.count("read_only:true") != 3:
    raise SystemExit("revision-4 resource snapshot refresh workflow must contain exactly three explicit read-only production queries")
if rev4_resource_refresh.count("/database/query") != 4:
    raise SystemExit("revision-4 resource snapshot refresh workflow must contain exactly four database query calls")
if rev4_resource_refresh.count("oven-sh/setup-bun@") != 2:
    raise SystemExit("revision-4 resource snapshot refresh workflow must pin Bun once in prepare and once in execute")
if rev4_resource_refresh.count("bun-version: 1.3.14") != 2:
    raise SystemExit("revision-4 resource snapshot refresh workflow must pin exactly Bun 1.3.14 in both jobs")
if rev4_resource_refresh.count("xrpl_record_external_resource_snapshot('") != 1:
    raise SystemExit("revision-4 resource snapshot refresh workflow must expose exactly one canonical snapshot write call")

'''
text = text.replace(marker, block + marker)

replace_once(
    'revision4 resource refresh policy summary',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, and one finite R5 recovery burst; no scheduled workflows.',
    'one read-only formal R4F G3 dual-verdict workflow, one authorization-gated revision-4 exact 12-ledger qualification workflow, one read-only revision-4 migration/partial-state probe, one authorization-gated revision-4 residue cleanup workflow, one read-only revision-4 current-invocation probe, one authorization-gated revision-4 external resource snapshot refresh workflow, and one finite R5 recovery burst; no scheduled workflows.',
)

path.write_text(text)
