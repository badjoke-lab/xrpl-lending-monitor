#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const TABLE = 'public.xrpl_phase_messages'
const PKEY = 'public.xrpl_phase_messages_pkey'
const READY = 'public.xrpl_phase_messages_ready_idx'
const EXPECTED_MIGRATION_HEAD = '20260816050000'
const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'
const EXPECTED_PKEY_DEFINITION = 'CREATE UNIQUE INDEX xrpl_phase_messages_pkey ON public.xrpl_phase_messages USING btree (message_id)'
const EXPECTED_READY_DEFINITION = "CREATE INDEX xrpl_phase_messages_ready_idx ON public.xrpl_phase_messages USING btree (profile_id, status, available_at, created_at, message_id) WHERE (status = ANY (ARRAY['pending'::text, 'retry'::text, 'leased'::text]))"
const EXPECTED_PKEY_CONSTRAINT = 'PRIMARY KEY (message_id)'
const MAX_DATABASE_BYTES_BEFORE = 460_000_000
const MIN_PKEY_BYTES_BEFORE = 30_000_000
const MAX_PKEY_BYTES_BEFORE = 45_000_000
const MAX_READY_INDEX_BYTES = 1_000_000
const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000
const MAX_CONSERVATIVE_PEAK_BYTES = 480_000_000
const MAX_MESSAGE_ROWS = 60_000
const MAX_READY_ROWS = 100

