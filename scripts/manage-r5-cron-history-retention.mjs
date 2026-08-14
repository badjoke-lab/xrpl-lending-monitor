#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const JOB_NAME = 'xrpl-r5-cron-history-retention-v1'
const JOB_SCHEDULE = '17 */6 * * *'
const SUCCESS_HOURS = 24
const FAILURE_DAYS = 7
const DELETE_SQL = `delete from cron.job_run_details where (status = 'succeeded' and end_time is not null and end_time < now() - interval '${SUCCESS_HOURS} hours') or (status is distinct from 'succeeded' and end_time is not null and end_time < now() - interval '${FAILURE_DAYS} days')`
const ELIGIBLE_PREDICATE = `(status = 'succeeded' and end_time is not null and end_time < now() - interval '${SUCCESS_HOURS} hours') or (status is distinct from 'succeeded' and end_time is not null and end_time < now() - interval '${FAILURE_DAYS} days')`
const KEEP_PREDICATE = `not (${ELIGIBLE_PREDICATE})`

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const token = rest[i]
    const value = rest[i + 1]
    if (!token?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${token ?? '<end>'}`)
    options[token.slice(2)] = value
  }
  return { command, options }
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) if (Array.isArray(candidate)) return candidate
  fail('Management API response contains no rows')
}
async function managementQuery(query, readOnly) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}
function firstState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}

const escapedCommand = DELETE_SQL.replaceAll("'", "''")
const escapedSchedule = JOB_SCHEDULE.replaceAll("'", "''")
const escapedName = JOB_NAME.replaceAll("'", "''")
const MUTATION_SQL = `begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';
lock table cron.job_run_details in access exclusive mode;
create temporary table r5_cron_retained on commit drop as
  select * from cron.job_run_details where ${KEEP_PREDICATE};
create temporary table r5_cron_compaction_meta on commit drop as
  select
    count(*)::bigint as retained_rows,
    coalesce(md5(string_agg(to_jsonb(r)::text, E'\\n' order by runid)), md5('')) as retained_digest,
    (select pg_get_serial_sequence('cron.job_run_details','runid')) as sequence_name,
    (select last_value from pg_sequences where schemaname='cron' and sequencename=split_part(pg_get_serial_sequence('cron.job_run_details','runid'),'.',2)) as sequence_last_value,
    (select max(runid) from cron.job_run_details) as max_runid_before
  from r5_cron_retained r;
truncate table cron.job_run_details continue identity;
insert into cron.job_run_details overriding system value
  select * from r5_cron_retained order by runid;
do $$
declare
  v_expected_rows bigint;
  v_actual_rows bigint;
  v_expected_digest text;
  v_actual_digest text;
  v_sequence_name text;
  v_sequence_before bigint;
  v_sequence_after bigint;
begin
  select retained_rows,retained_digest,sequence_name,sequence_last_value
    into v_expected_rows,v_expected_digest,v_sequence_name,v_sequence_before
  from r5_cron_compaction_meta;
  select count(*)::bigint,coalesce(md5(string_agg(to_jsonb(r)::text,E'\\n' order by runid)),md5(''))
    into v_actual_rows,v_actual_digest
  from cron.job_run_details r;
  if v_actual_rows is distinct from v_expected_rows or v_actual_digest is distinct from v_expected_digest then
    raise exception 'cron retained-row restoration mismatch';
  end if;
  if exists(select 1 from cron.job_run_details where ${ELIGIBLE_PREDICATE}) then
    raise exception 'cron physical compaction retained an expired row';
  end if;
  if v_sequence_name is null then
    raise exception 'cron runid sequence missing';
  end if;
  select last_value into v_sequence_after
  from pg_sequences
  where schemaname='cron' and sequencename=split_part(v_sequence_name,'.',2);
  if v_sequence_after is distinct from v_sequence_before then
    raise exception 'cron runid sequence moved during compaction';
  end if;
end $$;
select cron.schedule('${escapedName}', '${escapedSchedule}', '${escapedCommand}');
commit;`

for (const required of [
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '45s'",
  'lock table cron.job_run_details in access exclusive mode',
  'create temporary table r5_cron_retained on commit drop',
  'truncate table cron.job_run_details continue identity',
  'insert into cron.job_run_details overriding system value',
  'cron retained-row restoration mismatch',
  'cron runid sequence moved during compaction',
  `select cron.schedule('${escapedName}', '${escapedSchedule}', '${escapedCommand}')`,
]) if (!MUTATION_SQL.includes(required)) fail(`cron physical-compaction mutation missing contract: ${required}`)
if ((MUTATION_SQL.match(/\btruncate\b/giu) ?? []).length !== 1) fail('cron physical-compaction mutation must contain exactly one TRUNCATE')
for (const forbidden of [
  /\btruncate\s+table\s+(?!cron\.job_run_details\b)/iu,
  /\bdrop\s+(table|schema)\b/iu,
  /\balter\s+table\b/iu,
  /\bvacuum\b/iu,
  /\bdelete\s+from\s+public\./iu,
  /\bupdate\s+cron\.job\b/iu,
]) if (forbidden.test(MUTATION_SQL)) fail(`cron physical-compaction mutation contains forbidden capability: ${forbidden}`)

function inspectionSql() {
  return `select jsonb_build_object(
    'currentUser', current_user,
    'databaseBytes', pg_database_size(current_database()),
    'tableBytes', pg_total_relation_size('cron.job_run_details'::regclass),
    'heapBytes', pg_relation_size('cron.job_run_details'::regclass),
    'indexBytes', pg_indexes_size('cron.job_run_details'::regclass),
    'tableKind', (select relkind::text from pg_class where oid='cron.job_run_details'::regclass),
    'tableReloptions', coalesce((select to_jsonb(reloptions) from pg_class where oid='cron.job_run_details'::regclass),'null'::jsonb),
    'tableDefinitionDigestSource', (select jsonb_agg(jsonb_build_object(
      'column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,
      'default',column_default,'identity',is_identity,'identityGeneration',identity_generation
    ) order by ordinal_position) from information_schema.columns where table_schema='cron' and table_name='job_run_details'),
    'constraints', coalesce((select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='cron.job_run_details'::regclass),'[]'::jsonb),
    'foreignKeys', coalesce((select jsonb_agg(jsonb_build_object('name',conname,'source',conrelid::regclass::text,'target',confrelid::regclass::text,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where contype='f' and (conrelid='cron.job_run_details'::regclass or confrelid='cron.job_run_details'::regclass)),'[]'::jsonb),
    'nonInternalTriggers', coalesce((select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) order by tgname) from pg_trigger where tgrelid='cron.job_run_details'::regclass and not tgisinternal),'[]'::jsonb),
    'runIdSequence', pg_get_serial_sequence('cron.job_run_details','runid'),
    'runIdSequenceRecord', coalesce((select jsonb_build_object('schema',schemaname,'name',sequencename,'start',start_value,'min',min_value,'max',max_value,'increment',increment_by,'cycle',cycle,'cache',cache_size,'lastValue',last_value) from pg_sequences where schemaname='cron' and sequencename=split_part(pg_get_serial_sequence('cron.job_run_details','runid'),'.',2)),'null'::jsonb),
    'jobRows', (select count(*) from cron.job where jobname='${JOB_NAME}'),
    'jobRecord', coalesce((select jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'database',database,'username',username,'active',active) from cron.job where jobname='${JOB_NAME}' limit 1),'null'::jsonb),
    'exactRows', (select count(*) from cron.job_run_details),
    'candidateSucceededRows', (select count(*) from cron.job_run_details where status='succeeded' and end_time is not null and end_time < now()-interval '${SUCCESS_HOURS} hours'),
    'candidateNonSucceededRows', (select count(*) from cron.job_run_details where status is distinct from 'succeeded' and end_time is not null and end_time < now()-interval '${FAILURE_DAYS} days'),
    'retainedSucceededRows', (select count(*) from cron.job_run_details where status='succeeded' and (end_time is null or end_time >= now()-interval '${SUCCESS_HOURS} hours')),
    'retainedNonSucceededRows', (select count(*) from cron.job_run_details where status is distinct from 'succeeded' and (end_time is null or end_time >= now()-interval '${FAILURE_DAYS} days')),
    'nullEndRows', (select count(*) from cron.job_run_details where end_time is null),
    'oldestStartTime', (select min(start_time) from cron.job_run_details),
    'newestStartTime', (select max(start_time) from cron.job_run_details),
    'maxRunId', (select max(runid) from cron.job_run_details),
    'stats', coalesce((select jsonb_build_object('live',n_live_tup,'dead',n_dead_tup,'lastAutovacuum',last_autovacuum,'autovacuumCount',autovacuum_count) from pg_stat_all_tables where relid='cron.job_run_details'::regclass),'{}'::jsonb)
  ) as state;`
}
function structuralState(state, sourceCommit) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const job = state.jobRecord
  return {
    schemaVersion: 2,
    purpose: 'r5-cron-history-retention-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    jobName: JOB_NAME,
    jobSchedule: JOB_SCHEDULE,
    jobCommandSha256: sha256(DELETE_SQL),
    physicalCompactionMutationSha256: sha256(MUTATION_SQL),
    successRetentionHours: SUCCESS_HOURS,
    nonSuccessRetentionDays: FAILURE_DAYS,
    jobRows: Number(state.jobRows),
    existingJobMatches: Number(state.jobRows) === 1 && job?.schedule === JOB_SCHEDULE && job?.command === DELETE_SQL && job?.active === true,
    tableKind: state.tableKind,
    tableDefinitionSha256: sha256(JSON.stringify(state.tableDefinitionDigestSource)),
    constraintsSha256: sha256(JSON.stringify(state.constraints ?? [])),
    foreignKeysSha256: sha256(JSON.stringify(state.foreignKeys ?? [])),
    nonInternalTriggersSha256: sha256(JSON.stringify(state.nonInternalTriggers ?? [])),
    runIdSequence: state.runIdSequence,
  }
}
async function inspect(sourceCommit) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  const structural = structuralState(state, sourceCommit)
  return {
    schemaVersion: 2,
    purpose: 'r5-cron-history-retention-state',
    sourceCommit,
    ...state,
    cleanup: {
      jobName: JOB_NAME,
      schedule: JOB_SCHEDULE,
      commandSha256: sha256(DELETE_SQL),
      physicalCompactionMutationSha256: sha256(MUTATION_SQL),
      successRetentionHours: SUCCESS_HOURS,
      nonSuccessRetentionDays: FAILURE_DAYS,
    },
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    mutationAuthorized: false,
    schedulerMutationAuthorized: false,
    vacuumAuthorized: false,
    deploymentAuthorized: false,
    mainnetDisabled: true,
  }
}
function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  return sourceCommit
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}
function assertCompactionEligible(state) {
  if (Number(state.jobRows) !== 0) fail(`cleanup job already exists (${state.jobRows} row(s)); no new authorization proposal allowed`)
  if (state.tableKind !== 'r') fail(`cron history relation kind drifted: ${state.tableKind}`)
  if (!Array.isArray(state.foreignKeys) || state.foreignKeys.length !== 0) fail('cron history table has foreign-key dependencies; physical compaction is not eligible')
  if (!Array.isArray(state.nonInternalTriggers) || state.nonInternalTriggers.length !== 0) fail('cron history table has non-internal triggers; physical compaction is not eligible')
  if (typeof state.runIdSequence !== 'string' || !state.runIdSequence.startsWith('cron.')) fail('cron runid sequence is missing or unexpected')
  if (!state.runIdSequenceRecord || typeof state.runIdSequenceRecord !== 'object') fail('cron runid sequence metadata missing')
  if (Number(state.exactRows) <= 0) fail('cron history is empty; physical compaction is not eligible')
  if (Number(state.candidateSucceededRows) + Number(state.candidateNonSucceededRows) <= 0) fail('cron history has no expired rows to compact')
}
async function prepare(options) {
  const sourceCommit = validateSource(options)
  const state = await inspect(sourceCommit)
  assertCompactionEligible(state)
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}
async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedMutation = options['authorized-mutation']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedMutation ?? '')) fail('invalid --authorized-mutation')
  if (authorizedMutation !== sha256(MUTATION_SQL)) fail('authorized mutation SHA does not match exact cron physical-compaction transaction')

  const before = await inspect(sourceCommit)
  assertCompactionEligible(before)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state drifted before cron retention mutation')

  await managementQuery(MUTATION_SQL, false)

  const after = await inspect(sourceCommit)
  if (Number(after.jobRows) !== 1 || after.jobRecord?.schedule !== JOB_SCHEDULE || after.jobRecord?.command !== DELETE_SQL || after.jobRecord?.active !== true) fail('cleanup job post-state mismatch')
  if (!(Number(after.tableBytes) < Number(before.tableBytes))) fail('cron physical compaction did not shrink the relation')
  if (!(Number(after.databaseBytes) < Number(before.databaseBytes))) fail('cron physical compaction did not reduce database bytes')
  if (after.runIdSequence !== before.runIdSequence) fail('cron runid sequence identity drifted after compaction')

  const evidence = {
    schemaVersion: 2,
    purpose: 'r5-cron-history-retention-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    mutationSha256: authorizedMutation,
    jobId: after.jobRecord.jobid,
    jobName: JOB_NAME,
    schedule: JOB_SCHEDULE,
    successRetentionHours: SUCCESS_HOURS,
    nonSuccessRetentionDays: FAILURE_DAYS,
    rowsBefore: Number(before.exactRows),
    rowsAfter: Number(after.exactRows),
    candidateRowsBefore: Number(before.candidateSucceededRows) + Number(before.candidateNonSucceededRows),
    candidateRowsAfterReadback: Number(after.candidateSucceededRows) + Number(after.candidateNonSucceededRows),
    tableBytesBefore: Number(before.tableBytes),
    tableBytesAfter: Number(after.tableBytes),
    tableBytesReclaimed: Number(before.tableBytes) - Number(after.tableBytes),
    heapBytesBefore: Number(before.heapBytes),
    heapBytesAfter: Number(after.heapBytes),
    databaseBytesBefore: Number(before.databaseBytes),
    databaseBytesAfter: Number(after.databaseBytes),
    databaseBytesReclaimed: Number(before.databaseBytes) - Number(after.databaseBytes),
    databaseBelowHaltAfter: Number(after.databaseBytes) < 400_000_000,
    databaseHeadroomBytesAfter: 400_000_000 - Number(after.databaseBytes),
    nullEndRowsBefore: Number(before.nullEndRows),
    nullEndRowsAfter: Number(after.nullEndRows),
    runIdSequence: after.runIdSequence,
    physicalCompactionPerformed: true,
    vacuumPerformed: false,
    schedulerMutationPerformed: true,
    deploymentPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RestartAuthorized: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
