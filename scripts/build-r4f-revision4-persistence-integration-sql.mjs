import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'

const evidencePath =
  process.env.R4F_G2D_EVIDENCE ??
  'r4f-revision4-offline-shadow-evidence/evidence.json'
const outputPath =
  process.env.R4F_G2D_SQL ??
  'r4f-revision4-offline-shadow-evidence/postgres-integration.sql'

const result = JSON.parse(await readFile(evidencePath, 'utf8'))
const accountingJson = result?.accountingEvidence?.accountingJson
const accountingDigest = result?.accountingEvidence?.accountingDigest
const requestBody = JSON.parse(result?.persistenceRpcRequestBody ?? '{}')
const observationId = result?.accountingEvidence?.accounting?.observationId
const observationCount = result?.accountingEvidence?.accounting?.observations?.length
const rollingBytes = result?.accountingEvidence?.accounting?.rollingBillableEgressUpperBoundBytes
const memoryBytes = result?.accountingEvidence?.accounting?.memoryTransportUpperBoundBytes

if (typeof accountingJson !== 'string' || !/^[a-f0-9]{64}$/.test(accountingDigest)) {
  throw new Error('offline accounting evidence unavailable')
}
if (!/^[a-z0-9][a-z0-9._:-]{2,159}$/.test(observationId)) {
  throw new Error('observation id invalid')
}
if (!Number.isSafeInteger(observationCount) || observationCount < 1) {
  throw new Error('observation count invalid')
}
if (!Number.isSafeInteger(rollingBytes) || !Number.isSafeInteger(memoryBytes)) {
  throw new Error('accounting totals invalid')
}
if (!Number.isSafeInteger(requestBody.p_source_run_id) || requestBody.p_source_run_id < 1) {
  throw new Error('source run invalid')
}
if (!/^[a-f0-9]{40}$/.test(requestBody.p_source_commit)) {
  throw new Error('source commit invalid')
}

const conflict = JSON.parse(accountingJson)
conflict.disposition = 'shadow_retry'
const conflictingAccountingJson = JSON.stringify(conflict, Object.keys(conflict).sort())
// Reuse the canonical serializer's output order by replacing the one fixed scalar in-place.
const exactConflictingAccountingJson = accountingJson.replace(
  '"disposition":"shadow_completed"',
  '"disposition":"shadow_retry"',
)
if (exactConflictingAccountingJson === accountingJson) {
  throw new Error('conflict fixture replacement failed')
}
const conflictingDigest = createHash('sha256')
  .update(exactConflictingAccountingJson, 'utf8')
  .digest('hex')

function dollarQuote(value, tag) {
  const delimiter = `$${tag}$`
  if (value.includes(delimiter)) throw new Error(`value contains ${delimiter}`)
  return `${delimiter}${value}${delimiter}`
}

const accountingLiteral = dollarQuote(accountingJson, 'r4f_accounting')
const conflictingLiteral = dollarQuote(
  exactConflictingAccountingJson,
  'r4f_conflict',
)
const observationLiteral = dollarQuote(observationId, 'r4f_observation')
const sourceCommitLiteral = dollarQuote(
  requestBody.p_source_commit,
  'r4f_commit',
)