function fail(message){ throw new Error(message) }
function sha256(value){ return createHash('sha256').update(String(value),'utf8').digest('hex') }
function sqlLiteral(value){ return `'${String(value).replaceAll("'","''")}'` }
function env(name,pattern=null){ const value=process.env[name]; if(!value) fail(`missing ${name}`); if(pattern&&!pattern.test(value)) fail(`invalid ${name}`); return value }
function parse(argv){ const [command,...rest]=argv; const options={}; for(let i=0;i<rest.length;i+=2){ const key=rest[i],value=rest[i+1]; if(!key?.startsWith('--')||value==null||value.startsWith('--')) fail(`invalid argument near ${key??'<end>'}`); options[key.slice(2)]=value } return {command,options} }
function validateSource(options){ const value=options['source-commit']; if(!/^[a-f0-9]{40}$/u.test(value??'')) fail('invalid --source-commit'); return value }
function rowsFromResponse(body){ if(Array.isArray(body)) return body; for(const candidate of [body?.result,body?.data,body?.rows,body?.result?.rows,body?.data?.rows]) if(Array.isArray(candidate)) return candidate; fail('Management API response contains no rows') }
async function query(sql,readOnly){
  const project=env('SUPABASE_PROJECT_ID',/^[a-z]{20}$/u), token=env('SUPABASE_ACCESS_TOKEN')
  const response=await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json',accept:'application/json'},body:JSON.stringify({query:sql,parameters:[],read_only:readOnly}),signal:AbortSignal.timeout(90_000)})
  const text=await response.text(); let body; try{body=JSON.parse(text)}catch{body={raw:text.slice(0,2000)}}
  if(!response.ok) fail(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0,2000)}`)
  return readOnly?rowsFromResponse(body):body
}
function firstJson(rows){ const raw=rows?.[0]?.state??rows?.[0]?.STATE; if(raw==null) fail('state row missing'); return typeof raw==='string'?JSON.parse(raw):raw }
async function writeJson(path,value){ if(!path) return; const absolute=resolve(path); await mkdir(dirname(absolute),{recursive:true}); await writeFile(absolute,`${JSON.stringify(value,null,2)}\n`) }

const INSPECTION_SQL=String.raw`with scheduler as (
  select jobid,schedule,active,encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex') as command_sha256
  from cron.job where jobname='xrpl-lending-monitor-minute'
), constraints as (
  select conname,contype::text as contype,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where conrelid='${TABLE}'::regclass
), row_hashes as (
  select message_id,encode(extensions.digest(convert_to(to_jsonb(m)::text,'UTF8'),'sha256'),'hex') as row_hash
  from public.xrpl_phase_messages m
), statuses as (
  select status,count(*)::bigint as rows from public.xrpl_phase_messages group by status
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'tableOid','${TABLE}'::regclass::oid,
  'tableHeapBytes',pg_relation_size('${TABLE}'::regclass)::bigint,
  'tableRows',(select count(*)::bigint from public.xrpl_phase_messages),
  'readyRows',(select count(*)::bigint from public.xrpl_phase_messages where status in ('pending','retry','leased')),
  'statusCounts',coalesce((select jsonb_object_agg(status,rows order by status) from statuses),'{}'::jsonb),
  'rowStateSha256',(select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash,'' order by message_id),''),'UTF8'),'sha256'),'hex') from row_hashes),
  'constraintDefinitions',coalesce((select jsonb_object_agg(conname,definition order by conname) from constraints),'{}'::jsonb),
  'constraintStateSha256',(select encode(extensions.digest(convert_to(coalesce(string_agg(conname||'|'||contype||'|'||definition,E'\\n' order by conname),''),'UTF8'),'sha256'),'hex') from constraints),
  'pkeyOid','${PKEY}'::regclass::oid,
  'pkeyBytes',pg_relation_size('${PKEY}'::regclass)::bigint,
  'pkeyDefinition',pg_get_indexdef('${PKEY}'::regclass),
  'pkeyValid',(select indisvalid from pg_index where indexrelid='${PKEY}'::regclass),
  'pkeyReady',(select indisready from pg_index where indexrelid='${PKEY}'::regclass),
  'pkeyUnique',(select indisunique from pg_index where indexrelid='${PKEY}'::regclass),
  'pkeyPrimary',(select indisprimary from pg_index where indexrelid='${PKEY}'::regclass),
  'pkeyScans',coalesce((select idx_scan::bigint from pg_stat_user_indexes where indexrelid='${PKEY}'::regclass),0),
  'readyOid','${READY}'::regclass::oid,
  'readyBytes',pg_relation_size('${READY}'::regclass)::bigint,
  'readyDefinition',pg_get_indexdef('${READY}'::regclass),
  'readyValid',(select indisvalid from pg_index where indexrelid='${READY}'::regclass),
  'readyReady',(select indisready from pg_index where indexrelid='${READY}'::regclass),
  'readyUnique',(select indisunique from pg_index where indexrelid='${READY}'::regclass),
  'readyPrimary',(select indisprimary from pg_index where indexrelid='${READY}'::regclass),
  'readyScans',coalesce((select idx_scan::bigint from pg_stat_user_indexes where indexrelid='${READY}'::regclass),0),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb)
)::text as state;`

function validateCommon(state){
  if(state.maxMigrationVersion!==EXPECTED_MIGRATION_HEAD) fail(`migration head drifted: ${state.maxMigrationVersion}`)
  if(state.pkeyDefinition!==EXPECTED_PKEY_DEFINITION||state.pkeyValid!==true||state.pkeyReady!==true||state.pkeyUnique!==true||state.pkeyPrimary!==true) fail('phase-message pkey definition/identity drifted')
  if(state.readyDefinition!==EXPECTED_READY_DEFINITION||state.readyValid!==true||state.readyReady!==true||state.readyUnique!==false||state.readyPrimary!==false) fail('phase-message ready index definition/identity drifted')
  if(state.constraintDefinitions?.xrpl_phase_messages_pkey!==EXPECTED_PKEY_CONSTRAINT) fail('phase-message primary-key constraint drifted')
  if(!state.activeRun||state.activeRun.runId!==ACTIVE_RUN_ID||state.activeRun.status!=='halted'||state.activeRun.lastError!=='r5_recovery_database_halt'||state.activeRun.network!=='devnet'||Number(state.activeRun.profileRevision)!==4) fail('R5 database-halt boundary drifted')
  if(!Array.isArray(state.scheduler)||state.scheduler.length!==1||state.scheduler[0].active!==true||state.scheduler[0].schedule!=='* * * * *'||state.scheduler[0].command_sha256!==EXPECTED_SCHEDULER_COMMAND_SHA) fail('scheduler boundary drifted')
  if(Number(state.tableRows)<=0||Number(state.tableRows)>MAX_MESSAGE_ROWS) fail('phase-message row count outside bounded range')
  if(Number(state.readyRows)<0||Number(state.readyRows)>MAX_READY_ROWS) fail('ready row count outside bounded range')
}
function validateBefore(state){
  validateCommon(state)
  if(Number(state.databaseBytes)>MAX_DATABASE_BYTES_BEFORE) fail('database above phase-message pkey reindex ceiling')
  if(Number(state.databaseBytes)+CONSERVATIVE_BUILD_OVERHEAD_BYTES>MAX_CONSERVATIVE_PEAK_BYTES) fail('phase-message pkey conservative peak ceiling exceeded')
  if(Number(state.pkeyBytes)<MIN_PKEY_BYTES_BEFORE||Number(state.pkeyBytes)>MAX_PKEY_BYTES_BEFORE) fail('phase-message pkey bytes outside authorized reclaim range')
  if(Number(state.readyBytes)<=0||Number(state.readyBytes)>MAX_READY_INDEX_BYTES) fail('ready index bytes outside safety range')
}
function structuralState(state,sourceCommit){ return {schemaVersion:1,purpose:'r5-phase-message-pkey-physical-reindex-structural-state',sourceCommit,projectIdentityDigest:sha256(env('SUPABASE_PROJECT_ID')),maxMigrationVersion:state.maxMigrationVersion,tableOid:Number(state.tableOid),pkeyOid:Number(state.pkeyOid),pkeyDefinition:state.pkeyDefinition,readyOid:Number(state.readyOid),readyDefinition:state.readyDefinition,constraintDefinitions:state.constraintDefinitions,constraintStateSha256:state.constraintStateSha256,activeRun:state.activeRun,scheduler:state.scheduler} }
function dataState(state){ return {schemaVersion:1,purpose:'r5-phase-message-pkey-physical-reindex-data-state',tableHeapBytes:Number(state.tableHeapBytes),tableRows:Number(state.tableRows),readyRows:Number(state.readyRows),statusCounts:state.statusCounts,rowStateSha256:state.rowStateSha256,pkeyBytes:Number(state.pkeyBytes),readyBytes:Number(state.readyBytes)} }
function mutationSql(expected){
  for(const key of ['tableRows','readyRows','tableHeapBytes','pkeyBytes','readyBytes']) if(!Number.isSafeInteger(Number(expected[key]))||Number(expected[key])<0) fail(`invalid mutation ${key}`)
  if(!/^[a-f0-9]{64}$/u.test(expected.rowStateSha256??'')||!/^[a-f0-9]{64}$/u.test(expected.constraintStateSha256??'')) fail('invalid mutation digest')
  return String.raw`begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-message-pkey-physical-reindex',0));
