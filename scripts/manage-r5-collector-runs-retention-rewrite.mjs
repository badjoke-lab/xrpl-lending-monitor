#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID='r5-recovery-selected-revision4-minute2-entry'
const TABLE='public.xrpl_collector_runs'
const RETAIN_LATEST_ROWS=256
const EXPECTED_MIGRATION_HEAD='20260816050000'
const EXPECTED_SCHEDULER_COMMAND_SHA='98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'
const MAX_DATABASE_BYTES_BEFORE=490_000_000

function fail(message){ throw new Error(message) }
function sha256(value){ return createHash('sha256').update(String(value),'utf8').digest('hex') }
function env(name,pattern=null){ const value=process.env[name]; if(!value) fail(`missing ${name}`); if(pattern&&!pattern.test(value)) fail(`invalid ${name}`); return value }
function parse(argv){ const [command,...rest]=argv; const options={}; for(let i=0;i<rest.length;i+=2){ const key=rest[i],value=rest[i+1]; if(!key?.startsWith('--')||value==null||value.startsWith('--')) fail(`invalid argument near ${key??'<end>'}`); options[key.slice(2)]=value } return {command,options} }
function validateSource(options){ const sourceCommit=options['source-commit']; if(!/^[a-f0-9]{40}$/u.test(sourceCommit??'')) fail('invalid --source-commit'); return sourceCommit }
function rowsFromResponse(body){ if(Array.isArray(body)) return body; for(const candidate of [body?.result,body?.data,body?.rows,body?.result?.rows,body?.data?.rows]) if(Array.isArray(candidate)) return candidate; fail('Management API response contains no rows') }
async function managementQuery(query,readOnly){
  const project=env('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u),token=env('SUPABASE_ACCESS_TOKEN')
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({query,parameters:[],read_only:readOnly}),signal:AbortSignal.timeout(120_000)})
  const text=await response.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text.slice(0,2000)}}
  if(!response.ok) fail(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0,2000)}`)
  return readOnly?rowsFromResponse(body):body
}
function firstJson(rows,key='state'){ const raw=rows?.[0]?.[key]??rows?.[0]?.[key.toUpperCase()]; if(raw==null) fail(`${key} row missing`); return typeof raw==='string'?JSON.parse(raw):raw }
async function writeJson(path,value){ if(!path) return; const absolute=resolve(path); await mkdir(dirname(absolute),{recursive:true}); await writeFile(absolute,`${JSON.stringify(value,null,2)}\n`) }
const rowDigest=(alias)=>`encode(extensions.digest(convert_to(coalesce(string_agg(encode(extensions.digest(convert_to(to_jsonb(${alias})::text,'UTF8'),'sha256'),'hex'),'' order by ${alias}.id),''),'UTF8'),'sha256'),'hex')`

function inspectionSql(){ return String.raw`with ranked as (
  select r.*,row_number() over(order by completed_at desc,id desc) as retention_rank from public.xrpl_collector_runs r
), retained as (
  select * from ranked where retention_rank<=${RETAIN_LATEST_ROWS}
), candidates as (
  select * from ranked where retention_rank>${RETAIN_LATEST_ROWS}
), table_columns as (
  select ordinal_position,column_name,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation,is_generated,generation_expression
  from information_schema.columns where table_schema='public' and table_name='xrpl_collector_runs'
), table_indexes as (
  select i.relname as name,x.indisprimary as primary_index,x.indisunique as unique_index,x.indisvalid as valid,x.indisready as ready,pg_get_indexdef(i.oid) as definition
  from pg_index x join pg_class i on i.oid=x.indexrelid where x.indrelid='public.xrpl_collector_runs'::regclass
), table_constraints as (
  select conname as name,contype as type,convalidated as validated,condeferrable as deferrable,condeferred as deferred,
         case when confrelid=0 then null else confrelid::regclass::text end as referenced_table,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where conrelid='public.xrpl_collector_runs'::regclass
), inbound_fks as (
  select conrelid::regclass::text as source_table,conname as name,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where contype='f' and confrelid='public.xrpl_collector_runs'::regclass
), table_triggers as (
  select tgname as name,tgenabled as enabled,pg_get_triggerdef(oid,true) as definition
  from pg_trigger where tgrelid='public.xrpl_collector_runs'::regclass and not tgisinternal
), table_policies as (
  select policyname as name,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='xrpl_collector_runs'
), table_privileges as (
  select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='xrpl_collector_runs'
), routine_consumers as (
  select n.nspname as schema_name,p.proname as routine_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,
         encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prosrc ilike '%xrpl_collector_runs%'
), dependent_views as (
  select distinct nv.nspname as schema_name,v.relname as view_name,v.relkind as relation_kind
  from pg_depend d join pg_rewrite rw on rw.oid=d.objid join pg_class v on v.oid=rw.ev_class join pg_namespace nv on nv.oid=v.relnamespace
  where d.refobjid='public.xrpl_collector_runs'::regclass and v.relkind in ('v','m')
), scheduler as (
  select jobid,schedule,active,encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex') as command_sha256
  from cron.job where jobname='xrpl-lending-monitor-minute'
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'relationOid','public.xrpl_collector_runs'::regclass::oid,
  'relationBytes',pg_total_relation_size('${TABLE}'::regclass)::bigint,
  'heapBytes',pg_relation_size('${TABLE}'::regclass)::bigint,
  'indexBytes',pg_indexes_size('${TABLE}'::regclass)::bigint,
  'toastBytes',(select case when reltoastrelid=0 then 0 else pg_total_relation_size(reltoastrelid) end::bigint from pg_class where oid='${TABLE}'::regclass),
  'persistence',(select relpersistence from pg_class where oid='${TABLE}'::regclass),
  'rlsEnabled',(select relrowsecurity from pg_class where oid='${TABLE}'::regclass),
  'exactRows',(select count(*)::bigint from public.xrpl_collector_runs),
  'retainedRows',(select count(*)::bigint from retained),
  'candidateRows',(select count(*)::bigint from candidates),
  'retainedDigest',(select ${rowDigest('r')} from retained r),
  'candidateDigest',(select ${rowDigest('r')} from candidates r),
  'retainedMinId',(select min(id)::bigint from retained),
  'retainedMaxId',(select max(id)::bigint from retained),
  'candidateMinId',(select min(id)::bigint from candidates),
  'candidateMaxId',(select max(id)::bigint from candidates),
  'retainedLogicalBytes',coalesce((select sum(pg_column_size(r))::bigint from retained r),0),
  'candidateLogicalBytes',coalesce((select sum(pg_column_size(r))::bigint from candidates r),0),
  'sequenceState',(select jsonb_build_object('lastValue',last_value,'isCalled',is_called) from public.xrpl_collector_runs_id_seq),
  'columns',coalesce((select jsonb_agg(to_jsonb(x) order by x.ordinal_position) from table_columns x),'[]'::jsonb),
  'indexes',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_indexes x),'[]'::jsonb),
  'constraints',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_constraints x),'[]'::jsonb),
  'inboundForeignKeys',coalesce((select jsonb_agg(to_jsonb(x) order by x.source_table,x.name) from inbound_fks x),'[]'::jsonb),
  'userTriggers',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_triggers x),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from table_policies x),'[]'::jsonb),
  'privileges',coalesce((select jsonb_agg(to_jsonb(x) order by x.grantee,x.privilege_type) from table_privileges x),'[]'::jsonb),
  'routineConsumers',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.routine_name,x.identity_arguments) from routine_consumers x),'[]'::jsonb),
  'dependentViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from dependent_views x),'[]'::jsonb),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb)
)::text as state;` }

function validateCommon(state){
  if(state.persistence!=='p'||state.rlsEnabled!==true) fail('collector relation persistence/RLS drifted')
  if(!Array.isArray(state.inboundForeignKeys)||state.inboundForeignKeys.length!==0) fail('collector inbound foreign keys are not authorized')
  if(!Array.isArray(state.userTriggers)||state.userTriggers.length!==0) fail('collector user triggers are not authorized')
  if(!Array.isArray(state.dependentViews)||state.dependentViews.length!==0) fail('collector dependent views are not authorized')
  if(state.maxMigrationVersion!==EXPECTED_MIGRATION_HEAD) fail(`migration head drifted: ${state.maxMigrationVersion}`)
  if(!state.activeRun||state.activeRun.runId!==ACTIVE_RUN_ID||state.activeRun.status!=='halted'||state.activeRun.lastError!=='r5_recovery_database_halt'||state.activeRun.network!=='devnet'||Number(state.activeRun.profileRevision)!==4) fail('R5 database-halt boundary drifted')
  if(!Array.isArray(state.scheduler)||state.scheduler.length!==1||state.scheduler[0].active!==true||state.scheduler[0].schedule!=='* * * * *'||state.scheduler[0].command_sha256!==EXPECTED_SCHEDULER_COMMAND_SHA) fail('scheduler boundary drifted')
  if(!state.sequenceState||Number(state.sequenceState.lastValue)<=0||state.sequenceState.isCalled!==true) fail('collector identity sequence state invalid')
  if(!Array.isArray(state.columns)||!state.columns.some((c)=>c.column_name==='id'&&c.is_identity==='YES'&&c.identity_generation==='ALWAYS')) fail('collector identity column drifted')
}
function validateBefore(state){ validateCommon(state); if(Number(state.databaseBytes)>MAX_DATABASE_BYTES_BEFORE) fail('database is above collector rewrite pre-apply ceiling'); if(Number(state.exactRows)<=RETAIN_LATEST_ROWS) fail('collector history has no retention candidates'); if(Number(state.retainedRows)!==RETAIN_LATEST_ROWS) fail('collector retained row count mismatch'); if(Number(state.candidateRows)!==Number(state.exactRows)-RETAIN_LATEST_ROWS) fail('collector candidate count mismatch'); for(const key of ['retainedDigest','candidateDigest']) if(!/^[a-f0-9]{64}$/u.test(String(state[key]??''))) fail(`${key} missing`) }
function validateAfter(state){ validateCommon(state); if(Number(state.exactRows)!==RETAIN_LATEST_ROWS||Number(state.retainedRows)!==RETAIN_LATEST_ROWS||Number(state.candidateRows)!==0) fail('collector post-rewrite row boundary mismatch'); if(!/^[a-f0-9]{64}$/u.test(String(state.retainedDigest??''))) fail('collector post-rewrite retained digest missing') }
function structuralState(state,sourceCommit){ return {schemaVersion:1,purpose:'r5-collector-runs-retention-rewrite-structural-state',sourceCommit,projectIdentityDigest:sha256(env('SUPABASE_PROJECT_ID')),maxMigrationVersion:state.maxMigrationVersion,relationOid:Number(state.relationOid),persistence:state.persistence,rlsEnabled:state.rlsEnabled,columns:state.columns,indexes:state.indexes,constraints:state.constraints,inboundForeignKeys:state.inboundForeignKeys,userTriggers:state.userTriggers,policies:state.policies,privileges:state.privileges,routineConsumers:state.routineConsumers,dependentViews:state.dependentViews,activeRun:state.activeRun,scheduler:state.scheduler} }
function dataState(state){ return {schemaVersion:1,purpose:'r5-collector-runs-retention-rewrite-data-state',exactRows:Number(state.exactRows),relationBytes:Number(state.relationBytes),retainedRows:Number(state.retainedRows),candidateRows:Number(state.candidateRows),retainedDigest:state.retainedDigest,candidateDigest:state.candidateDigest,retainedMinId:Number(state.retainedMinId),retainedMaxId:Number(state.retainedMaxId),candidateMinId:Number(state.candidateMinId),candidateMaxId:Number(state.candidateMaxId),retainedLogicalBytes:Number(state.retainedLogicalBytes),candidateLogicalBytes:Number(state.candidateLogicalBytes),sequenceState:state.sequenceState} }
function assertDataStateForMutation(data){
  for(const key of ['exactRows','retainedRows','candidateRows','retainedMinId','retainedMaxId','candidateMinId','candidateMaxId']) if(!Number.isSafeInteger(Number(data[key]))||Number(data[key])<0) fail(`invalid mutation data ${key}`)
  for(const key of ['retainedDigest','candidateDigest']) if(!/^[a-f0-9]{64}$/u.test(String(data[key]??''))) fail(`invalid mutation data ${key}`)
  if(Number(data.retainedRows)!==RETAIN_LATEST_ROWS||Number(data.candidateRows)!==Number(data.exactRows)-RETAIN_LATEST_ROWS) fail('mutation data row partition mismatch')
  if(!data.sequenceState||!Number.isSafeInteger(Number(data.sequenceState.lastValue))||Number(data.sequenceState.lastValue)<=0||data.sequenceState.isCalled!==true) fail('invalid mutation sequence state')
}

function mutationSql(expected){
  assertDataStateForMutation(expected)
  return String.raw`begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('xrpl-collector-runs-retention-rewrite',0));