const sql = `\\set ON_ERROR_STOP on
begin;

do $r4f_test$
declare
  v_first jsonb;
  v_second jsonb;
  v_read jsonb;
  v_conflict_rejected boolean := false;
  v_count bigint;
begin
  v_first := public.xrpl_record_r4f_revision4_directional_accounting(
    ${accountingLiteral},
    '${accountingDigest}',
    ${requestBody.p_source_run_id},
    ${sourceCommitLiteral}
  );
  if coalesce((v_first->>'idempotent')::boolean, true) then
    raise exception 'first_write_not_new';
  end if;
  if (v_first->>'observationCount')::integer <> ${observationCount}
    or (v_first->>'rollingBillableEgressUpperBoundBytes')::bigint <> ${rollingBytes}
    or (v_first->>'memoryTransportUpperBoundBytes')::bigint <> ${memoryBytes}
  then
    raise exception 'first_write_totals_mismatch';
  end if;

  v_second := public.xrpl_record_r4f_revision4_directional_accounting(
    ${accountingLiteral},
    '${accountingDigest}',
    ${requestBody.p_source_run_id},
    ${sourceCommitLiteral}
  );
  if not coalesce((v_second->>'idempotent')::boolean, false) then
    raise exception 'idempotent_replay_failed';
  end if;

  select count(*) into v_count
  from xrpl_r4f_v1.directional_accounting_evidence
  where observation_id = ${observationLiteral};
  if v_count <> 1 then raise exception 'evidence_count_mismatch'; end if;

  select count(*) into v_count
  from xrpl_r4f_v1.directional_accounting_observations
  where observation_id = ${observationLiteral};
  if v_count <> ${observationCount} then
    raise exception 'observation_count_mismatch';
  end if;

  if not exists (
    select 1
    from xrpl_r4f_v1.directional_accounting_evidence
    where observation_id = ${observationLiteral}
      and accounting_json = ${accountingLiteral}
      and accounting_digest = '${accountingDigest}'
      and rolling_billable_egress_upper_bound_bytes = ${rollingBytes}
      and memory_transport_upper_bound_bytes = ${memoryBytes}
      and recovery_mutation_committed = false
      and public_reader_unchanged = true
      and mainnet_disabled = true
      and stabilization_authorized = false
      and soak_authorized = false
  ) then
    raise exception 'retained_export_parity_failed';
  end if;

  v_read := public.xrpl_read_r4f_revision4_directional_accounting(
    ${observationLiteral}
  );
  if v_read is null
    or (v_read#>>'{checks,exactRevision4Identity}')::boolean is not true
    or (v_read#>>'{checks,observationCountReconciles}')::boolean is not true
    or (v_read#>>'{checks,recoveryMutationCommitted}')::boolean is not false
    or (v_read#>>'{checks,publicReaderUnchanged}')::boolean is not true
    or (v_read#>>'{checks,mainnetDisabled}')::boolean is not true
    or (v_read#>>'{checks,stabilizationAuthorized}')::boolean is not false
    or (v_read#>>'{checks,soakAuthorized}')::boolean is not false
  then
    raise exception 'reader_reconciliation_failed';
  end if;

  begin
    perform public.xrpl_record_r4f_revision4_directional_accounting(
      ${conflictingLiteral},
      '${conflictingDigest}',
      ${requestBody.p_source_run_id},
      ${sourceCommitLiteral}
    );
  exception when others then
    if position('observation_identity_conflict' in sqlerrm) > 0 then
      v_conflict_rejected := true;
    else
      raise;
    end if;
  end;
  if not v_conflict_rejected then
    raise exception 'identity_conflict_not_rejected';
  end if;

  if has_schema_privilege('anon', 'xrpl_r4f_v1', 'USAGE')
    or has_schema_privilege('authenticated', 'xrpl_r4f_v1', 'USAGE')
    or has_function_privilege('anon', 'public.xrpl_record_r4f_revision4_directional_accounting(text,text,bigint,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.xrpl_read_r4f_revision4_directional_accounting(text)', 'EXECUTE')
  then
    raise exception 'public_role_privilege_leak';
  end if;
end;
$r4f_test$;

commit;

select jsonb_build_object(
  'schemaVersion', 1,
  'observationId', ${observationLiteral},
  'accountingDigest', '${accountingDigest}',
  'observationCount', ${observationCount},
  'rollingBillableEgressUpperBoundBytes', ${rollingBytes},
  'memoryTransportUpperBoundBytes', ${memoryBytes},
  'postgresIntegrationPassed', true,
  'recoveryMutationCommitted', false,
  'publicReaderUnchanged', true,
  'mainnetDisabled', true,
  'stabilizationAuthorized', false,
  'soakAuthorized', false
) as result;
`

await writeFile(outputPath, sql)
process.stdout.write(
  JSON.stringify({
    outputPath,
    observationId,
    accountingDigest,
    conflictingDigest,
    observationCount,
    rollingBytes,
    memoryBytes,
  }) + '\n',
)
