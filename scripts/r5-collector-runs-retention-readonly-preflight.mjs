#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const TABLE = 'public.xrpl_collector_runs'
const RETAIN_LATEST_ROWS = 256

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
  if (!Array.isArray(rows) || rows.length !== 1) fail('collector retention preflight returned unexpected row count')
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

const SQL = String.raw`with ranked as (
  select r.*, row_number() over (order by completed_at desc nulls last, id desc) as retention_rank
  from public.xrpl_collector_runs r
), retained as (
  select * from ranked where retention_rank <= ${RETAIN_LATEST_ROWS}
), candidates as (
  select * from ranked where retention_rank > ${RETAIN_LATEST_ROWS}
), status_counts as (
  select status,count(*)::bigint as rows from public.xrpl_collector_runs group by status
), table_columns as (
  select ordinal_position,column_name,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation,is_generated,generation_expression
  from information_schema.columns where table_schema='public' and table_name='xrpl_collector_runs'
), table_indexes as (
  select i.relname as name,x.indisprimary as primary_index,x.indisunique as unique_index,x.indisvalid as valid,x.indisready as ready,
         pg_relation_size(i.oid)::bigint as bytes,pg_get_indexdef(i.oid) as definition
  from pg_index x join pg_class i on i.oid=x.indexrelid
  where x.indrelid='public.xrpl_collector_runs'::regclass
), table_constraints as (
  select conname as name,contype as type,convalidated as validated,condeferrable as deferrable,condeferred as deferred,
         case when confrelid=0 then null else confrelid::regclass::text end as referenced_table,
         pg_get_constraintdef(oid,true) as definition
  from pg_constraint where conrelid='public.xrpl_collector_runs'::regclass
), inbound_fks as (
  select conrelid::regclass::text as source_table,conname as name,convalidated as validated,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where contype='f' and confrelid='public.xrpl_collector_runs'::regclass
), table_triggers as (
  select tgname as name,tgenabled as enabled,pg_get_triggerdef(oid,true) as definition
  from pg_trigger where tgrelid='public.xrpl_collector_runs'::regclass and not tgisinternal
), table_policies as (
  select policyname as name,permissive,roles,cmd,qual,with_check
  from pg_policies where schemaname='public' and tablename='xrpl_collector_runs'
), table_privileges as (
  select grantee,privilege_type from information_schema.role_table_grants
  where table_schema='public' and table_name='xrpl_collector_runs'
), sequence_state as (
  select ns.nspname as schema_name,seq.relname as sequence_name,s.seqstart as start_value,s.seqincrement as increment_by,
         s.seqmin as min_value,s.seqmax as max_value,s.seqcache as cache_size,
         ps.last_value
  from pg_class seq
  join pg_namespace ns on ns.oid=seq.relnamespace
  join pg_sequence s on s.seqrelid=seq.oid
  join pg_sequences ps on ps.schemaname=ns.nspname and ps.sequencename=seq.relname
  join pg_depend d on d.objid=seq.oid and d.classid='pg_class'::regclass
  join pg_attribute a on a.attrelid=d.refobjid and a.attnum=d.refobjsubid
  where d.refobjid='public.xrpl_collector_runs'::regclass and a.attname='id' and d.deptype in ('a','i')
), routine_consumers as (
  select n.nspname as schema_name,p.proname as routine_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,p.prosecdef as security_definer,
         encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
         encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') as definition_sha256,
         p.prosrc
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosrc ilike '%xrpl_collector_runs%'
), dependent_views as (
  select distinct nv.nspname as schema_name,v.relname as view_name,v.relkind as relation_kind
  from pg_depend d
  join pg_rewrite rw on rw.oid=d.objid
  join pg_class v on v.oid=rw.ev_class
  join pg_namespace nv on nv.oid=v.relnamespace
  where d.refobjid='public.xrpl_collector_runs'::regclass and v.relkind in ('v','m')
), scheduler as (
  select jobid,schedule,active,encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex') as command_sha256
  from cron.job where jobname='xrpl-lending-monitor-minute'
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'relationBytes',pg_total_relation_size('${TABLE}'::regclass)::bigint,
  'heapBytes',pg_relation_size('${TABLE}'::regclass)::bigint,
  'indexBytes',pg_indexes_size('${TABLE}'::regclass)::bigint,
  'toastBytes',(select case when reltoastrelid=0 then 0 else pg_total_relation_size(reltoastrelid) end::bigint from pg_class where oid='${TABLE}'::regclass),
  'persistence',(select relpersistence from pg_class where oid='${TABLE}'::regclass),
  'rlsEnabled',(select relrowsecurity from pg_class where oid='${TABLE}'::regclass),
  'stats',(select jsonb_build_object('estimatedLiveRows',n_live_tup::bigint,'estimatedDeadRows',n_dead_tup::bigint,'lastVacuum',last_vacuum,'lastAutovacuum',last_autovacuum,'lastAnalyze',last_analyze,'lastAutoanalyze',last_autoanalyze,'vacuumCount',vacuum_count::bigint,'autovacuumCount',autovacuum_count::bigint) from pg_stat_user_tables where relid='${TABLE}'::regclass),
  'exactRows',(select count(*)::bigint from public.xrpl_collector_runs),
  'statusCounts',coalesce((select jsonb_object_agg(status,rows order by status) from status_counts),'{}'::jsonb),
  'oldestCompletedAt',(select min(completed_at) from public.xrpl_collector_runs),
  'newestCompletedAt',(select max(completed_at) from public.xrpl_collector_runs),
  'retention',jsonb_build_object(
    'retainLatestRows',${RETAIN_LATEST_ROWS},
    'retainedRows',(select count(*)::bigint from retained),
    'candidateRows',(select count(*)::bigint from candidates),
    'retainedOldestCompletedAt',(select min(completed_at) from retained),
    'candidateNewestCompletedAt',(select max(completed_at) from candidates),
    'retainedLogicalBytes',coalesce((select sum(pg_column_size(r))::bigint from retained r),0),
    'candidateLogicalBytes',coalesce((select sum(pg_column_size(r))::bigint from candidates r),0),
    'retainedDigest',coalesce((select md5(string_agg(md5((to_jsonb(r)-'retention_rank')::text),'' order by id)) from retained r),md5('')),
    'candidateDigest',coalesce((select md5(string_agg(md5((to_jsonb(r)-'retention_rank')::text),'' order by id)) from candidates r),md5('')),
    'retainedMinId',(select min(id)::bigint from retained),
    'retainedMaxId',(select max(id)::bigint from retained),
    'candidateMinId',(select min(id)::bigint from candidates),
    'candidateMaxId',(select max(id)::bigint from candidates)
  ),
  'columns',coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal_position) from table_columns x),'[]'::jsonb),
  'indexes',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_indexes x),'[]'::jsonb),
  'constraints',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_constraints x),'[]'::jsonb),
  'inboundForeignKeys',coalesce((select jsonb_agg(to_jsonb(x) order by x.source_table,x.name) from inbound_fks x),'[]'::jsonb),
  'userTriggers',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_triggers x),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_policies x),'[]'::jsonb),
  'privileges',coalesce((select jsonb_agg(to_jsonb(x) order by x.grantee,x.privilege_type) from table_privileges x),'[]'::jsonb),
  'sequences',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.sequence_name) from sequence_state x),'[]'::jsonb),
  'routineConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.routine_name,x.identity_arguments) from routine_consumers x),'[]'::jsonb),
  'dependentViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from dependent_views x),'[]'::jsonb),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb),
  'safety',jsonb_build_object('readOnly',true,'retentionMutationAuthorized',false,'physicalRewriteAuthorized',false,'sequenceMutationAuthorized',false,'schedulerMutationAuthorized',false,'deploymentAuthorized',false,'publicReaderMutationAuthorized',false,'mainnetDisabled',true,'r5RearmAuthorized',false)
)::text as state;`