lock table public.xrpl_phase_messages in share mode;
do $r5$
declare current_rows bigint; current_ready_rows bigint; current_heap bigint; current_pkey_bytes bigint; current_ready_bytes bigint; current_pkey_definition text; current_ready_definition text; current_row_digest text; current_constraint_digest text; current_head text; current_scheduler_count bigint;
begin
  select count(*)::bigint,count(*) filter(where status in ('pending','retry','leased'))::bigint,pg_relation_size('${TABLE}'::regclass)::bigint into current_rows,current_ready_rows,current_heap from public.xrpl_phase_messages;
  select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash,'' order by message_id),''),'UTF8'),'sha256'),'hex') into current_row_digest from (select message_id,encode(extensions.digest(convert_to(to_jsonb(m)::text,'UTF8'),'sha256'),'hex') as row_hash from public.xrpl_phase_messages m) rows;
  select encode(extensions.digest(convert_to(coalesce(string_agg(conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true),E'\\n' order by conname),''),'UTF8'),'sha256'),'hex') into current_constraint_digest from pg_constraint where conrelid='${TABLE}'::regclass;
  select pg_relation_size('${PKEY}'::regclass)::bigint,pg_get_indexdef('${PKEY}'::regclass),pg_relation_size('${READY}'::regclass)::bigint,pg_get_indexdef('${READY}'::regclass) into current_pkey_bytes,current_pkey_definition,current_ready_bytes,current_ready_definition;
  select max(version::text) into current_head from supabase_migrations.schema_migrations;
  select count(*) into current_scheduler_count from cron.job where jobname='xrpl-lending-monitor-minute' and active=true and schedule='* * * * *' and encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex')='${EXPECTED_SCHEDULER_COMMAND_SHA}';
  if current_rows<>${Number(expected.tableRows)} or current_ready_rows<>${Number(expected.readyRows)} or current_heap<>${Number(expected.tableHeapBytes)} or current_pkey_bytes<>${Number(expected.pkeyBytes)} or current_ready_bytes<>${Number(expected.readyBytes)} or current_row_digest<>${sqlLiteral(expected.rowStateSha256)} then raise exception 'phase-message pkey authorized data drift under lock'; end if;
  if current_pkey_definition<>${sqlLiteral(EXPECTED_PKEY_DEFINITION)} or current_ready_definition<>${sqlLiteral(EXPECTED_READY_DEFINITION)} then raise exception 'phase-message index definition drift under lock'; end if;
  if current_constraint_digest<>${sqlLiteral(expected.constraintStateSha256)} then raise exception 'phase-message constraint state drift under lock'; end if;
  if current_head<>'${EXPECTED_MIGRATION_HEAD}' or current_scheduler_count<>1 then raise exception 'phase-message pkey structural boundary drift under lock'; end if;
  if not exists(select 1 from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}' and status='halted' and last_error='r5_recovery_database_halt' and network='devnet' and profile_revision=4) then raise exception 'R5 halt boundary drift under lock'; end if;
  if current_pkey_bytes<${MIN_PKEY_BYTES_BEFORE} or current_pkey_bytes>${MAX_PKEY_BYTES_BEFORE} or current_ready_bytes>${MAX_READY_INDEX_BYTES} or pg_database_size(current_database())>${MAX_DATABASE_BYTES_BEFORE} or pg_database_size(current_database())+${CONSERVATIVE_BUILD_OVERHEAD_BYTES}>${MAX_CONSERVATIVE_PEAK_BYTES} then raise exception 'phase-message pkey reindex safety ceiling exceeded under lock'; end if;
