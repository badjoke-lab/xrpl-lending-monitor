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
const EXPECTED_SOURCE_SHA = new Map([
  ['public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)', '301e4b7c2c6b229330a8b291b489987c12b2302389b0c3470a4878978757b990'],
  ['public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)', '835d6200b8897889553b9d857fbad4c61b33a3eab0f3fad4dec9013f70909187'],
  ['xrpl_resource_restore_v1.build_restored_accounting_state(text)', 'c920ed138140e4698f707a0702ed6d478d3de0ac779ccd14055ac82838f8d5d6'],
  ['xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()', 'e855f67c4847cdf0f472f468471bfec78e2f6ce6e0e58a846322f782d52e104b'],
  ['xrpl_resource_guard_v2.qualify_transfer_on_completion()', 'bac17dd7f28fb056053a064aa1d34de0d7bd8264181b271f20afcb32224b443f'],
])
const RESTORE_RELATIONS = [
  ['accounting_rows', 'r'], ['accounting_rows_pkey', 'i'],
  ['attempt_rows', 'r'], ['attempt_rows_pkey', 'i'],
  ['targets', 'r'], ['targets_pkey', 'i'],
]
const EXPECTED_DEPENDENCIES = new Set([
  'function xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)|language plpgsql|n',
  'function xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)|schema public|n',
  'function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()|language plpgsql|n',
  'function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()|schema xrpl_resource_guard_v2|n',
  'function xrpl_resource_guard_v2.qualify_transfer_on_completion()|language plpgsql|n',
  'function xrpl_resource_guard_v2.qualify_transfer_on_completion()|schema xrpl_resource_guard_v2|n',
  'function xrpl_resource_restore_v1.build_restored_accounting_state(text)|language plpgsql|n',
  'function xrpl_resource_restore_v1.build_restored_accounting_state(text)|schema xrpl_resource_restore_v1|n',
  'function xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)|language plpgsql|n',
  'function xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)|schema public|n',
])

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
  if (rest.length % 2 !== 0) fail('options must be key/value pairs')
  for (let i = 0; i < rest.length; i += 2) {
    if (!rest[i]?.startsWith('--') || rest[i + 1] == null || rest[i + 1].startsWith('--')) fail(`invalid argument near ${rest[i] ?? '<end>'}`)
    if (options[rest[i].slice(2)] != null) fail(`duplicate option ${rest[i]}`)
    options[rest[i].slice(2)] = rest[i + 1]
  }
  return { command, options }
}
function validateSource(options) {
  const value = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) fail('invalid --source-commit')
  return value
}
async function writeJson(path, value) {
  if (!path) return
  const target = resolve(path)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`)
}
function responseRows(body) {
  if (Array.isArray(body)) return body
  for (const value of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) if (Array.isArray(value)) return value
  fail('Management API response contains no rows')
}
async function managementQuery(sql, readOnly) {
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
  return responseRows(body)
}
function stateRow(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
function canonicalFunction(row) {
  const signature = String(row?.signature ?? '')
  const schema = String(row?.schema_name ?? '')
  if (!signature || !schema) return ''
  if (signature.startsWith(`${schema}.`)) return signature
  return `${schema}.${signature}`
}

async function loadPlan(sourceCommit) {
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
  const digestInput = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-plan',
    sourceCommit,
    file,
    retirementFunctions: RETIREMENT_FUNCTIONS,
    expectedSourceSha256: Object.fromEntries(EXPECTED_SOURCE_SHA),
    restoreTables: ['accounting_rows', 'attempt_rows', 'targets'],
    restoreSchema: 'xrpl_resource_restore_v1',
    cascade: false,
  }
  return { sql, file, planDigestSha256: sha(JSON.stringify(digestInput)) }
}

function digestCte(name, relation) {
  return `${name} as (select count(*)::bigint as row_count, encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by to_jsonb(t)::text),''),'UTF8'),'sha256'),'hex') as row_digest from ${relation} t)`
}
function sourceReferencePredicate() {
  return `(p.prosrc ilike '%xrpl_resource_restore_v1%' or p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' or p.prosrc ilike '%build_restored_accounting_state%' or p.prosrc ilike '%qualify_transfer_after_attempt_finalization%' or p.prosrc ilike '%qualify_transfer_on_completion%')`
}
function schedulerJsonSql() {
  return `(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%')`
}
function beforeSql() {
  return `with restore_relations as (
    select c.oid::bigint as oid,c.relname as relation_name,c.relkind,pg_total_relation_size(c.oid)::bigint as total_bytes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='xrpl_resource_restore_v1'
  ), target_functions as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,pg_get_function_identity_arguments(p.oid) as identity_arguments,p.oid::regprocedure::text as signature,
      encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid in (${RETIREMENT_FUNCTIONS.map((x) => `to_regprocedure(${lit(x)})`).join(',')})
  ), source_references as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,p.oid::regprocedure::text as signature,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and ${sourceReferencePredicate()}
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
  ${digestCte('sessions_digest','xrpl_steady_v1.sessions')},${digestCte('ticks_digest','xrpl_steady_v1.ticks')},${digestCte('attempts_digest','xrpl_resource_guard_v2.attempts')},${digestCte('accounting_digest','xrpl_resource_guard_v2.tick_accounting')},${digestCte('transfer_digest','xrpl_resource_guard_v2.transfer_qualifications')}
  select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
    'restoreRelations',coalesce((select jsonb_agg(to_jsonb(x) order by x.relation_name,x.relkind) from restore_relations x),'[]'::jsonb),
    'targetFunctions',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.signature) from target_functions x),'[]'::jsonb),
    'sourceReferences',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.signature) from source_references x),'[]'::jsonb),
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
    'scheduler',${schedulerJsonSql()}
  )::text as state;`
}
function afterSql() {
  return `with source_references as (
    select p.oid::bigint as oid,n.nspname as schema_name,p.proname as function_name,p.oid::regprocedure::text as signature
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind='f' and ${sourceReferencePredicate()}
  ),
  ${digestCte('sessions_digest','xrpl_steady_v1.sessions')},${digestCte('ticks_digest','xrpl_steady_v1.ticks')},${digestCte('attempts_digest','xrpl_resource_guard_v2.attempts')},${digestCte('accounting_digest','xrpl_resource_guard_v2.tick_accounting')},${digestCte('transfer_digest','xrpl_resource_guard_v2.transfer_qualifications')}
  select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
    'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
    'restoreRelationCount',(select count(*)::bigint from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='xrpl_resource_restore_v1'),
    'restoreFunctionCount',(select count(*)::bigint from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='xrpl_resource_restore_v1'),
    'targetFunctionsRemaining',(select count(*)::bigint from (values ${RETIREMENT_FUNCTIONS.map((x) => `(to_regprocedure(${lit(x)}))`).join(',')}) v(oid) where oid is not null),
    'sourceReferences',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.signature) from source_references x),'[]'::jsonb),
    'protectedDigests',jsonb_build_object('sessions',(select to_jsonb(x) from sessions_digest x),'ticks',(select to_jsonb(x) from ticks_digest x),'attempts',(select to_jsonb(x) from attempts_digest x),'tickAccounting',(select to_jsonb(x) from accounting_digest x),'transferQualifications',(select to_jsonb(x) from transfer_digest x)),
    'activeLegacyCronJobs',(select count(*)::bigint from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
    'runningGuardedSessions',(select count(*)::bigint from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
    'leasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased'),
    'liveLeasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
    'openAttempts',(select count(*)::bigint from xrpl_resource_guard_v2.attempts where status='open'),
    'scheduler',${schedulerJsonSql()}
  )::text as state;`
}
function lockCapabilitySql() {
  return `set local lock_timeout='5s';
lock table cron.job, supabase_migrations.schema_migrations in access share mode;
select jsonb_build_object('extensionOwnedAccessShareLock',true)::text as state;`
}
async function inspectBefore() { return stateRow(await managementQuery(beforeSql(), true)) }
async function inspectAfter() { return stateRow(await managementQuery(afterSql(), true)) }
async function inspectLockCapability() { return stateRow(await managementQuery(lockCapabilitySql(), true)) }

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
  const restoreRows = state.restoreRows ?? {}
  if ([restoreRows.targets, restoreRows.attemptRows, restoreRows.accountingRows].some((x) => Number(x) !== 0)) fail('revision-3 restore rows are not empty')
  const relationShape = (state.restoreRelations ?? []).map((x) => [x.relation_name, x.relkind])
  if (!same(relationShape, RESTORE_RELATIONS)) fail('restore relation inventory drifted')

  const targets = state.targetFunctions ?? []
  if (targets.length !== RETIREMENT_FUNCTIONS.length) fail('retirement function inventory drifted')
  for (const signature of RETIREMENT_FUNCTIONS) {
    const row = targets.find((x) => canonicalFunction(x) === signature)
    if (!row) fail(`retirement function missing: ${signature}`)
    if (row.source_sha256 !== EXPECTED_SOURCE_SHA.get(signature)) fail(`retirement function source drifted: ${signature}`)
    if (row.service_role_execute !== false || row.authenticated_execute !== false || row.anon_execute !== false) fail(`retired function regained execution: ${signature}`)
  }

  const refs = state.sourceReferences ?? []
  if (refs.length !== RETIREMENT_FUNCTIONS.length) fail('restore source-reference inventory drifted')
  const refSet = new Set(refs.map(canonicalFunction))
  for (const signature of RETIREMENT_FUNCTIONS) if (!refSet.has(signature)) fail(`expected internal restore source reference missing: ${signature}`)
  for (const ref of refs) if (ref.service_role_execute !== false) fail(`restore source reference regained service-role execution: ${canonicalFunction(ref)}`)

  const deps = state.dependentObjects ?? []
  if (deps.length !== EXPECTED_DEPENDENCIES.size) fail('retirement dependency inventory drifted')
  const actualDeps = new Set(deps.map((x) => `${x.dependent_object}|${x.referenced_object}|${x.deptype}`))
  for (const expected of EXPECTED_DEPENDENCIES) if (!actualDeps.has(expected)) fail(`retirement dependency edge drifted: ${expected}`)
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
function structuralState(state) {
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
  const planned = await loadPlan(sourceCommit)
  const state = await inspectBefore()
  validateBefore(state)
  const lockCapability = await inspectLockCapability()
  if (lockCapability.extensionOwnedAccessShareLock !== true) fail('extension-owned ACCESS SHARE lock capability unavailable')
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-prepare',
    sourceCommit,
    projectIdentityDigest: sha(env('SUPABASE_PROJECT_ID')),
    plan: {
      file: planned.file,
      retirementFunctions: RETIREMENT_FUNCTIONS,
      expectedSourceSha256: Object.fromEntries(EXPECTED_SOURCE_SHA),
      restoreTables: ['accounting_rows', 'attempt_rows', 'targets'],
      schema: 'xrpl_resource_restore_v1',
      cascade: false,
    },
    planDigestSha256: planned.planDigestSha256,
    structuralStateSha256: sha(JSON.stringify(structuralState(state))),
    classification: 'unapplied_expected',
    databaseBytes: Number(state.databaseBytes),
    maxMigrationVersion: state.maxMigrationVersion,
    schedulerSha256: sha(JSON.stringify(state.scheduler)),
    protectedDigests: state.protectedDigests,
    extensionOwnedAccessShareLockVerified: true,
    schedulerMigrationGuardStrategy: 'access_share_plus_transaction_pre_post_exact_recheck',
    extensionOwnedPrivilegeMutationPerformed: false,
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
  await writeJson(options.output, evidence)
  return evidence
}