if (!/^\s*with\b/iu.test(SQL)) fail('collector retention preflight must be SELECT-only CTE query')
const sqlWithoutStrings = SQL.replace(/'[^']*'/gu, "''")
for (const forbidden of [/\bdelete\s+from\b/iu,/\btruncate\b/iu,/\bvacuum\b/iu,/\breindex\b/iu,/\bcluster\b/iu,/\balter\s+table\b/iu,/\bdrop\s+/iu,/\bcreate\s+(?:table|index)\b/iu,/\bupdate\s+/iu,/\binsert\s+into\b/iu,/\bsetval\s*\(/iu]) {
  if (forbidden.test(sqlWithoutStrings)) fail(`collector retention preflight contains mutation capability: ${forbidden}`)
}

function validate(state) {
  if (Number(state.exactRows) < RETAIN_LATEST_ROWS) fail('collector run history is smaller than retain-latest boundary')
  if (Number(state.retention?.retainedRows) !== RETAIN_LATEST_ROWS) fail('collector retain-latest row count mismatch')
  if (Number(state.retention?.candidateRows) !== Number(state.exactRows)-RETAIN_LATEST_ROWS) fail('collector candidate row count mismatch')
  for (const key of ['retainedDigest','candidateDigest']) if (!/^[a-f0-9]{32}$/u.test(String(state.retention?.[key] ?? ''))) fail(`collector ${key} missing`)
  if (state.persistence !== 'p') fail('collector runs is not a permanent relation')
  if (!state.activeRun || state.activeRun.runId!==ACTIVE_RUN_ID || state.activeRun.status!=='halted' || state.activeRun.lastError!=='r5_recovery_database_halt' || state.activeRun.network!=='devnet' || Number(state.activeRun.profileRevision)!==4) fail('R5 database-halt boundary drifted')
  if (state.safety?.readOnly!==true || state.safety?.mainnetDisabled!==true) fail('collector read-only safety boundary missing')
  for (const key of ['retentionMutationAuthorized','physicalRewriteAuthorized','sequenceMutationAuthorized','schedulerMutationAuthorized','deploymentAuthorized','publicReaderMutationAuthorized','r5RearmAuthorized']) if (state.safety?.[key]!==false) fail(`unsafe collector authorization flag ${key}`)
}

const options = parse(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const state = firstState(await query(SQL))
validate(state)
const structural = {
  schemaVersion:1,
  purpose:'r5-collector-runs-retention-readonly-preflight-state',
  sourceCommit,
  projectIdentityDigest:sha256(env('SUPABASE_PROJECT_ID')),
  maxMigrationVersion:state.maxMigrationVersion,
  exactRows:Number(state.exactRows),
  relationBytes:Number(state.relationBytes),
  columns:state.columns,indexes:state.indexes,constraints:state.constraints,inboundForeignKeys:state.inboundForeignKeys,userTriggers:state.userTriggers,policies:state.policies,privileges:state.privileges,sequences:state.sequences,
  routineConsumerSources:state.routineConsumers.map((r)=>({schema_name:r.schema_name,routine_name:r.routine_name,identity_arguments:r.identity_arguments,source_sha256:r.source_sha256,definition_sha256:r.definition_sha256})),
  dependentViews:state.dependentViews,activeRun:state.activeRun,scheduler:state.scheduler,
  retention:state.retention,
}
const result={schemaVersion:1,purpose:'r5-collector-runs-retention-readonly-preflight',sourceCommit,...state,structuralStateSha256:sha256(JSON.stringify(structural)),structuralState:structural}
await writeJson(options.output,result)
process.stdout.write(`${JSON.stringify(result)}\n`)