end $r5$;
reindex index public.xrpl_phase_messages_pkey;
commit;`
}

async function inspect(sourceCommit,before=true){ const state=firstJson(await query(INSPECTION_SQL,true)); if(before) validateBefore(state); else validateCommon(state); const structural=structuralState(state,sourceCommit), data=dataState(state); const mutation=mutationSql({...data,constraintStateSha256:state.constraintStateSha256}); const structuralSha=sha256(JSON.stringify(structural)),dataSha=sha256(JSON.stringify(data)),mutationSha=sha256(mutation); const plan={schemaVersion:1,purpose:'r5-phase-message-pkey-physical-reindex-plan',sourceCommit,structuralStateSha256:structuralSha,dataStateSha256:dataSha,mutationSha256:mutationSha,maxDatabaseBytesBefore:MAX_DATABASE_BYTES_BEFORE,minPkeyBytesBefore:MIN_PKEY_BYTES_BEFORE,maxPkeyBytesBefore:MAX_PKEY_BYTES_BEFORE,maxReadyIndexBytes:MAX_READY_INDEX_BYTES,conservativeBuildOverheadBytes:CONSERVATIVE_BUILD_OVERHEAD_BYTES,maxConservativePeakBytes:MAX_CONSERVATIVE_PEAK_BYTES,lockMode:'SHARE',lockRevalidation:true}; return {...state,structuralState:structural,structuralStateSha256:structuralSha,dataState:data,dataStateSha256:dataSha,mutation:{sha256:mutationSha,lockTimeoutSeconds:5,statementTimeoutSeconds:120,lockRevalidation:true},plan,planSha256:sha256(JSON.stringify(plan)),rowMutationAuthorized:false,vacuumAuthorized:false,schedulerMutationAuthorized:false,deploymentAuthorized:false,publicReaderMutationAuthorized:false,mainnetDisabled:true,r5RearmAuthorized:false} }

async function prepare(options){ const sourceCommit=validateSource(options); const result=await inspect(sourceCommit,true); await writeJson(options.output,result); console.log(JSON.stringify(result)) }
async function apply(options){
  const sourceCommit=validateSource(options); const authorizedState=options['authorized-state'],authorizedData=options['authorized-data'],authorizedPlan=options['authorized-plan'],authorizedMutation=options['authorized-mutation']; for(const [name,value] of [['authorized-state',authorizedState],['authorized-data',authorizedData],['authorized-plan',authorizedPlan],['authorized-mutation',authorizedMutation]]) if(!/^[a-f0-9]{64}$/u.test(value??'')) fail(`invalid --${name}`)
  const before=await inspect(sourceCommit,true)
  if(before.structuralStateSha256!==authorizedState) fail('authorized structural state mismatch')
  if(before.dataStateSha256!==authorizedData) fail('authorized data state mismatch')
  if(before.planSha256!==authorizedPlan) fail('authorized plan mismatch')
  const mutation=mutationSql({...before.dataState,constraintStateSha256:before.constraintStateSha256}); if(sha256(mutation)!==authorizedMutation) fail('authorized mutation mismatch')
  await query(mutation,false)
  const after=await inspect(sourceCommit,false)
  if(after.structuralStateSha256!==before.structuralStateSha256) fail('post-reindex structural state mismatch')
  if(Number(after.tableRows)!==Number(before.tableRows)||Number(after.readyRows)!==Number(before.readyRows)||JSON.stringify(after.statusCounts)!==JSON.stringify(before.statusCounts)||after.rowStateSha256!==before.rowStateSha256||after.constraintStateSha256!==before.constraintStateSha256) fail('post-reindex phase-message row/constraint state mismatch')
  if(Number(after.tableHeapBytes)!==Number(before.tableHeapBytes)) fail('post-reindex phase-message heap changed')
  if(Number(after.readyOid)!==Number(before.readyOid)||Number(after.readyBytes)!==Number(before.readyBytes)||after.readyDefinition!==before.readyDefinition) fail('post-reindex ready index changed')
  if(Number(after.pkeyOid)!==Number(before.pkeyOid)||after.pkeyDefinition!==before.pkeyDefinition) fail('post-reindex pkey identity changed')
  if(Number(after.pkeyBytes)>=Number(before.pkeyBytes)) fail('phase-message pkey bytes were not reclaimed')
  if(Number(after.databaseBytes)>=Number(before.databaseBytes)) fail('database bytes were not reclaimed')
  const result={schemaVersion:1,purpose:'r5-phase-message-pkey-physical-reindex-apply',sourceCommit,structuralStateSha256:authorizedState,dataStateSha256:authorizedData,planSha256:authorizedPlan,mutationSha256:authorizedMutation,tableRowsBefore:Number(before.tableRows),tableRowsAfter:Number(after.tableRows),readyRowsBefore:Number(before.readyRows),readyRowsAfter:Number(after.readyRows),tableHeapBytesBefore:Number(before.tableHeapBytes),tableHeapBytesAfter:Number(after.tableHeapBytes),pkeyBytesBefore:Number(before.pkeyBytes),pkeyBytesAfter:Number(after.pkeyBytes),pkeyBytesReclaimed:Number(before.pkeyBytes)-Number(after.pkeyBytes),readyIndexBytesBefore:Number(before.readyBytes),readyIndexBytesAfter:Number(after.readyBytes),databaseBytesBefore:Number(before.databaseBytes),databaseBytesAfter:Number(after.databaseBytes),databaseBytesReclaimed:Number(before.databaseBytes)-Number(after.databaseBytes),rowStateSha256:before.rowStateSha256,constraintStateSha256:before.constraintStateSha256,pkeyOid:Number(before.pkeyOid),readyOid:Number(before.readyOid),pkeyOidPreserved:true,readyIndexPreserved:true,rowMutationPerformed:false,vacuumPerformed:false,schedulerMutationPerformed:false,deploymentPerformed:false,publicReaderMutationPerformed:false,mainnetMutationPerformed:false,r5RearmPerformed:false}
  await writeJson(options.output,result); console.log(JSON.stringify(result))
}
async function verify(options){
  const sourceCommit=validateSource(options), evidencePath=options['apply-evidence']; if(!evidencePath) fail('missing --apply-evidence'); const evidence=JSON.parse(await readFile(resolve(evidencePath),'utf8')); if(evidence.sourceCommit!==sourceCommit||evidence.purpose!=='r5-phase-message-pkey-physical-reindex-apply') fail('invalid apply evidence')
  const current=await inspect(sourceCommit,false)
  if(current.structuralStateSha256!==evidence.structuralStateSha256) fail('independent verify structural state mismatch')
  if(Number(current.tableRows)!==Number(evidence.tableRowsAfter)||Number(current.readyRows)!==Number(evidence.readyRowsAfter)||Number(current.tableHeapBytes)!==Number(evidence.tableHeapBytesAfter)||current.rowStateSha256!==evidence.rowStateSha256||current.constraintStateSha256!==evidence.constraintStateSha256) fail('independent verify row/heap/digest mismatch')
  if(Number(current.pkeyOid)!==Number(evidence.pkeyOid)||Number(current.readyOid)!==Number(evidence.readyOid)||Number(current.pkeyBytes)!==Number(evidence.pkeyBytesAfter)||Number(current.readyBytes)!==Number(evidence.readyIndexBytesAfter)) fail('independent verify index state mismatch')
  const result={schemaVersion:1,purpose:'r5-phase-message-pkey-physical-reindex-independent-verify',sourceCommit,productionReadOnly:true,verified:true,databaseBytes:Number(current.databaseBytes),tableRows:Number(current.tableRows),tableHeapBytes:Number(current.tableHeapBytes),pkeyBytes:Number(current.pkeyBytes),readyIndexBytes:Number(current.readyBytes),rowStateSha256:current.rowStateSha256,constraintStateSha256:current.constraintStateSha256,rowMutationPerformed:false,vacuumPerformed:false,schedulerMutationPerformed:false,r5RearmPerformed:false}; await writeJson(options.output,result); console.log(JSON.stringify(result))
}

const {command,options}=parse(process.argv.slice(2))
if(command==='prepare') await prepare(options)
else if(command==='apply') await apply(options)
else if(command==='verify') await verify(options)
else fail('expected prepare, apply, or verify')
