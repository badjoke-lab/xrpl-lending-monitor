#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const ARCHIVE = 'xrpl_phase_archive_v1.terminal_messages'
const MIN_ARCHIVE_ROWS = 1500

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function env(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parse(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    options[key.slice(2)] = value
  }
  return options
}
async function query(sql) {
  const project = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(120_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { fail(`non-json Management API response: ${text.slice(0, 500)}`) }
  if (!response.ok) fail(`Management API read-only query failed (${response.status}): ${text.slice(0, 1000)}`)
  const rows = Array.isArray(body) ? body : body?.result ?? body?.data ?? body?.rows ?? body?.result?.rows ?? body?.data?.rows
  if (!Array.isArray(rows) || rows.length !== 1) fail('archive v2 preflight returned unexpected row count')
  return rows
}
function firstState(rows) {
  const raw = rows[0]?.state ?? rows[0]?.STATE
  if (raw == null) fail('state column missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

const SQL = String.raw`with archive_columns as (
  select ordinal_position,column_name,data_type,udt_name,is_nullable,column_default
  from information_schema.columns
  where table_schema='xrpl_phase_archive_v1' and table_name='terminal_messages'
), archive_stats as (
  select
    count(*)::bigint as rows,
    count(*) filter (where payload is null)::bigint as "nullPayloadRows",
    count(*) filter (where nullif(payload->>'workId','') is null)::bigint as "missingWorkIdRows",
    count(*) filter (where payload->>'workId' is not null)::bigint as "workIdRows",
    count(*) filter (where phase='scan')::bigint as "scanRows",
    count(*) filter (where phase='commit')::bigint as "commitRows",
    count(*) filter (where phase='finalize')::bigint as "finalizeRows",
    coalesce(sum(pg_column_size(payload))::bigint,0) as "payloadColumnBytes",
    coalesce(sum(octet_length(payload::text))::bigint,0) as "payloadTextBytes",
    coalesce(sum(octet_length(payload->>'workId'))::bigint,0) as "workIdTextBytes",
    coalesce(min(octet_length(payload->>'workId')),0)::integer as "workIdMinBytes",
    coalesce(max(octet_length(payload->>'workId')),0)::integer as "workIdMaxBytes",
    coalesce(avg(octet_length(payload->>'workId')),0)::numeric as "workIdAvgBytes",
    encode(extensions.digest(convert_to(coalesce(string_agg(encode(extensions.digest(convert_to(payload::text,'UTF8'),'sha256'),'hex'),'' order by message_hash),''),'UTF8'),'sha256'),'hex') as "orderedPayloadDigest"
  from xrpl_phase_archive_v1.terminal_messages
), archive_consumers as (
  select
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.prosecdef as security_definer,
    encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
    encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_sha256,
    p.prosrc ilike '%xrpl_phase_archive_v1.terminal_messages%' as mentions_archive_table,
    p.prosrc ilike '%xrpl_phase_archive_v1.assert_message_identity%' as calls_assert_message_identity,
    p.prosrc ilike '%xrpl_phase_archive_v1.assert_successor_identity%' as calls_assert_successor_identity,
    p.prosrc ilike '%xrpl_phase_archive_v1.duplicate_completion%' as calls_duplicate_completion,
    p.prosrc ilike '%xrpl_phase_archive_v1.terminalize_message%' as calls_terminalize_message,
    p.prosrc ilike '%archived%payload%' as mentions_archived_payload,
    p.prosrc ilike '%payload->>''workId''%' as reads_payload_work_id,
    p.prosrc
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f'
    and (
      p.prosrc ilike '%xrpl_phase_archive_v1.%'
      or p.prosrc ilike '%xrpl_phase_archive_v1.terminal_messages%'
    )
), archive_indexes as (
  select i.relname as name, x.indisprimary as primary_index, x.indisunique as unique_index,
         pg_relation_size(i.oid)::bigint as bytes, pg_get_indexdef(i.oid) as definition
  from pg_index x
  join pg_class i on i.oid=x.indexrelid
  where x.indrelid='xrpl_phase_archive_v1.terminal_messages'::regclass
), archive_constraints as (
  select conname as name,contype as type,convalidated as validated,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where conrelid='xrpl_phase_archive_v1.terminal_messages'::regclass
), archive_privileges as (
  select grantee,privilege_type from information_schema.role_table_grants
  where table_schema='xrpl_phase_archive_v1' and table_name='terminal_messages'
), scheduler as (
  select jobid,schedule,active,encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex') as command_sha256
  from cron.job where jobname='xrpl-lending-monitor-minute'
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'archiveRelationBytes',pg_total_relation_size('${ARCHIVE}'::regclass)::bigint,
  'archiveHeapBytes',pg_relation_size('${ARCHIVE}'::regclass)::bigint,
  'archiveIndexBytes',pg_indexes_size('${ARCHIVE}'::regclass)::bigint,
  'archiveRlsEnabled',(select relrowsecurity from pg_class where oid='${ARCHIVE}'::regclass),
  'archivePersistence',(select relpersistence from pg_class where oid='${ARCHIVE}'::regclass),
  'archiveColumns',coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal_position) from archive_columns x),'[]'::jsonb),
  'archiveStats',(select to_jsonb(x) from archive_stats x),
  'archiveIndexes',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from archive_indexes x),'[]'::jsonb),
  'archiveConstraints',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from archive_constraints x),'[]'::jsonb),
  'archivePrivileges',coalesce((select jsonb_agg(to_jsonb(x) order by x.grantee,x.privilege_type) from archive_privileges x),'[]'::jsonb),
  'archiveConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.function_name,x.identity_arguments) from archive_consumers x),'[]'::jsonb),
  'archiveConsumerCount',(select count(*)::integer from archive_consumers),
  'archiveTableConsumerCount',(select count(*)::integer from archive_consumers where mentions_archive_table),
  'archivedPayloadConsumerCount',(select count(*)::integer from archive_consumers where mentions_archived_payload or reads_payload_work_id),
  'payloadWorkIdConsumerCount',(select count(*)::integer from archive_consumers where reads_payload_work_id),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb),
  'safety',jsonb_build_object(
    'readOnly',true,'schemaMutationAuthorized',false,'archiveRewriteAuthorized',false,
    'phaseBMovementAuthorized',false,'physicalCompactionAuthorized',false,
    'schedulerMutationAuthorized',false,'deploymentAuthorized',false,
    'publicReaderMutationAuthorized',false,'mainnetDisabled',true,'r5RearmAuthorized',false
  )
)::text as state;`

if (!/^\s*with\b/iu.test(SQL)) fail('archive v2 preflight must be SELECT-only CTE query')
const sqlWithoutStrings = SQL.replace(/'[^']*'/gu, "''")
for (const forbidden of [/\bdelete\s+from\b/iu,/\btruncate\b/iu,/\bvacuum\b/iu,/\breindex\b/iu,/\bcluster\b/iu,/\balter\s+table\b/iu,/\bdrop\s+/iu,/\bcreate\s+(?:table|index)\b/iu,/\bupdate\s+/iu,/\binsert\s+into\b/iu]) {
  if (forbidden.test(sqlWithoutStrings)) fail(`archive v2 preflight contains mutation capability: ${forbidden}`)
}

function validate(state) {
  const stats = state.archiveStats
  if (!stats || Number(stats.rows) < MIN_ARCHIVE_ROWS) fail(`expected at least ${MIN_ARCHIVE_ROWS} archive rows`)
  if (Number(stats.nullPayloadRows) !== 0) fail('archive contains null payload rows')
  if (Number(stats.missingWorkIdRows) !== 0 || Number(stats.workIdRows) !== Number(stats.rows)) fail('not every archive payload has workId')
  if (!Array.isArray(state.archiveColumns) || !state.archiveColumns.some((c)=>c.column_name==='payload' && c.data_type==='jsonb')) fail('current archive payload column missing')
  if (state.archiveColumns.some((c)=>c.column_name==='payload_digest' || c.column_name==='work_id')) fail('archive v2 columns already present unexpectedly')
  if (state.archiveRlsEnabled !== true || state.archivePersistence !== 'p') fail('archive privacy/persistence boundary drifted')
  if (!state.activeRun || state.activeRun.runId !== ACTIVE_RUN_ID || state.activeRun.status !== 'halted' || state.activeRun.lastError !== 'r5_recovery_database_halt' || state.activeRun.network !== 'devnet' || Number(state.activeRun.profileRevision)!==4) fail('R5 database-halt boundary drifted')
  if (state.safety?.readOnly !== true || state.safety?.mainnetDisabled !== true) fail('read-only safety boundary missing')
  for (const key of ['schemaMutationAuthorized','archiveRewriteAuthorized','phaseBMovementAuthorized','physicalCompactionAuthorized','schedulerMutationAuthorized','deploymentAuthorized','publicReaderMutationAuthorized','r5RearmAuthorized']) {
    if (state.safety?.[key] !== false) fail(`unsafe authorization flag ${key}`)
  }
}

const options = parse(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const state = firstState(await query(SQL))
validate(state)
const structural = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-v2-readonly-preflight-state',
  sourceCommit,
  projectIdentityDigest: sha256(env('SUPABASE_PROJECT_ID')),
  maxMigrationVersion: state.maxMigrationVersion,
  archiveRelationBytes: Number(state.archiveRelationBytes),
  archiveRows: Number(state.archiveStats.rows),
  orderedPayloadDigest: state.archiveStats.orderedPayloadDigest,
  archiveColumns: state.archiveColumns,
  archiveIndexes: state.archiveIndexes,
  archiveConstraints: state.archiveConstraints,
  archivePrivileges: state.archivePrivileges,
  archiveConsumerSources: state.archiveConsumers.map((c)=>({schemaName:c.schema_name,functionName:c.function_name,identityArguments:c.identity_arguments,sourceSha256:c.source_sha256,definitionSha256:c.definition_sha256,mentionsArchiveTable:c.mentions_archive_table,mentionsArchivedPayload:c.mentions_archived_payload,readsPayloadWorkId:c.reads_payload_work_id})),
  activeRun: state.activeRun,
  scheduler: state.scheduler,
}
const result = {
  schemaVersion: 1,
  purpose: 'r5-terminal-archive-v2-readonly-preflight',
  sourceCommit,
  ...state,
  structuralStateSha256: sha256(JSON.stringify(structural)),
  structuralState: structural,
}
await writeJson(options.output, result)
process.stdout.write(`${JSON.stringify(result)}\n`)
