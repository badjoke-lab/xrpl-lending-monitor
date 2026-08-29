from pathlib import Path
import sys

if len(sys.argv) != 2:
    raise SystemExit('usage: extend-actions-policy-r5-free-operation-capacity-qualification.py <generated-policy>')

path = Path(sys.argv[1])
text = path.read_text()


def replace_once(name: str, old: str, new: str) -> None:
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{name} expected exactly one generated-policy occurrence, found {count}')
    text = text.replace(old, new)


replace_once(
    'free-operation capacity qualification workflow allowlist entry',
    '  r5-cron-history-retention.yml\n  r5-index-footprint-readonly-probe.yml',
    '  r5-cron-history-retention.yml\n  r5-free-operation-capacity-qualification.yml\n  r5-index-footprint-readonly-probe.yml',
)
replace_once(
    'free-operation capacity qualification workflow count',
    'GitHub Actions workflow count must remain exactly forty-five while R4F qualification and the guarded R5 workflows are active.',
    'GitHub Actions workflow count must remain exactly forty-six while R4F qualification and the guarded R5 workflows are active.',
)
replace_once(
    'free-operation capacity qualification workflow symbol',
    'r5_revision3_restore_schema_retirement = "r5-revision3-restore-schema-retirement.yml"',
    'r5_revision3_restore_schema_retirement = "r5-revision3-restore-schema-retirement.yml"\nr5_free_operation_capacity_qualification = "r5-free-operation-capacity-qualification.yml"',
)
replace_once(
    'free-operation capacity qualification trigger policy',
    '    r5_revision3_restore_schema_retirement: ["issue_comment"],',
    '    r5_revision3_restore_schema_retirement: ["issue_comment"],\n    r5_free_operation_capacity_qualification: ["issue_comment"],',
)

marker = 'burst = (root / r5_burst).read_text()\n'
if text.count(marker) != 1:
    raise SystemExit('free-operation capacity qualification policy insertion point is not unique')