function controlStateGuardSql(expectedScheduler, phase) {
  const tag = phase === 'before' ? 'pre_guard' : 'post_guard'
  const point = phase === 'before' ? 'before DROP' : 'after DROP'
  const expectedSchedulerJson = lit(JSON.stringify(expectedScheduler))
  return `do $${tag}$ begin
  if (select max(version::text) from supabase_migrations.schema_migrations) <> '${EXPECTED_MIGRATION_HEAD}' then raise exception 'migration head changed ${point}'; end if;
  if ${schedulerJsonSql()} <> ${expectedSchedulerJson}::jsonb then raise exception 'minute scheduler inventory changed ${point}'; end if;
end $${tag}$;`
}
function lockedGuardSql(expectedScheduler) {
  return `lock table xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.targets in access exclusive mode;
lock table xrpl_steady_v1.sessions, xrpl_steady_v1.ticks, xrpl_resource_guard_v2.attempts, xrpl_resource_guard_v2.tick_accounting, xrpl_resource_guard_v2.transfer_qualifications in share mode;
lock table cron.job, supabase_migrations.schema_migrations in access share mode;
do $guard$ begin
  if (select count(*) from xrpl_resource_restore_v1.targets) <> 0 or (select count(*) from xrpl_resource_restore_v1.attempt_rows) <> 0 or (select count(*) from xrpl_resource_restore_v1.accounting_rows) <> 0 then raise exception 'restore rows changed under lock'; end if;
  if (select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled and status='running') <> 0 then raise exception 'guarded session became running under lock'; end if;
  if (select count(*) from xrpl_steady_v1.ticks where status='leased') <> 0 then raise exception 'legacy tick became leased under lock'; end if;
  if (select count(*) from xrpl_resource_guard_v2.attempts where status='open') <> 0 then raise exception 'resource guard attempt became open under lock'; end if;
end $guard$;
${controlStateGuardSql(expectedScheduler, 'before')}`
}
async function apply(sourceCommit, options) {
  const authorizedPlan = options['authorized-plan']
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedPlan ?? '') || !/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid authorized digest')
  const before = await prepare(sourceCommit, {})
  if (before.planDigestSha256 !== authorizedPlan) fail('authorized restore schema retirement plan drifted')
  if (before.structuralStateSha256 !== authorizedState) fail('authorized restore schema retirement state drifted')
  const planned = await loadPlan(sourceCommit)
  const expectedScheduler = (await inspectBefore()).scheduler
  if (sha(JSON.stringify(expectedScheduler)) !== before.schedulerSha256) fail('scheduler changed between authorization revalidation and transaction assembly')
  const bundle = `begin; set local lock_timeout='5s'; set local statement_timeout='30s';\n${lockedGuardSql(expectedScheduler)}\n${planned.sql}\n${controlStateGuardSql(expectedScheduler, 'after')}\ncommit;`
  await managementQuery(bundle, false)
  const after = await inspectAfter()
  validateAfter(after)
  if (!same(before.protectedDigests, after.protectedDigests)) fail('restore schema retirement changed protected rows')
  if (before.maxMigrationVersion !== after.maxMigrationVersion) fail('restore schema retirement changed migration head')
  if (before.schedulerSha256 !== sha(JSON.stringify(after.scheduler))) fail('restore schema retirement changed scheduler')
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-apply',
    sourceCommit,
    projectIdentityDigest: before.projectIdentityDigest,
    planDigestSha256: authorizedPlan,
    authorizedStructuralStateSha256: authorizedState,
    classificationAfter: 'applied_consistent',
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: Number(after.databaseBytes),
    protectedDigestsBefore: before.protectedDigests,
    protectedDigestsAfter: after.protectedDigests,
    maxMigrationVersionBefore: before.maxMigrationVersion,
    maxMigrationVersionAfter: after.maxMigrationVersion,
    schedulerSha256Before: before.schedulerSha256,
    schedulerSha256After: sha(JSON.stringify(after.scheduler)),
    extensionOwnedAccessShareLockVerified: before.extensionOwnedAccessShareLockVerified,
    schedulerMigrationTransactionRevalidated: true,
    extensionOwnedPrivilegeMutationPerformed: false,
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
  await writeJson(options.output, evidence)
  return evidence
}
async function verify(sourceCommit, options) {
  if (!options['apply-evidence']) fail('missing --apply-evidence')
  const applied = JSON.parse(await readFile(resolve(options['apply-evidence']), 'utf8'))
  if (applied.sourceCommit !== sourceCommit || applied.classificationAfter !== 'applied_consistent') fail('apply evidence mismatch')
  if (applied.projectIdentityDigest !== sha(env('SUPABASE_PROJECT_ID'))) fail('apply evidence project mismatch')
  const state = await inspectAfter()
  validateAfter(state)
  if (!same(applied.protectedDigestsBefore, state.protectedDigests)) fail('independent verify protected rows drifted')
  if (applied.maxMigrationVersionBefore !== state.maxMigrationVersion) fail('independent verify migration head drifted')
  if (applied.schedulerSha256Before !== sha(JSON.stringify(state.scheduler))) fail('independent verify scheduler drifted')
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-schema-retirement-independent-verify',
    sourceCommit,
    classification: 'applied_consistent',
    protectedDigests: state.protectedDigests,
    maxMigrationVersion: state.maxMigrationVersion,
    schedulerSha256: sha(JSON.stringify(state.scheduler)),
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
  await writeJson(options.output, evidence)
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
