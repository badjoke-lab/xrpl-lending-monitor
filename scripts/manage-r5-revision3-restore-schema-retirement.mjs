#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SQL_PATH = 'ops/production-sql/20260827153500_xrpl_revision3_restore_schema_retirement.sql'
const EXPECTED_MIGRATION_HEAD = '20260816050000'
const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'
const RETIREMENT_FUNCTIONS = [
  'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)',
  'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)',
  'xrpl_resource_restore_v1.build_restored_accounting_state(text)',
  'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
  'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
]
const RESTORE_RELATIONS = [
  ['accounting_rows', 'r'], ['accounting_rows_pkey', 'i'],
  ['attempt_rows', 'r'], ['attempt_rows_pkey', 'i'],
  ['targets', 'r'], ['targets_pkey', 'i'],
]

function fail(message) { throw new Error(message) }
function sha(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function lit(value) { return `'${String(value).replaceAll("'", "''")}'` }
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
    if (!rest[i]?.startsWith('--') || rest[i + 1] == null || rest[i + 1].startsWith('--')) fail(`invalid argument near ${rest[i] ?? '<end>'}`)
    options[rest[i].slice(2)] = rest[i + 1]
  }
  return { command, options }
}
function validateSource(options) {
  const value = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) fail('invalid --source-commit')
  return value
}
async function out(path, value) {
  if (!path) return
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}
function rows(body) {
  if (Array.isArray(body)) return body
  for (const value of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) if (Array.isArray(value)) return value
  fail('Management API response contains no rows')
}
async function query(sql, readOnly) {
  const project = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query: sql, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(90000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rows(body)
}
function stateRow(resultRows) {
  const raw = resultRows?.[0]?.state ?? resultRows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

async function plan(sourceCommit) {
  const sql = await readFile(SQL_PATH, 'utf8')
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ').trim()
  const exact = [
    'drop function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization();',
    'drop function xrpl_resource_guard_v2.qualify_transfer_on_completion();',
    'drop function public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone);',
    'drop function public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone);',
    'drop function xrpl_resource_restore_v1.build_restored_accounting_state(text);',
    'drop table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets;',
    'drop schema xrpl_resource_restore_v1;',
  ].join(' ')
  if (normalized !== exact) fail('restore schema retirement SQL must be the exact no-CASCADE plan')
  if ((normalized.match(/\bdrop\s+function\b/gu) ?? []).length !== 5) fail('restore schema retirement must drop exactly five functions')
  if ((normalized.match(/\bdrop\s+table\b/gu) ?? []).length !== 1) fail('restore schema retirement must use one exact DROP TABLE')
  if ((normalized.match(/\bdrop\s+schema\b/gu) ?? []).length !== 1) fail('restore schema retirement must drop exactly one schema')
  for (const forbidden of [/\bcascade\b/iu, /\bif\s+exists\b/iu, /\bdelete\b/iu, /\btruncate\b/iu, /\bupdate\b/iu, /\binsert\b/iu, /\balter\b/iu, /\bgrant\b/iu, /\brevoke\b/iu, /\bvacuum\b/iu, /\breindex\b/iu, /\bcluster\b/iu, /\bcron\./iu, /\bnet\./iu, /\bsupabase_migrations\b/iu]) {
    if (forbidden.test(sql)) fail(`restore schema retirement SQL contains forbidden capability: ${forbidden}`)
  }
  const file = { path: SQL_PATH, sha256: sha(sql), bytes: Buffer.byteLength(sql, 'utf8') }
  const digestInput = { schemaVersion: 1, purpose: 'r5-revision3-restore-schema-retirement-plan', sourceCommit, file, retirementFunctions: RETIREMENT_FUNCTIONS, restoreTables: ['accounting_rows','attempt_rows','targets'], cascade: false }
  return { sql, file, planDigestSha256: sha(JSON.stringify(digestInput)) }
}

function digestCte(name, relation) {
  return `${name} as (select count(*)::bigint as row_count, encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''),'UTF8'),'sha256'),'hex') as row_digest from ${relation} t)`
}

function beforeSql() {
  const presenceValues = RETIREMENT_FUNCTIONS.map((x) => `(${lit(x)})`).join(',')
  return `with restore_relations as (
    select c.oid::bigint as oid,c.relname as relation_name,c.relkind,pg_total_relation_size(c.oid)::bigint as total_bytes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='xrpl_resource_restore_v1'
  ), target_functions as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,p.oid::regprocedure::text as signature,
      encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.oid in (${RETIREMENT_FUNCTIONS.map((x) => `to_regprocedure(${lit(x)})`).join(',')})
  ), target_presence as (
    select wanted.signature,to_regprocedure(wanted.signature)::text as resolved_signature from (values ${presenceValues}) wanted(signature)
  ), source_references as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,p.oid::regprocedure::text as signature,has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
      p.prosrc ilike '%xrpl_resource_restore_v1%' as names_restore_schema,p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' as names_qualify,p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' as names_restore,p.prosrc ilike '%build_restored_accounting_state%' as names_builder,p.prosrc ilike '%qualify_transfer_after_attempt_finalization%' as names_attempt_trigger_fn,p.prosrc ilike '%qualify_transfer_on_completion%' as names_completion_trigger_fn
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and (p.prosrc ilike '%xrpl_resource_restore_v1%' or p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' or p.prosrc ilike '%build_restored_accounting_state%' or p.prosrc ilike '%qualify_transfer_after_attempt_finalization%' or p.prosrc ilike '%qualify_transfer_on_completion%')
  ), target_oids as (select oid::oid from target_functions), dependent_objects as (
    select distinct pg_describe_object(d.classid,d.objid,d.objsubid) as dependent_object,pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referenced_object,d.deptype
    from pg_depend d where d.refobjid in (select oid from target_oids) or d.objid in (select oid from target_oids)
  ), trigger_bindings as (
    select tn.nspname as table_schema,tc.relname as table_name,tg.tgname as trigger_name,pn.nspname as function_schema,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments
    from pg_trigger tg join pg_class tc on tc.oid=tg.tgrelid join pg_namespace tn on tn.oid=tc.relnamespace join pg_proc p on p.oid=tg.tgfoid join pg_namespace pn on pn.oid=p.pronamespace
    where not tg.tgisinternal and p.oid in (select oid from target_oids)
  ), referencing_views as (
    select schemaname as schema_name,viewname as view_name from pg_views where definition ilike '%xrpl_resource_restore_v1%' or definition ilike '%xrpl_qualify_revision3_accounting_transfer%' or definition ilike '%xrpl_restore_revision3_accounting_state%' or definition ilike '%build_restored_accounting_state%' or definition ilike '%qualify_transfer_after_attempt_finalization%' or definition ilike '%qualify_transfer_on_completion%'
  ),
  ${digestCte('sessions_digest','xrpl_steady_v1.sessions')},
  ${digestCte('ticks_digest','xrpl_steady_v1.ticks')},
  ${digestCte('attempts_digest','xrpl_resource_guard_v2.attempts')},
  ${digestCte('accounting_digest','xrpl_resource_guard_v2.tick_accounting')},
  ${digestCte('transfer_digest','xrpl_resource_guard_v2.transfer_qualifications')}
  select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
    'restoreRelations',coalesce((select jsonb_agg(to_jsonb(x) order by x.relation_name,x.relkind) from restore_relations x),'[]'::jsonb),
    'targetPresence',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from target_presence x),'[]'::jsonb),
    'targetFunctions',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from target_functions x),'[]'::jsonb),
    'sourceReferences',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from source_references x),'[]'::jsonb),
    'dependentObjects',coalesce((select jsonb_agg(to_jsonb(x) order by x.dependent_object,x.referenced_object,x.deptype) from dependent_objects x),'[]'::jsonb),
    'triggerBindings',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.trigger_name) from trigger_bindings x),'[]'::jsonb),
    'referencingViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from referencing_views x),'[]'::jsonb),
    'restoreRows',jsonb_build_object('targets',(select count(*)::bigint from xrpl_resource_restore_v1.targets),'attemptRows',(select count(*)::bigint from xrpl_resource_restore_v1.attempt_rows),'accountingRows',(select count(*)::bigint from xrpl_resource_restore_v1.accounting_rows)),
    'protectedDigests',jsonb_build_object('sessions',(select to_jsonb(x) from sessions_digest x),'ticks',(select to_jsonb(x) from ticks_digest x),'attempts',(select to_jsonb(x) from attempts_digest x),'tickAccounting',(select to_jsonb(x) from accounting_digest x),'transferQualifications',(select to_jsonb(x) from transfer_digest x)),
    'activeLegacyCronJobs',(select count(*)::bigint from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
    'runningGuardedSessions',(select count(*)::bigint from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
    'leasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased'),
    'liveLeasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
    'openAttempts',(select count(*)::bigint from xrpl_resource_guard_v2.attempts where status='open'),
    'scheduler',(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%')
  )::text as state;`
}

function afterSql() {
  return `with source_references as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and (p.prosrc ilike '%xrpl_resource_restore_v1%' or p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' or p.prosrc ilike '%build_restored_accounting_state%' or p.prosrc ilike '%qualify_transfer_after_attempt_finalization%' or p.prosrc ilike '%qualify_transfer_on_completion%')
  ),
  ${digestCte('sessions_digest','xrpl_steady_v1.sessions')},${digestCte('ticks_digest','xrpl_steady_v1.ticks')},${digestCte('attempts_digest','xrpl_resource_guard_v2.attempts')},${digestCte('accounting_digest','xrpl_resource_guard_v2.tick_accounting')},${digestCte('transfer_digest','xrpl_resource_guard_v2.transfer_qualifications')}
  select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
    'restoreRelationCount',(select count(*)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='xrpl_resource_restore_v1'),
    'restoreFunctionCount',(select count(*)::bigint from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='xrpl_resource_restore_v1'),
    'targetFunctionsRemaining',(select count(*)::bigint from (values ${RETIREMENT_FUNCTIONS.map((x) => `(to_regprocedure(${lit(x)}))`).join(',')}) v(oid) where oid is not null),
    'sourceReferences',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from source_references x),'[]'::jsonb),
    'protectedDigests',jsonb_build_object('sessions',(select to_jsonb(x) from sessions_digest x),'ticks',(select to_jsonb(x) from ticks_digest x),'attempts',(select to_jsonb(x) from attempts_digest x),'tickAccounting',(select to_jsonb(x) from accounting_digest x),'transferQualifications',(select to_jsonb(x) from transfer_digest x)),
    'activeLegacyCronJobs',(select count(*)::bigint from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
    'runningGuardedSessions',(select count(*)::bigint from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
    'leasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased'),
    'liveLeasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
    'openAttempts',(select count(*)::bigint from xrpl_resource_guard_v2.attempts where status='open'),
    'scheduler',(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%')
  )::text as state;`
}

async function inspectBefore() { return stateRow(await query(beforeSql(), true)) }
async function inspectAfter() { return stateRow(await query(afterSql(), true)) }
function schedulerValid(state) {
  const active = (state.scheduler ?? []).filter((x) => x.active)
  return active.length === 1 && active[0].jobName === 'xrpl-lending-monitor-minute' && active[0].schedule === '* * * * *' && active[0].commandSha256 === EXPECTED_SCHEDULER_COMMAND_SHA
}
function validateIdle(state) {
  if (Number(state.activeLegacyCronJobs) !== 0) fail('legacy steady cron is active')
  if (Number(state.runningGuardedSessions) !== 0) fail('guarded steady session is running')
  if (Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0) fail('legacy steady lease remains')
  if (Number(state.openAttempts) !== 0) fail('revision-3 open attempt remains')
  if (!schedulerValid(state)) fail('current minute scheduler shape drifted')
  if (state.maxMigrationVersion !== EXPECTED_MIGRATION_HEAD) fail('production migration head drifted')
}
function validateBefore(state) {
  validateIdle(state)
  if (state.restoreSchemaExists !== true) fail('revision-3 restore schema is missing')
  const rows = state.restoreRows ?? {}
  if ([rows.targets,rows.attemptRows,rows.accountingRows].some((x) => Number(x) !== 0)) fail('revision-3 restore rows are not empty')
  const relationShape = (state.restoreRelations ?? []).map((x) => [x.relation_name,x.relkind])
  if (!same(relationShape, RESTORE_RELATIONS)) fail('restore relation inventory drifted')
  const targets = state.targetFunctions ?? []
  if (targets.length !== RETIREMENT_FUNCTIONS.length) fail('retirement function inventory drifted')
  for (const signature of RETIREMENT_FUNCTIONS) {
    const row = targets.find((x) => `${x.schema_name}.${x.signature}` === signature || x.signature === signature.replace(/^public\./u,''))
    if (!row) fail(`retirement function missing: ${signature}`)
  }
  for (const row of targets) if (row.service_role_execute !== false || row.authenticated_execute !== false || row.anon_execute !== false) fail(`retired function regained execution: ${row.signature}`)
  const targetNames = new Set(targets.map((x) => `${x.schema_name}.${x.signature}`.replace(/^public\.xrpl_/u,'public.xrpl_')))
  const refs = state.sourceReferences ?? []
  if (refs.length !== 5) fail('restore source-reference inventory drifted')
  for (const ref of refs) {
    const qualified = `${ref.schema_name}.${ref.signature}`
    if (!RETIREMENT_FUNCTIONS.some((x) => x === qualified || x === `public.${ref.signature}` || x === ref.signature)) fail(`external restore source reference remains: ${qualified}`)
    if (ref.service_role_execute !== false) fail(`restore source reference regained service-role execution: ${qualified}`)
  }
  const deps = state.dependentObjects ?? []
  if (deps.length !== 10) fail('retirement dependency inventory drifted')
  for (const dep of deps) {
    if (!String(dep.dependent_object).startsWith('function ')) fail(`non-function dependent object remains: ${dep.dependent_object}`)
    if (!(dep.referenced_object === 'language plpgsql' || String(dep.referenced_object).startsWith('schema '))) fail(`external dependency remains: ${dep.dependent_object} -> ${dep.referenced_object}`)
  }
  if ((state.triggerBindings ?? []).length !== 0) fail('retirement target still has trigger binding')
  if ((state.referencingViews ?? []).length !== 0) fail('retirement target still has referencing view')
}
function validateAfter(state) {
  validateIdle(state)
  if (state.restoreSchemaExists !== false) fail('revision-3 restore schema still exists')
  if (Number(state.restoreRelationCount) !== 0 || Number(state.restoreFunctionCount) !== 0) fail('restore schema objects remain')
  if (Number(state.targetFunctionsRemaining) !== 0) fail('retirement functions remain')
  if ((state.sourceReferences ?? []).length !== 0) fail('retired restore source references remain')
}
function structural(state) {
  return {
    maxMigrationVersion: state.maxMigrationVersion,
    restoreSchemaExists: state.restoreSchemaExists,
    restoreRelations: state.restoreRelations,
    restoreRows: state.restoreRows,
    targetFunctions: state.targetFunctions,
    sourceReferences: state.sourceReferences,
    dependentObjects: state.dependentObjects,
    triggerBindings: state.triggerBindings,
    referencingViews: state.referencingViews,
    protectedDigests: state.protectedDigests,
    activeLegacyCronJobs: Number(state.activeLegacyCronJobs),
    runningGuardedSessions: Number(state.runningGuardedSessions),
    leasedTicks: Number(state.leasedTicks),
    liveLeasedTicks: Number(state.liveLeasedTicks),
    openAttempts: Number(state.openAttempts),
    scheduler: state.scheduler,
  }
}

async function prepare(sourceCommit, options) {
  const planned = await plan(sourceCommit)
  const state = await inspectBefore()
  validateBefore(state)
  const structure = structural(state)
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-prepare',
    sourceCommit,
    projectIdentityDigest: sha(env('SUPABASE_PROJECT_ID')),
    plan: { file: planned.file, retirementFunctions: RETIREMENT_FUNCTIONS, restoreTables: ['accounting_rows','attempt_rows','targets'], schema: 'xrpl_resource_restore_v1', cascade: false },
    planDigestSha256: planned.planDigestSha256,
    structuralStateSha256: sha(JSON.stringify(structure)),
    classification: 'unapplied_expected',
    maxMigrationVersion: state.maxMigrationVersion,
    schedulerSha256: sha(JSON.stringify(state.scheduler)),
    protectedDigests: state.protectedDigests,
    productionDatabaseReadOnly: true,
    functionDropAuthorized: false,
    tableDropAuthorized: false,
    schemaDropAuthorized: false,
    cascadeAuthorized: false,
    rowMutationAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    r5RearmAuthorized: false,
    mainnetDisabled: true,
  }
  await out(options.output, evidence)
  return evidence
}

function lockedGuardSql() {
  return `lock table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets in access exclusive mode;\nlock table xrpl_steady_v1.sessions, xrpl_steady_v1.ticks, xrpl_resource_guard_v2.attempts in share mode;\ndo $guard$ begin\n  if (select count(*) from xrpl_resource_restore_v1.targets) <> 0 or (select count(*) from xrpl_resource_restore_v1.attempt_rows) <> 0 or (select count(*) from xrpl_resource_restore_v1.accounting_rows) <> 0 then raise exception 'restore rows changed under lock'; end if;\n  if (select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled and status='running') <> 0 then raise exception 'guarded session became running under lock'; end if;\n  if (select count(*) from xrpl_steady_v1.ticks where status='leased') <> 0 then raise exception 'legacy tick became leased under lock'; end if;\n  if (select count(*) from xrpl_resource_guard_v2.attempts where status='open') <> 0 then raise exception 'resource guard attempt became open under lock'; end if;\n  if (select count(*) from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')) <> 0 then raise exception 'legacy cron became active under lock'; end if;\nend $guard$;`
}

async function apply(sourceCommit, options) {
  const authorizedPlan = options['authorized-plan']
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedPlan ?? '') || !/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid authorized digest')
  const before = await prepare(sourceCommit, {})
  if (before.planDigestSha256 !== authorizedPlan || before.structuralStateSha256 !== authorizedState) fail('authorized restore schema retirement state or plan drifted')
  const planned = await plan(sourceCommit)
  await query(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${lockedGuardSql()}\n${planned.sql}\ncommit;`, false)
  const after = await inspectAfter()
  validateAfter(after)
  if (!same(before.protectedDigests, after.protectedDigests)) fail('restore schema retirement changed protected rows')
  if (before.maxMigrationVersion !== after.maxMigrationVersion) fail('restore schema retirement changed migration head')
  if (before.schedulerSha256 !== sha(JSON.stringify(after.scheduler))) fail('restore schema retirement changed scheduler')
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-apply',
    sourceCommit,
    planDigestSha256: authorizedPlan,
    authorizedStructuralStateSha256: authorizedState,
    classificationAfter: 'applied_consistent',
    databaseBytesBefore: null,
    databaseBytesAfter: Number(after.databaseBytes),
    protectedDigestsBefore: before.protectedDigests,
    protectedDigestsAfter: after.protectedDigests,
    maxMigrationVersionBefore: before.maxMigrationVersion,
    maxMigrationVersionAfter: after.maxMigrationVersion,
    schedulerSha256Before: before.schedulerSha256,
    schedulerSha256After: sha(JSON.stringify(after.scheduler)),
    functionDropPerformed: true,
    exactFunctionDropCount: 5,
    tableDropPerformed: true,
    exactTableDropCount: 3,
    schemaDropPerformed: true,
    cascadePerformed: false,
    rowMutationPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    r5RearmPerformed: false,
    mainnetDisabled: true,
    postVerificationReadOnly: true,
  }
  await out(options.output, evidence)
  return evidence
}

async function verify(sourceCommit, options) {
  if (!options['apply-evidence']) fail('missing --apply-evidence')
  const applied = JSON.parse(await readFile(resolve(options['apply-evidence']), 'utf8'))
  if (applied.sourceCommit !== sourceCommit || applied.classificationAfter !== 'applied_consistent') fail('apply evidence mismatch')
  const state = await inspectAfter()
  validateAfter(state)
  if (!same(applied.protectedDigestsBefore, state.protectedDigests)) fail('independent verify protected rows drifted')
  if (applied.maxMigrationVersionBefore !== state.maxMigrationVersion) fail('independent verify migration head drifted')
  if (applied.schedulerSha256Before !== sha(JSON.stringify(state.scheduler))) fail('independent verify scheduler drifted')
  const evidence = { schemaVersion: 1, purpose: 'r5-revision3-restore-schema-retirement-independent-verify', sourceCommit, classification: 'applied_consistent', protectedDigests: state.protectedDigests, maxMigrationVersion: state.maxMigrationVersion, schedulerSha256: sha(JSON.stringify(state.scheduler)), productionDatabaseReadOnly: true, functionDropAuthorized: false, tableDropAuthorized: false, schemaDropAuthorized: false, cascadeAuthorized: false, rowMutationAuthorized: false, schedulerMutationAuthorized: false, r5RearmAuthorized: false, mainnetDisabled: true }
  await out(options.output, evidence)
  return evidence
}

const { command, options } = parse(process.argv.slice(2))
const sourceCommit = validateSource(options)
let result
if (command === 'prepare') result = await prepare(sourceCommit, options)
else if (command === 'apply') result = await apply(sourceCommit, options)
else if (command === 'verify') result = await verify(sourceCommit, options)
else fail('usage: manage-r5-revision3-restore-schema-retirement.mjs <prepare|apply|verify> --source-commit <sha> [options]')
process.stdout.write(`${JSON.stringify(result)}\n`)