block = r'''free_operation_capacity = (root / r5_free_operation_capacity_qualification).read_text()
free_operation_capacity_qualifier = (root / "../../scripts/qualify-r5-free-operation-capacity.mjs").read_text()
for required in (
    "contents: read",
    "issues: write",
    "github.event.issue.number == 1261",
    "github.event.comment.user.login == 'badjoke-lab'",
    "github.event.comment.body == '/r5-free-operation-capacity-qualify'",
    "ref: main",
    "persist-credentials: false",
    "scripts/qualify-r5-free-operation-capacity.mjs",
    "productionDatabaseReadOnly == true",
    "rowMutationPerformed == false",
    "schedulerMutationPerformed == false",
    "deploymentPerformed == false",
    "publicReaderMutationPerformed == false",
    "migrationMutationPerformed == false",
    "r5RearmAuthorized == false",
    "r5RearmPerformed == false",
    "mainnetEnabled == false",
    "safeForR5Rearm",
    "evidenceDigest",
    "Upload sanitized capacity evidence",
    "Publish sanitized qualification result",
):
    if required not in free_operation_capacity:
        raise SystemExit(f"free-operation capacity workflow missing requirement: {required}")
for forbidden in (
    "  push:", "  schedule:", "workflow_dispatch", "pull_request_target",
    "contents: write", "supabase functions deploy", "supabase db push",
    "cron.schedule", "cron.unschedule", "wrangler deploy", "MAINNET_ENABLED: 'true'",
    ".safeForR5Rearm == true",
):
    if forbidden in free_operation_capacity:
        raise SystemExit(f"free-operation capacity workflow contains forbidden capability or forced verdict: {forbidden.strip()}")
if free_operation_capacity.count("issues: write") != 1:
    raise SystemExit("free-operation capacity workflow must have exactly one issue-write permission")

for required in (
    "const DATABASE_HALT_BYTES = 400_000_000",
    "const PROJECT_EGRESS_HALT_31D_BYTES = 4 * 1024 * 1024 * 1024",
    "const PROJECT_MEMORY_HALT_BYTES = 224 * 1024 * 1024",
    "const PROJECT_INVOCATION_HALT_31D = 400_000",
    "const SELECTED_MAX_LEDGERS_PER_CLAIM = 12",
    "const RETAINED_SAMPLE_LEDGERS = 14",
    "const RESERVE_WINDOWS = 14",
    "const OBSERVED_ROW_COUNT_SAFETY_MULTIPLIER = 2",
    "const RAW_JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'",
    "const RAW_JOB_SCHEDULE = '47 */6 * * *'",
    "const RAW_JOB_COMMAND_SHA256 = 'a7029e464b56f7652b7690b6a8f5b90331d5dfbb0812e3a0ab2788987c64ec98'",
    "const PORTABLE_PAYLOAD_CONTRACT_PATH = 'src/shared/portable-collector-payload.ts'",
    "const PORTABLE_NORMALIZATION_PATH = 'src/collector/history-segments/portable-xrpl-normalization.ts'",
    "const R5_RECOVERY_BATCH_PATH = 'supabase/functions/xrpl-r5-recovery-batch/index.ts'",
    "const EXPECTED_NORMALIZED_PAYLOAD_CHUNK_MAX_BYTES = 512_000",
    "const EXPECTED_COMPLETION_REQUEST_MAX_BYTES = 2 * 1024 * 1024",
    "runId: 31882543711",
    "evidenceDigest: '46d2b25203b291dfa26030b31d1742bde883fda96763ea61ac88db6a449f31c9'",
    "runtimeAccountingBlobSha1: '3e20670008ee9438797eef8e79ff40fcd4fb23d7'",
    "directionalContractBlobSha1: 'b9bc8222ccf7383ba9f29766d4e061eb3ca66e96'",
    "read_only: true",
    "expected_payload_chunks",
    "expected_commit_chunks",
    "persistentPhysicalAmplificationFactor",
    "generatedRawRowsReconstructedFromWorkExpectations: true",
    "method: 'retention_aware_aggregate_completion_cap_times_physical_amplification_plus_structural_row_reserve'",
    "normalized payload chunk byte guard is not unique",
    "normalized payload chunk byte guard changed from reviewed contract",
    "R5 writer is no longer bound to the reviewed normalized payload chunk guard",
    "projectedPhysicalRowBytes('xrpl_phase_payload_chunks', normalizedPayloadChunkMaxBytes)",
    "payloadChunkHardGuardBoundToR5Writer",
    "completion request byte guard is not unique",
    "completion request byte guard changed from reviewed contract",
    "R5 writer is no longer bound to the reviewed aggregate completion request guard",
    "completionRequestHardGuardBoundToR5Writer",
    "completionRequestPhysicalEnvelopeBytes",
    "projectedStructuralOverheadDatabaseBytes",
    "state.restoreSchemaExists === false",
    "state.archiveTableExists === true",
    "state.archiveRlsEnabled === true",
    "rawRetentionExactContract",
    "rawRetentionLagWithinCadence",
    "projectedIncrementalRows * RESERVE_WINDOWS",
    "projectedIncrementalDatabaseBytes * RESERVE_WINDOWS",
    "requiredReserveDatabaseBytes < databaseHeadroomBytes",
    "projectedDatabaseBytesReserve < DATABASE_HALT_BYTES",
    "projectedEgress31dBytes < PROJECT_EGRESS_HALT_31D_BYTES",
    "REVIEWED_RESOURCE_BASELINE.memoryUpperBytes < PROJECT_MEMORY_HALT_BYTES",
    "projectedInvocations31d < PROJECT_INVOCATION_HALT_31D",
    "reviewedResourceAccountingUnchanged",
    "sustainedFreeOperationCapacityProblemClosed: safeForR5Rearm",
    "productionDatabaseReadOnly: true",
    "rowMutationPerformed: false",
    "schedulerMutationPerformed: false",
    "deploymentPerformed: false",
    "publicReaderMutationPerformed: false",
    "migrationMutationPerformed: false",
    "r5RearmAuthorized: false",
    "r5RearmPerformed: false",
    "mainnetEnabled: false",
):
    if required not in free_operation_capacity_qualifier:
        raise SystemExit(f"free-operation capacity qualifier missing fail-closed guard: {required}")
qualifier_lower = free_operation_capacity_qualifier.lower()
for forbidden in (
    "read_only: false", "delete from ", "truncate ", "update public.", "insert into ",
    "alter table ", "drop table ", "drop schema ", "reindex ", "vacuum ",
    "cron.schedule", "cron.unschedule", "wrangler deploy",
    "last_14_committed_ledgers_max_direct_rows_x2_plus_transport_overhead_physical_row_upper_bound",
):
    if forbidden in qualifier_lower:
        raise SystemExit(f"free-operation capacity qualifier contains forbidden mutation capability or obsolete model: {forbidden}")

'''
text = text.replace(marker, block + marker)
path.write_text(text)