lock table public.xrpl_collector_runs in access exclusive mode;
create temporary table r5_collector_authorized on commit drop as
select
  ${Number(expected.exactRows)}::bigint as exact_rows,
  ${Number(expected.retainedRows)}::bigint as retained_rows,
  ${Number(expected.candidateRows)}::bigint as candidate_rows,
  '${expected.retainedDigest}'::text as retained_digest,
  '${expected.candidateDigest}'::text as candidate_digest,
  ${Number(expected.retainedMinId)}::bigint as retained_min_id,
  ${Number(expected.retainedMaxId)}::bigint as retained_max_id,
  ${Number(expected.candidateMinId)}::bigint as candidate_min_id,
  ${Number(expected.candidateMaxId)}::bigint as candidate_max_id,
  ${Number(expected.sequenceState.lastValue)}::bigint as sequence_last_value,
  true::boolean as sequence_is_called;
do $r5$
declare
  e record; actual_rows bigint; actual_retained_rows bigint; actual_candidate_rows bigint;
  actual_retained_digest text; actual_candidate_digest text; actual_retained_min bigint; actual_retained_max bigint;
  actual_candidate_min bigint; actual_candidate_max bigint; seq_last bigint; seq_called boolean;
begin
  select * into strict e from r5_collector_authorized;
  with ranked as (select r.*,row_number() over(order by completed_at desc,id desc) as retention_rank from public.xrpl_collector_runs r),
  retained as (select * from ranked where retention_rank<=${RETAIN_LATEST_ROWS}),
  candidates as (select * from ranked where retention_rank>${RETAIN_LATEST_ROWS})
  select (select count(*)::bigint from ranked),(select count(*)::bigint from retained),(select count(*)::bigint from candidates),
    (select ${rowDigest('r')} from retained r),(select ${rowDigest('r')} from candidates r),
    (select min(id)::bigint from retained),(select max(id)::bigint from retained),(select min(id)::bigint from candidates),(select max(id)::bigint from candidates)
  into actual_rows,actual_retained_rows,actual_candidate_rows,actual_retained_digest,actual_candidate_digest,actual_retained_min,actual_retained_max,actual_candidate_min,actual_candidate_max;
  select last_value,is_called into seq_last,seq_called from public.xrpl_collector_runs_id_seq;
  if actual_rows<>e.exact_rows or actual_retained_rows<>e.retained_rows or actual_candidate_rows<>e.candidate_rows
    or actual_retained_digest<>e.retained_digest or actual_candidate_digest<>e.candidate_digest
    or actual_retained_min<>e.retained_min_id or actual_retained_max<>e.retained_max_id
    or actual_candidate_min<>e.candidate_min_id or actual_candidate_max<>e.candidate_max_id
    or seq_last<>e.sequence_last_value or seq_called is distinct from e.sequence_is_called then
    raise exception 'collector authorized data state drift under lock';
  end if;
