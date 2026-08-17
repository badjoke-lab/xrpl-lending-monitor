#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const CHECKPOINT_AFTER_DEFINITION_SHA256 = 'e170166e6c73bf4e7a112ad3daf94873935d0b2b248abf55f7bb42059575c733'
const TARGET_TABLES = ['public.xrpl_phase_messages', 'public.xrpl_phase_successors']
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
  if (!Array.isArray(rows) || rows.length < 1) fail('read-only preflight returned no rows')
  return rows
}
function firstState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state column missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

const rowDigest = (alias, orderExpression) => `coalesce(md5(string_agg(md5(to_jsonb(${alias})::text),'' order by ${orderExpression})),md5(''))`

const SQL = String.raw`select jsonb_build_object(
  'databaseBytes', pg_database_size(current_database())::bigint,
  'maxMigrationVersion', (select max(version::text) from supabase_migrations.schema_migrations),
  'archiveRows', (select count(*)::bigint from xrpl_phase_archive_v1.terminal_messages),
  'messages', jsonb_build_object(
    'rows', (select count(*)::bigint from public.xrpl_phase_messages),
    'digest', (select ${rowDigest('m', 'm.message_id')} from public.xrpl_phase_messages m),
    'totalBytes', pg_total_relation_size('public.xrpl_phase_messages'::regclass)::bigint,
    'heapBytes', pg_relation_size('public.xrpl_phase_messages'::regclass)::bigint,
    'indexBytes', pg_indexes_size('public.xrpl_phase_messages'::regclass)::bigint,
    'toastBytes', (select case when c.reltoastrelid=0 then 0 else pg_total_relation_size(c.reltoastrelid) end::bigint from pg_class c where c.oid='public.xrpl_phase_messages'::regclass),
    'persistence', (select relpersistence from pg_class where oid='public.xrpl_phase_messages'::regclass),
    'replicaIdentity', (select relreplident from pg_class where oid='public.xrpl_phase_messages'::regclass),
    'rlsEnabled', (select relrowsecurity from pg_class where oid='public.xrpl_phase_messages'::regclass),
    'reloptions', (select coalesce(to_jsonb(reloptions),'[]'::jsonb) from pg_class where oid='public.xrpl_phase_messages'::regclass),
    'acl', (select coalesce(to_jsonb(relacl),'[]'::jsonb) from pg_class where oid='public.xrpl_phase_messages'::regclass),
    'stats', (select jsonb_build_object('live',n_live_tup::bigint,'dead',n_dead_tup::bigint,'modSinceAnalyze',n_mod_since_analyze::bigint,'lastVacuum',last_vacuum,'lastAutovacuum',last_autovacuum,'lastAnalyze',last_analyze,'lastAutoanalyze',last_autoanalyze,'vacuumCount',vacuum_count::bigint,'autovacuumCount',autovacuum_count::bigint) from pg_stat_user_tables where relid='public.xrpl_phase_messages'::regclass)
  ),
  'successors', jsonb_build_object(
    'rows', (select count(*)::bigint from public.xrpl_phase_successors),
    'digest', (select ${rowDigest('s', 's.current_message_id')} from public.xrpl_phase_successors s),
    'totalBytes', pg_total_relation_size('public.xrpl_phase_successors'::regclass)::bigint,
    'heapBytes', pg_relation_size('public.xrpl_phase_successors'::regclass)::bigint,
    'indexBytes', pg_indexes_size('public.xrpl_phase_successors'::regclass)::bigint,
    'toastBytes', (select case when c.reltoastrelid=0 then 0 else pg_total_relation_size(c.reltoastrelid) end::bigint from pg_class c where c.oid='public.xrpl_phase_successors'::regclass),
    'persistence', (select relpersistence from pg_class where oid='public.xrpl_phase_successors'::regclass),
    'replicaIdentity', (select relreplident from pg_class where oid='public.xrpl_phase_successors'::regclass),
    'rlsEnabled', (select relrowsecurity from pg_class where oid='public.xrpl_phase_successors'::regclass),
    'reloptions', (select coalesce(to_jsonb(reloptions),'[]'::jsonb) from pg_class where oid='public.xrpl_phase_successors'::regclass),
    'acl', (select coalesce(to_jsonb(relacl),'[]'::jsonb) from pg_class where oid='public.xrpl_phase_successors'::regclass),
    'stats', (select jsonb_build_object('live',n_live_tup::bigint,'dead',n_dead_tup::bigint,'modSinceAnalyze',n_mod_since_analyze::bigint,'lastVacuum',last_vacuum,'lastAutovacuum',last_autovacuum,'lastAnalyze',last_analyze,'lastAutoanalyze',last_autoanalyze,'vacuumCount',vacuum_count::bigint,'autovacuumCount',autovacuum_count::bigint) from pg_stat_user_tables where relid='public.xrpl_phase_successors'::regclass)
  ),
  'columns', (select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'ordinal',ordinal_position,'name',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default,'identity',is_identity,'identityGeneration',identity_generation,'generated',is_generated,'generationExpression',generation_expression) order by table_name,ordinal_position),'[]'::jsonb) from information_schema.columns where table_schema='public' and table_name in ('xrpl_phase_messages','xrpl_phase_successors')),
  'constraints', (select coalesce(jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',con.conname,'type',con.contype,'validated',con.convalidated,'deferrable',con.condeferrable,'deferred',con.condeferred,'definition',pg_get_constraintdef(con.oid,true),'referencedTable',case when con.confrelid=0 then null else con.confrelid::regclass::text end) order by c.relname,con.conname),'[]'::jsonb) from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace where con.conrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)),
  'inboundForeignKeys', (select coalesce(jsonb_agg(jsonb_build_object('source',con.conrelid::regclass::text,'target',con.confrelid::regclass::text,'name',con.conname,'validated',con.convalidated,'definition',pg_get_constraintdef(con.oid,true)) order by con.conrelid::regclass::text,con.conname),'[]'::jsonb) from pg_constraint con where con.contype='f' and con.confrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)),
  'indexes', (select coalesce(jsonb_agg(jsonb_build_object('table',t.relname,'name',i.relname,'primary',x.indisprimary,'unique',x.indisunique,'valid',x.indisvalid,'ready',x.indisready,'clustered',x.indisclustered,'definition',pg_get_indexdef(i.oid),'bytes',pg_relation_size(i.oid)::bigint) order by t.relname,i.relname),'[]'::jsonb) from pg_index x join pg_class i on i.oid=x.indexrelid join pg_class t on t.oid=x.indrelid where x.indrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass)),
  'userTriggers', (select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true)) order by c.relname,t.tgname),'[]'::jsonb) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgrelid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass) and not t.tgisinternal),
  'policies', (select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check) order by tablename,policyname),'[]'::jsonb) from pg_policies where schemaname='public' and tablename in ('xrpl_phase_messages','xrpl_phase_successors')),
  'dependentViews', (select coalesce(jsonb_agg(distinct jsonb_build_object('schema',nv.nspname,'view',v.relname) order by jsonb_build_object('schema',nv.nspname,'view',v.relname)),'[]'::jsonb) from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class v on v.oid=r.ev_class join pg_namespace nv on nv.oid=v.relnamespace where d.refobjid in ('public.xrpl_phase_messages'::regclass,'public.xrpl_phase_successors'::regclass) and v.relkind in ('v','m')),
  'activeRun', (select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'committedLedgers',committed_ledgers,'completedBatches',completed_batches,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'checkpoint', (select jsonb_build_object('definitionSha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),'sourceSha256',encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),'archiveFailCloseMarker',strpos(p.prosrc,'r5_checkpoint_terminal_archive_requires_archive_aware_checkpoint')>0,'archiveTableMarker',strpos(p.prosrc,'xrpl_phase_archive_v1.terminal_messages')>0) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='xrpl_create_r5_active_checkpoint_strict' and pg_get_function_identity_arguments(p.oid)='p_checkpoint_id text, p_observed_at timestamp with time zone'),
  'scheduler', (select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(convert_to(command::text,'UTF8'),'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname='xrpl-lending-monitor-minute'),
  'safety', jsonb_build_object('readOnly',true,'rowMutationAuthorized',false,'schemaMutationAuthorized',false,'physicalCompactionAuthorized',false,'vacuumAuthorized',false,'reindexAuthorized',false,'clusterAuthorized',false,'schedulerMutationAuthorized',false,'deploymentAuthorized',false,'publicReaderMutationAuthorized',false,'mainnetDisabled',true,'r5RearmAuthorized',false)
)::text as state;`

