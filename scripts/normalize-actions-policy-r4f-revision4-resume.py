from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: normalize-actions-policy-r4f-revision4-resume.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new, 1)


replace_once(
    'revision4 proof workflow-to-inspector requirements',
    '''    "migration_state=applied_clean",
    "checkpointRev4Exists",
    "prepareRev4Exists",
    "rebindStrictRev4Exists",
    "rebindRev4Exists",
    "claimRev4Exists",
    "progressiveClaimRev4Exists",
    "completionRev4Exists",
    "egressPolicyRows",
    "runIdRows",
    "evidenceRows",
    "20260809151000 20260810123000 20260810133000 20260811012000 20260811061000",
    "maximum_ledgers_per_claim=12",
    "maximum_billable_egress_bytes_per_ledger=4581",
    "maximum_claim_billable_egress_bytes=54972",
    "maximum_claim_exclusive_reservation_bytes=54973",
''',
    '''    "migration_state=applied_clean",
    "node scripts/inspect-r4f-revision4-qualification-state.mjs",
    "state=(clean|prepared_resume)",
    "state_digest=",
    "qualification-state-before-proof.json",
    "20260809151000 20260810123000 20260810133000 20260811012000 20260811061000",
''',
)

marker = '''for forbidden in (
    "  push:",
'''
if text.count(marker) < 1:
    raise SystemExit('revision4 proof forbidden-policy marker missing')
inspector_policy = '''qualification_state = Path("scripts/inspect-r4f-revision4-qualification-state.mjs").read_text()
for required in (
    "checkpointRev4Exists",
    "prepareRev4Exists",
    "rebindStrictRev4Exists",
    "rebindRev4Exists",
    "claimRev4Exists",
    "progressiveClaimRev4Exists",
    "completionRev4Exists",
    "egressPolicyRows",
    "runIdRows",
    "evidenceRows",
    "maximum_ledgers_per_claim = 12",
    "maximum_billable_egress_bytes_per_ledger = 4581",
    "maximum_claim_billable_egress_bytes = 54972",
    "maximum_claim_exclusive_reservation_bytes = 54973",
    "state.batchRows === 0",
    "state.evidenceRows === 0",
    "mode = 'clean'",
    "mode = 'prepared_resume'",
    "resume.runStatus === 'prepared'",
    "resume.runCompletedBatches === 0",
    "resume.runCommittedLedgers === 0",
    "resume.runLastAccountingDigest === null",
    "resume.runLastError === null",
    "resume.runStartedAt === null",
    "resume.runCompletedAt === null",
    "resume.checkpointStateDigest === resume.checkpointStateDigestRecomputed",
    "read_only: true",
):
    if required not in qualification_state:
        raise SystemExit(f"revision-4 qualification state inspector is missing fail-closed requirement: {required}")
if qualification_state.count("read_only: true") != 1:
    raise SystemExit("revision-4 qualification state inspector must issue exactly one explicit read-only database query")

'''
text = text.replace(marker, inspector_policy + marker, 1)

replace_once(
    'revision4 proof read-only policy',
    '''if rev4_proof.count("read_only:true") < 4:
    raise SystemExit("revision-4 12-ledger workflow must revalidate applied-clean state read-only in prepare and execute")
''',
    '''if rev4_proof.count("read_only:true") != 2:
    raise SystemExit("revision-4 12-ledger workflow must retain exactly two direct read-only migration-history queries")
if rev4_proof.count("node scripts/inspect-r4f-revision4-qualification-state.mjs") != 3:
    raise SystemExit("revision-4 12-ledger workflow must inspect exact qualification state in prepare, execute preflight, and post-quiet boundary")
if rev4_proof.count("state=(clean|prepared_resume)") != 1:
    raise SystemExit("revision-4 12-ledger workflow must bind exactly one qualification-state mode parser")
if rev4_proof.count("AUTHORIZED_STATE_DIGEST") < 3:
    raise SystemExit("revision-4 12-ledger workflow must carry the authorized qualification-state digest through execution")
''',
)

path.write_text(text)
