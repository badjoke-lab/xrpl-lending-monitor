#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const TABLE = 'public.xrpl_phase_successors'
const EXPECTED_MIGRATION_HEAD = '20260816050000'
const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'
const MAX_DATABASE_BYTES_BEFORE = 474_000_000
const MAX_TARGET_INDEX_BYTES_BEFORE = 32_000_000
const MIN_TARGET_INDEX_BYTES_BEFORE = 16_000_000
const LOCAL_COMPACT_BUILD_BYTES = 14_336_000
const CONSERVATIVE_BUILD_OVERHEAD_BYTES = 16_000_000
const MAX_CONSERVATIVE_PEAK_BYTES = 490_000_000
const MAX_SUCCESSOR_ROWS = 60_000

const TARGETS = Object.freeze({
  pkey: Object.freeze({
    key: 'pkey',
    index: 'public.xrpl_phase_successors_pkey',
    constraintName: 'xrpl_phase_successors_pkey',
    expectedDefinition: 'CREATE UNIQUE INDEX xrpl_phase_successors_pkey ON public.xrpl_phase_successors USING btree (current_message_id)',
    expectedConstraint: 'PRIMARY KEY (current_message_id)',
    reindexSql: 'reindex index public.xrpl_phase_successors_pkey;',
  }),
  successor_unique: Object.freeze({
    key: 'successor_unique',
    index: 'public.xrpl_phase_successors_successor_message_id_key',
    constraintName: 'xrpl_phase_successors_successor_message_id_key',
    expectedDefinition: 'CREATE UNIQUE INDEX xrpl_phase_successors_successor_message_id_key ON public.xrpl_phase_successors USING btree (successor_message_id)',
    expectedConstraint: 'UNIQUE (successor_message_id)',
    reindexSql: 'reindex index public.xrpl_phase_successors_successor_message_id_key;',
  }),
})

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'` }
function env(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parse(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]
    const value = rest[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    options[key.slice(2)] = value
  }
  return { command, options }
}
function validateSource(options) {
  const value = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) fail('invalid --source-commit')
  return value
}
function targetFromOptions(options) {
  const target = TARGETS[options.target]
  if (!target) fail('invalid --target; expected pkey or successor_unique')
  return target
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  fail('Management API response contains no rows')
}
async function query(sql, readOnly) {
  const project = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(90_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return readOnly ? rowsFromResponse(body) : body
}
function firstJson(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

const INSPECTION_SQL = String.raw`with scheduler as (
  select jobid,schedule,active,encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex') as command_sha256
  from cron.job where jobname='xrpl-lending-monitor-minute'
), constraints as (
  select conname,contype::text as contype,pg_get_constraintdef(oid,true) as definition
  from pg_constraint where conrelid='${TABLE}'::regclass
), row_hashes as (
  select current_message_id,
    encode(extensions.digest(convert_to(current_message_id||'|'||successor_message_id||'|'||extract(epoch from reserved_at)::text,'UTF8'),'sha256'),'hex') as row_hash
  from public.xrpl_phase_successors
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'tableOid','${TABLE}'::regclass::oid,
  'tableHeapBytes',pg_relation_size('${TABLE}'::regclass)::bigint,
  'tableRows',(select count(*)::bigint from public.xrpl_phase_successors),
  'rowStateSha256',(select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash,'' order by current_message_id),''),'UTF8'),'sha256'),'hex') from row_hashes),
  'constraintDefinitions',coalesce((select jsonb_object_agg(conname,definition order by conname) from constraints),'{}'::jsonb),
  'constraintStateSha256',(select encode(extensions.digest(convert_to(coalesce(string_agg(conname||'|'||contype||'|'||definition,E'\\n' order by conname),''),'UTF8'),'sha256'),'hex') from constraints),
  'pkeyOid','public.xrpl_phase_successors_pkey'::regclass::oid,
  'pkeyBytes',pg_relation_size('public.xrpl_phase_successors_pkey'::regclass)::bigint,
  'pkeyDefinition',pg_get_indexdef('public.xrpl_phase_successors_pkey'::regclass),
  'pkeyValid',(select indisvalid from pg_index where indexrelid='public.xrpl_phase_successors_pkey'::regclass),
  'pkeyReady',(select indisready from pg_index where indexrelid='public.xrpl_phase_successors_pkey'::regclass),
  'pkeyUnique',(select indisunique from pg_index where indexrelid='public.xrpl_phase_successors_pkey'::regclass),
  'pkeyPrimary',(select indisprimary from pg_index where indexrelid='public.xrpl_phase_successors_pkey'::regclass),
  'pkeyScans',coalesce((select idx_scan::bigint from pg_stat_user_indexes where indexrelid='public.xrpl_phase_successors_pkey'::regclass),0),
  'successorUniqueOid','public.xrpl_phase_successors_successor_message_id_key'::regclass::oid,
  'successorUniqueBytes',pg_relation_size('public.xrpl_phase_successors_successor_message_id_key'::regclass)::bigint,
  'successorUniqueDefinition',pg_get_indexdef('public.xrpl_phase_successors_successor_message_id_key'::regclass),
  'successorUniqueValid',(select indisvalid from pg_index where indexrelid='public.xrpl_phase_successors_successor_message_id_key'::regclass),
  'successorUniqueReady',(select indisready from pg_index where indexrelid='public.xrpl_phase_successors_successor_message_id_key'::regclass),
  'successorUniqueUnique',(select indisunique from pg_index where indexrelid='public.xrpl_phase_successors_successor_message_id_key'::regclass),
  'successorUniquePrimary',(select indisprimary from pg_index where indexrelid='public.xrpl_phase_successors_successor_message_id_key'::regclass),
  'successorUniqueScans',coalesce((select idx_scan::bigint from pg_stat_user_indexes where indexrelid='public.xrpl_phase_successors_successor_message_id_key'::regclass),0),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb)
)::text as state;`

function validateCommon(state) {
  if (state.maxMigrationVersion !== EXPECTED_MIGRATION_HEAD) fail(`migration head drifted: ${state.maxMigrationVersion}`)
  if (state.pkeyDefinition !== TARGETS.pkey.expectedDefinition || state.pkeyValid !== true || state.pkeyReady !== true || state.pkeyUnique !== true || state.pkeyPrimary !== true) fail('successor pkey definition/identity drifted')
  if (state.successorUniqueDefinition !== TARGETS.successor_unique.expectedDefinition || state.successorUniqueValid !== true || state.successorUniqueReady !== true || state.successorUniqueUnique !== true || state.successorUniquePrimary !== false) fail('successor unique definition/identity drifted')
  if (state.constraintDefinitions?.[TARGETS.pkey.constraintName] !== TARGETS.pkey.expectedConstraint) fail('successor primary-key constraint drifted')
  if (state.constraintDefinitions?.[TARGETS.successor_unique.constraintName] !== TARGETS.successor_unique.expectedConstraint) fail('successor unique constraint drifted')
  if (!state.activeRun || state.activeRun.runId !== ACTIVE_RUN_ID || state.activeRun.status !== 'halted' || state.activeRun.lastError !== 'r5_recovery_database_halt' || state.activeRun.network !== 'devnet' || Number(state.activeRun.profileRevision) !== 4) fail('R5 database-halt boundary drifted')
  if (!Array.isArray(state.scheduler) || state.scheduler.length !== 1 || state.scheduler[0].active !== true || state.scheduler[0].schedule !== '* * * * *' || state.scheduler[0].command_sha256 !== EXPECTED_SCHEDULER_COMMAND_SHA) fail('scheduler boundary drifted')
  if (Number(state.tableRows) <= 0 || Number(state.tableRows) > MAX_SUCCESSOR_ROWS) fail('successor row count outside bounded range')
}
function targetMetrics(state, target) {
  return target.key === 'pkey'
    ? { oid:Number(state.pkeyOid), bytes:Number(state.pkeyBytes), definition:state.pkeyDefinition, scans:Number(state.pkeyScans), peerOid:Number(state.successorUniqueOid), peerBytes:Number(state.successorUniqueBytes), peerDefinition:state.successorUniqueDefinition }
    : { oid:Number(state.successorUniqueOid), bytes:Number(state.successorUniqueBytes), definition:state.successorUniqueDefinition, scans:Number(state.successorUniqueScans), peerOid:Number(state.pkeyOid), peerBytes:Number(state.pkeyBytes), peerDefinition:state.pkeyDefinition }
}
function validateBefore(state, target) {
  validateCommon(state)
  const metrics = targetMetrics(state,target)
  if (Number(state.databaseBytes) > MAX_DATABASE_BYTES_BEFORE) fail('database above successor-index reindex ceiling')
  if (Number(state.databaseBytes) + CONSERVATIVE_BUILD_OVERHEAD_BYTES > MAX_CONSERVATIVE_PEAK_BYTES) fail('successor-index conservative peak ceiling exceeded')
  if (metrics.bytes < MIN_TARGET_INDEX_BYTES_BEFORE || metrics.bytes > MAX_TARGET_INDEX_BYTES_BEFORE) fail('target successor index bytes outside authorized reclaim range')
  if (metrics.peerBytes <= 0 || metrics.peerBytes > MAX_TARGET_INDEX_BYTES_BEFORE) fail('peer successor index bytes outside safety range')
}
function structuralState(state, sourceCommit, target) {
  return { schemaVersion:1, purpose:'r5-successor-constraint-index-physical-reindex-structural-state', sourceCommit, target:target.key, projectIdentityDigest:sha256(env('SUPABASE_PROJECT_ID')), maxMigrationVersion:state.maxMigrationVersion, tableOid:Number(state.tableOid), pkeyOid:Number(state.pkeyOid), pkeyDefinition:state.pkeyDefinition, successorUniqueOid:Number(state.successorUniqueOid), successorUniqueDefinition:state.successorUniqueDefinition, constraintDefinitions:state.constraintDefinitions, constraintStateSha256:state.constraintStateSha256, activeRun:state.activeRun, scheduler:state.scheduler }
}
function dataState(state, target) {
  const metrics=targetMetrics(state,target)
  return { schemaVersion:1, purpose:'r5-successor-constraint-index-physical-reindex-data-state', target:target.key, tableHeapBytes:Number(state.tableHeapBytes), tableRows:Number(state.tableRows), rowStateSha256:state.rowStateSha256, targetIndexBytes:metrics.bytes, peerIndexBytes:metrics.peerBytes }
}
function mutationSql(expected, target) {
  for (const key of ['tableRows','tableHeapBytes','targetIndexBytes','peerIndexBytes']) {
    if (!Number.isSafeInteger(Number(expected[key])) || Number(expected[key]) < 0) fail(`invalid mutation ${key}`)
  }
  if (!/^[a-f0-9]{64}$/u.test(expected.rowStateSha256 ?? '') || !/^[a-f0-9]{64}$/u.test(expected.constraintStateSha256 ?? '')) fail('invalid mutation digest')
  const peer = target.key === 'pkey' ? TARGETS.successor_unique : TARGETS.pkey
  return String.raw`begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
select pg_advisory_xact_lock(hashtextextended('xrpl-successor-constraint-index-physical-reindex',0));
lock table public.xrpl_phase_successors in share mode;
do $r5$
declare current_rows bigint; current_heap bigint; current_target_bytes bigint; current_peer_bytes bigint; current_target_definition text; current_peer_definition text; current_row_digest text; current_constraint_digest text;
begin
  select count(*)::bigint,pg_relation_size('${TABLE}'::regclass)::bigint into current_rows,current_heap from public.xrpl_phase_successors;
  select encode(extensions.digest(convert_to(coalesce(string_agg(row_hash,'' order by current_message_id),''),'UTF8'),'sha256'),'hex') into current_row_digest from (select current_message_id,encode(extensions.digest(convert_to(current_message_id||'|'||successor_message_id||'|'||extract(epoch from reserved_at)::text,'UTF8'),'sha256'),'hex') as row_hash from public.xrpl_phase_successors) rows;
  select encode(extensions.digest(convert_to(coalesce(string_agg(conname||'|'||contype::text||'|'||pg_get_constraintdef(oid,true),E'\\n' order by conname),''),'UTF8'),'sha256'),'hex') into current_constraint_digest from pg_constraint where conrelid='${TABLE}'::regclass;
  select pg_relation_size('${target.index}'::regclass)::bigint,pg_get_indexdef('${target.index}'::regclass) into current_target_bytes,current_target_definition;
  select pg_relation_size('${peer.index}'::regclass)::bigint,pg_get_indexdef('${peer.index}'::regclass) into current_peer_bytes,current_peer_definition;
  if current_rows<>${Number(expected.tableRows)} or current_heap<>${Number(expected.tableHeapBytes)} or current_target_bytes<>${Number(expected.targetIndexBytes)} or current_peer_bytes<>${Number(expected.peerIndexBytes)} or current_row_digest<>${sqlLiteral(expected.rowStateSha256)} then raise exception 'successor index authorized data drift under lock'; end if;
  if current_target_definition<>${sqlLiteral(target.expectedDefinition)} or current_peer_definition<>${sqlLiteral(peer.expectedDefinition)} then raise exception 'successor index definition drift under lock'; end if;
  if current_constraint_digest<>${sqlLiteral(expected.constraintStateSha256)} then raise exception 'successor constraint state drift under lock'; end if;
  if current_target_bytes<${MIN_TARGET_INDEX_BYTES_BEFORE} or current_target_bytes>${MAX_TARGET_INDEX_BYTES_BEFORE} or current_peer_bytes>${MAX_TARGET_INDEX_BYTES_BEFORE} or pg_database_size(current_database())>${MAX_DATABASE_BYTES_BEFORE} or pg_database_size(current_database())+${CONSERVATIVE_BUILD_OVERHEAD_BYTES}>${MAX_CONSERVATIVE_PEAK_BYTES} then raise exception 'successor index reindex safety ceiling exceeded under lock'; end if;
  if (select max(version::text) from supabase_migrations.schema_migrations)<>${sqlLiteral(EXPECTED_MIGRATION_HEAD)} then raise exception 'successor index migration head drift under lock'; end if;
  if not exists(select 1 from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}' and status='halted' and last_error='r5_recovery_database_halt' and network='devnet' and profile_revision=4) then raise exception 'R5 halt boundary drift under lock'; end if;
  if (select count(*) from cron.job where jobname='xrpl-lending-monitor-minute' and active and schedule='* * * * *' and encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex')=${sqlLiteral(EXPECTED_SCHEDULER_COMMAND_SHA)})<>1 then raise exception 'scheduler boundary drift under lock'; end if;
end $r5$;
${target.reindexSql}
commit;`
}

for (const target of Object.values(TARGETS)) {
  const sample=mutationSql({tableRows:50235,tableHeapBytes:26517504,targetIndexBytes:23265280,peerIndexBytes:22716416,rowStateSha256:'0'.repeat(64),constraintStateSha256:'1'.repeat(64)},target)
  for (const required of ['lock table public.xrpl_phase_successors in share mode','successor index authorized data drift under lock','successor constraint state drift under lock','successor index reindex safety ceiling exceeded under lock',target.reindexSql]) if(!sample.includes(required)) fail(`successor reindex mutation missing: ${required}`)
  for (const forbidden of [/\bdelete\s+from\b/iu,/\btruncate\b/iu,/\bupdate\s+public\b/iu,/\binsert\s+into\s+public\b/iu,/\bvacuum\b/iu,/\bcluster\b/iu,/\bcron\.schedule\b/iu,/\bcron\.unschedule\b/iu]) if(forbidden.test(sample)) fail(`successor reindex mutation contains forbidden capability: ${forbidden}`)
}

async function inspect(sourceCommit,target,after=false) {
  const state=firstJson(await query(INSPECTION_SQL,true))
  validateCommon(state)
  if(!after) validateBefore(state,target)
  const structural=structuralState(state,sourceCommit,target)
  const data=dataState(state,target)
  const structuralSha=sha256(JSON.stringify(structural))
  const dataSha=sha256(JSON.stringify(data))
  const mutation=mutationSql({...data,constraintStateSha256:state.constraintStateSha256},target)
  const mutationSha=sha256(mutation)
  const plan={schemaVersion:1,purpose:'r5-successor-constraint-index-physical-reindex-plan',sourceCommit,target:target.key,structuralStateSha256:structuralSha,dataStateSha256:dataSha,mutationSha256:mutationSha,localCompactBuildBytes:LOCAL_COMPACT_BUILD_BYTES,conservativeBuildOverheadBytes:CONSERVATIVE_BUILD_OVERHEAD_BYTES,maxDatabaseBytesBefore:MAX_DATABASE_BYTES_BEFORE,maxConservativePeakBytes:MAX_CONSERVATIVE_PEAK_BYTES,maxTargetIndexBytesBefore:MAX_TARGET_INDEX_BYTES_BEFORE,minTargetIndexBytesBefore:MIN_TARGET_INDEX_BYTES_BEFORE,lockMode:'SHARE',lockRevalidation:true,oneIndexOnly:true,independentReadOnlyVerifyRequired:true}
  return {...state,target:target.key,targetMetrics:targetMetrics(state,target),structuralState:structural,structuralStateSha256:structuralSha,dataState:data,dataStateSha256:dataSha,mutation:{sha256:mutationSha,lockTimeoutSeconds:5,statementTimeoutSeconds:120,lockRevalidation:true},plan,planSha256:sha256(JSON.stringify(plan)),conservativePeakBytes:Number(state.databaseBytes)+CONSERVATIVE_BUILD_OVERHEAD_BYTES,rowMutationAuthorized:false,vacuumAuthorized:false,schedulerMutationAuthorized:false,deploymentAuthorized:false,publicReaderMutationAuthorized:false,mainnetDisabled:true,r5RearmAuthorized:false}
}
async function prepare(options){const sourceCommit=validateSource(options);const target=targetFromOptions(options);const result=await inspect(sourceCommit,target,false);await writeJson(options.output,result);console.log(JSON.stringify(result))}
async function apply(options){
  const sourceCommit=validateSource(options);const target=targetFromOptions(options)
  const authorizedState=options['authorized-state'];const authorizedData=options['authorized-data'];const authorizedPlan=options['authorized-plan'];const authorizedMutation=options['authorized-mutation']
  for(const [name,value] of [['authorized-state',authorizedState],['authorized-data',authorizedData],['authorized-plan',authorizedPlan],['authorized-mutation',authorizedMutation]]) if(!/^[a-f0-9]{64}$/u.test(value??'')) fail(`invalid --${name}`)
  const before=await inspect(sourceCommit,target,false)
  if(before.structuralStateSha256!==authorizedState) fail('authorized structural state mismatch')
  if(before.dataStateSha256!==authorizedData) fail('authorized data state mismatch')
  if(before.planSha256!==authorizedPlan) fail('authorized plan mismatch')
  const mutation=mutationSql({...before.dataState,constraintStateSha256:before.constraintStateSha256},target)
  if(sha256(mutation)!==authorizedMutation) fail('authorized mutation mismatch')
  await query(mutation,false)
  const after=await inspect(sourceCommit,target,true)
  if(after.structuralStateSha256!==before.structuralStateSha256) fail('post-reindex structural state mismatch')
  if(Number(after.tableRows)!==Number(before.tableRows)||Number(after.tableHeapBytes)!==Number(before.tableHeapBytes)||after.rowStateSha256!==before.rowStateSha256||after.constraintStateSha256!==before.constraintStateSha256) fail('post-reindex successor row/constraint state mismatch')
  if(after.targetMetrics.oid!==before.targetMetrics.oid||after.targetMetrics.definition!==before.targetMetrics.definition) fail('post-reindex target index identity changed')
  if(after.targetMetrics.peerOid!==before.targetMetrics.peerOid||after.targetMetrics.peerDefinition!==before.targetMetrics.peerDefinition||after.targetMetrics.peerBytes!==before.targetMetrics.peerBytes) fail('post-reindex peer index changed')
  if(after.targetMetrics.bytes>=before.targetMetrics.bytes) fail('target successor index bytes were not reclaimed')
  const result={schemaVersion:1,purpose:'r5-successor-constraint-index-physical-reindex-apply',sourceCommit,target:target.key,structuralStateSha256:authorizedState,dataStateSha256:authorizedData,planSha256:authorizedPlan,mutationSha256:authorizedMutation,tableRowsBefore:Number(before.tableRows),tableRowsAfter:Number(after.tableRows),tableHeapBytesBefore:Number(before.tableHeapBytes),tableHeapBytesAfter:Number(after.tableHeapBytes),rowStateSha256:after.rowStateSha256,constraintStateSha256:after.constraintStateSha256,targetIndexOid:after.targetMetrics.oid,peerIndexOid:after.targetMetrics.peerOid,targetIndexBytesBefore:before.targetMetrics.bytes,targetIndexBytesAfter:after.targetMetrics.bytes,targetIndexBytesReclaimed:before.targetMetrics.bytes-after.targetMetrics.bytes,peerIndexBytesBefore:before.targetMetrics.peerBytes,peerIndexBytesAfter:after.targetMetrics.peerBytes,databaseBytesBefore:Number(before.databaseBytes),databaseBytesAfter:Number(after.databaseBytes),databaseDeltaBytes:Number(after.databaseBytes)-Number(before.databaseBytes),rowMutationPerformed:false,vacuumPerformed:false,schedulerMutationPerformed:false,deploymentPerformed:false,publicReaderMutationPerformed:false,mainnetEnabled:false,r5RearmPerformed:false,independentReadOnlyVerifyRequired:true}
  await writeJson(options.output,result);console.log(JSON.stringify(result))
}
async function verify(options){
  const sourceCommit=validateSource(options);const target=targetFromOptions(options);const evidencePath=options['apply-evidence'];if(!evidencePath) fail('missing --apply-evidence')
  const evidence=JSON.parse(await readFile(resolve(evidencePath),'utf8'))
  if(evidence.sourceCommit!==sourceCommit||evidence.target!==target.key||evidence.purpose!=='r5-successor-constraint-index-physical-reindex-apply') fail('apply evidence identity mismatch')
  const observed=await inspect(sourceCommit,target,true)
  if(observed.structuralStateSha256!==evidence.structuralStateSha256) fail('independent verify structural state mismatch')
  if(Number(observed.tableRows)!==Number(evidence.tableRowsAfter)||Number(observed.tableHeapBytes)!==Number(evidence.tableHeapBytesAfter)||observed.rowStateSha256!==evidence.rowStateSha256||observed.constraintStateSha256!==evidence.constraintStateSha256) fail('independent verify row/constraint state mismatch')
  if(observed.targetMetrics.oid!==Number(evidence.targetIndexOid)||observed.targetMetrics.bytes!==Number(evidence.targetIndexBytesAfter)||observed.targetMetrics.peerOid!==Number(evidence.peerIndexOid)||observed.targetMetrics.peerBytes!==Number(evidence.peerIndexBytesAfter)) fail('independent verify index state mismatch')
  const result={schemaVersion:1,purpose:'r5-successor-constraint-index-physical-reindex-independent-verify',sourceCommit,target:target.key,verified:true,databaseBytes:Number(observed.databaseBytes),tableRows:Number(observed.tableRows),tableHeapBytes:Number(observed.tableHeapBytes),rowStateSha256:observed.rowStateSha256,constraintStateSha256:observed.constraintStateSha256,targetIndexOid:observed.targetMetrics.oid,targetIndexBytes:observed.targetMetrics.bytes,peerIndexOid:observed.targetMetrics.peerOid,peerIndexBytes:observed.targetMetrics.peerBytes,activeRunUnchanged:true,schedulerUnchanged:true,productionReadOnly:true,rowMutationPerformed:false,vacuumPerformed:false,r5RearmPerformed:false}
  await writeJson(options.output,result);console.log(JSON.stringify(result))
}

const {command,options}=parse(process.argv.slice(2))
if(command==='prepare') await prepare(options)
else if(command==='apply') await apply(options)
else if(command==='verify') await verify(options)
else fail('expected prepare, apply, or verify')