if (!/^\s*select\b/iu.test(SQL)) fail('Phase C preflight must be one SELECT statement')
const sanitized = SQL.replace(/'[^']*'/gu, "''")
for (const forbidden of [/\bdelete\s+from\b/iu,/\btruncate\b/iu,/\bvacuum\b/iu,/\breindex\b/iu,/\bcluster\b/iu,/\balter\s+table\b/iu,/\bdrop\s+/iu,/\bcreate\s+(?:table|index)\b/iu,/\bupdate\s+/iu,/\binsert\s+into\b/iu]) {
  if (forbidden.test(sanitized)) fail(`Phase C preflight contains mutation capability: ${forbidden}`)
}

function validate(state) {
  if (!state.activeRun || state.activeRun.runId !== ACTIVE_RUN_ID || state.activeRun.status !== 'halted' || state.activeRun.lastError !== 'r5_recovery_database_halt' || state.activeRun.network !== 'devnet' || Number(state.activeRun.profileRevision) !== 4) fail('R5 database-halt boundary drifted')
  if (Number(state.archiveRows) < MIN_ARCHIVE_ROWS) fail(`expected at least ${MIN_ARCHIVE_ROWS} archive rows`)
  if (!state.checkpoint || state.checkpoint.definitionSha256 !== CHECKPOINT_AFTER_DEFINITION_SHA256 || state.checkpoint.archiveFailCloseMarker !== true || state.checkpoint.archiveTableMarker !== true) fail('checkpoint is not frozen_exact')
  for (const table of ['messages','successors']) {
    if (!state[table] || Number(state[table].rows) < 1 || !/^[a-f0-9]{32}$/u.test(String(state[table].digest ?? ''))) fail(`${table} row/digest state missing`)
    if (state[table].persistence !== 'p') fail(`${table} is not a permanent relation`)
  }
  for (const key of ['readOnly','mainnetDisabled']) if (state.safety?.[key] !== true) fail(`safety boundary missing ${key}`)
  for (const key of ['rowMutationAuthorized','schemaMutationAuthorized','physicalCompactionAuthorized','vacuumAuthorized','reindexAuthorized','clusterAuthorized','schedulerMutationAuthorized','deploymentAuthorized','publicReaderMutationAuthorized','r5RearmAuthorized']) if (state.safety?.[key] !== false) fail(`unsafe authorization flag ${key}`)
}