end $r5$;
create temporary table r5_collector_retained on commit drop as
  select * from public.xrpl_collector_runs order by completed_at desc,id desc limit ${RETAIN_LATEST_ROWS};
create temporary table r5_collector_expected on commit drop as
select (select count(*)::bigint from r5_collector_retained) as retained_rows,
  (select ${rowDigest('r')} from r5_collector_retained r) as retained_digest,
  (select min(id)::bigint from r5_collector_retained) as min_id,
  (select max(id)::bigint from r5_collector_retained) as max_id,
  (select last_value::bigint from public.xrpl_collector_runs_id_seq) as sequence_last_value,
  (select is_called from public.xrpl_collector_runs_id_seq) as sequence_is_called;
truncate table public.xrpl_collector_runs;
insert into public.xrpl_collector_runs(id,profile_id,invocation_id,lease_owner,source,status,started_at,completed_at,validated_ledger_index,validated_ledger_hash,error_message,created_at) overriding system value
select id,profile_id,invocation_id,lease_owner,source,status,started_at,completed_at,validated_ledger_index,validated_ledger_hash,error_message,created_at from r5_collector_retained order by id;
do $r5$
declare e record; actual_rows bigint; actual_digest text; actual_min bigint; actual_max bigint; seq_last bigint; seq_called boolean;
begin
  select * into strict e from r5_collector_expected;
  select count(*)::bigint,${rowDigest('r')},min(id)::bigint,max(id)::bigint into actual_rows,actual_digest,actual_min,actual_max from public.xrpl_collector_runs r;
  select last_value,is_called into seq_last,seq_called from public.xrpl_collector_runs_id_seq;
  if actual_rows<>e.retained_rows or actual_digest<>e.retained_digest or actual_min<>e.min_id or actual_max<>e.max_id then raise exception 'collector retained identity mismatch after rewrite'; end if;
  if seq_last<>e.sequence_last_value or seq_called is distinct from e.sequence_is_called then raise exception 'collector identity sequence drift after rewrite'; end if;