const options = parse(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const state = firstState(await query(SQL))
validate(state)
const structural = {
  schemaVersion: 1,
  purpose: 'r5-terminal-transport-physical-compaction-preflight',
  sourceCommit,
  projectIdentityDigest: sha256(env('SUPABASE_PROJECT_ID')),
  targetTables: TARGET_TABLES,
  maxMigrationVersion: state.maxMigrationVersion,
  messages: { rows: Number(state.messages.rows), digest: state.messages.digest, persistence: state.messages.persistence, replicaIdentity: state.messages.replicaIdentity, rlsEnabled: state.messages.rlsEnabled, reloptions: state.messages.reloptions, acl: state.messages.acl },
  successors: { rows: Number(state.successors.rows), digest: state.successors.digest, persistence: state.successors.persistence, replicaIdentity: state.successors.replicaIdentity, rlsEnabled: state.successors.rlsEnabled, reloptions: state.successors.reloptions, acl: state.successors.acl },
  columns: state.columns,
  constraints: state.constraints,
  inboundForeignKeys: state.inboundForeignKeys,
  indexes: state.indexes,
  userTriggers: state.userTriggers,
  policies: state.policies,
  dependentViews: state.dependentViews,
  activeRun: state.activeRun,
  checkpoint: state.checkpoint,
  scheduler: state.scheduler,
}
const evidence = {
  schemaVersion: 1,
  purpose: 'r5-terminal-transport-physical-compaction-readonly-preflight',
  sourceCommit,
  projectIdentityDigest: structural.projectIdentityDigest,
  querySha256: sha256(SQL),
  structuralStateSha256: sha256(JSON.stringify(structural)),
  databaseBytes: Number(state.databaseBytes),
  maxMigrationVersion: state.maxMigrationVersion,
  archiveRows: Number(state.archiveRows),
  messages: state.messages,
  successors: state.successors,
  columns: state.columns,
  constraints: state.constraints,
  inboundForeignKeys: state.inboundForeignKeys,
  indexes: state.indexes,
  userTriggers: state.userTriggers,
  policies: state.policies,
  dependentViews: state.dependentViews,
  activeRun: state.activeRun,
  checkpoint: state.checkpoint,
  scheduler: state.scheduler,
  safety: state.safety,
}
await writeJson(options.output, evidence)
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