end $r5$;
commit;`
}

const MUTATION_CONTRACT_SAMPLE=mutationSql({exactRows:21329,retainedRows:256,candidateRows:21073,retainedDigest:'a'.repeat(64),candidateDigest:'b'.repeat(64),retainedMinId:21074,retainedMaxId:21329,candidateMinId:1,candidateMaxId:21073,sequenceState:{lastValue:21329,isCalled:true}})
for(const required of ["set local lock_timeout='5s'","set local statement_timeout='45s'","lock table public.xrpl_collector_runs in access exclusive mode","collector authorized data state drift under lock","limit 256","truncate table public.xrpl_collector_runs","overriding system value","collector retained identity mismatch after rewrite","collector identity sequence drift after rewrite"]) if(!MUTATION_CONTRACT_SAMPLE.includes(required)) fail(`collector mutation contract missing: ${required}`)
if((MUTATION_CONTRACT_SAMPLE.match(/\btruncate\s+table\b/giu)??[]).length!==1) fail('collector mutation must contain exactly one TRUNCATE')
for(const forbidden of [/\bdelete\s+from\b/iu,/\brestart\s+identity\b/iu,/\bcascade\b/iu,/\bvacuum\b/iu,/\breindex\b/iu,/\bcluster\b/iu,/\bcron\./iu,/\bmainnet\b/iu,/\bxrpl_phase_messages\b/iu,/\bxrpl_phase_successors\b/iu,/\bxrpl_phase_work\b/iu]) if(forbidden.test(MUTATION_CONTRACT_SAMPLE)) fail(`collector mutation contains forbidden capability: ${forbidden}`)

async function inspect(sourceCommit,after=false){
  const state=firstJson(await managementQuery(inspectionSql(),true))
  if(after) validateAfter(state)
  else validateBefore(state)
  const structural=structuralState(state,sourceCommit),data=dataState(state),structuralSha=sha256(JSON.stringify(structural)),dataSha=sha256(JSON.stringify(data))
  const exactMutation=mutationSql(data),mutationSha=sha256(exactMutation)
  const plan={schemaVersion:2,purpose:'r5-collector-runs-retention-rewrite-plan',sourceCommit,retainLatestRows:RETAIN_LATEST_ROWS,structuralStateSha256:structuralSha,dataStateSha256:dataSha,mutationSha256:mutationSha,maxDatabaseBytesBefore:MAX_DATABASE_BYTES_BEFORE,transactionLockRevalidation:true}
  return {...state,structuralState:structural,structuralStateSha256:structuralSha,dataState:data,dataStateSha256:dataSha,mutation:{sha256:mutationSha,retainLatestRows:RETAIN_LATEST_ROWS,lockTimeoutSeconds:5,statementTimeoutSeconds:45,transactionLockRevalidation:true},plan,planSha256:sha256(JSON.stringify(plan)),retentionMutationAuthorized:false,physicalRewriteAuthorized:false,sequenceMutationAuthorized:false,schedulerMutationAuthorized:false,deploymentAuthorized:false,publicReaderMutationAuthorized:false,mainnetDisabled:true,r5RearmAuthorized:false}
}
async function prepare(options){ const sourceCommit=validateSource(options); const result=await inspect(sourceCommit,false); await writeJson(options.output,result); console.log(JSON.stringify(result)) }
async function apply(options){
  const sourceCommit=validateSource(options),authorizedState=options['authorized-state'],authorizedData=options['authorized-data'],authorizedPlan=options['authorized-plan'],authorizedMutation=options['authorized-mutation']
  for(const [name,value] of [['authorized-state',authorizedState],['authorized-data',authorizedData],['authorized-plan',authorizedPlan],['authorized-mutation',authorizedMutation]]) if(!/^[a-f0-9]{64}$/u.test(value??'')) fail(`invalid --${name}`)
  const before=await inspect(sourceCommit,false)
  if(before.structuralStateSha256!==authorizedState) fail('authorized structural state mismatch')
  if(before.dataStateSha256!==authorizedData) fail('authorized data state mismatch')
  if(before.planSha256!==authorizedPlan) fail('authorized plan mismatch')
  const exactMutation=mutationSql(before.dataState)
  if(sha256(exactMutation)!==authorizedMutation||before.mutation.sha256!==authorizedMutation) fail('authorized mutation mismatch')
  await managementQuery(exactMutation,false)
  const after=await inspect(sourceCommit,true)
  if(after.structuralStateSha256!==before.structuralStateSha256) fail('post-rewrite structural state mismatch')
  if(Number(after.exactRows)!==RETAIN_LATEST_ROWS||after.retainedDigest!==before.retainedDigest||Number(after.retainedMinId)!==Number(before.retainedMinId)||Number(after.retainedMaxId)!==Number(before.retainedMaxId)) fail('post-rewrite retained row identity mismatch')
  if(Number(after.candidateRows)!==0) fail('post-rewrite candidate rows remain')
  if(JSON.stringify(after.sequenceState)!==JSON.stringify(before.sequenceState)) fail('post-rewrite sequence state mismatch')
  if(Number(after.relationBytes)>=Number(before.relationBytes)) fail('collector relation bytes were not reclaimed')
  if(Number(after.databaseBytes)>=Number(before.databaseBytes)) fail('database bytes were not reclaimed')
  const result={schemaVersion:2,purpose:'r5-collector-runs-retention-rewrite-apply',sourceCommit,structuralStateSha256:authorizedState,dataStateSha256:authorizedData,planSha256:authorizedPlan,mutationSha256:authorizedMutation,transactionLockRevalidationPerformed:true,rowsBefore:Number(before.exactRows),rowsAfter:Number(after.exactRows),retainedDigestBefore:before.retainedDigest,retainedDigestAfter:after.retainedDigest,retainedMinId:Number(after.retainedMinId),retainedMaxId:Number(after.retainedMaxId),sequenceBefore:before.sequenceState,sequenceAfter:after.sequenceState,relationBytesBefore:Number(before.relationBytes),relationBytesAfter:Number(after.relationBytes),relationBytesReclaimed:Number(before.relationBytes)-Number(after.relationBytes),databaseBytesBefore:Number(before.databaseBytes),databaseBytesAfter:Number(after.databaseBytes),databaseBytesReclaimed:Number(before.databaseBytes)-Number(after.databaseBytes),activeRunBefore:before.activeRun,activeRunAfter:after.activeRun,schedulerBefore:before.scheduler,schedulerAfter:after.scheduler,retentionMutationPerformed:true,physicalRewritePerformed:true,sequenceMutationPerformed:false,schedulerMutationPerformed:false,deploymentPerformed:false,publicReaderMutationPerformed:false,mainnetDisabled:true,r5RearmPerformed:false}
  await writeJson(options.output,result); console.log(JSON.stringify(result))
}

const {command,options}=parse(process.argv.slice(2))
if(command==='prepare') await prepare(options)
else if(command==='apply') await apply(options)
else fail('usage: manage-r5-collector-runs-retention-rewrite.mjs <prepare|apply> --source-commit <sha> [...]')