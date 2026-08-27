#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

function fail(message) { throw new Error(message) }
function requireEnv(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(args) {
  const out = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    const value = args[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    out[key.slice(2)] = value
  }
  return out
}

const RETIREMENT_FUNCTIONS = [
  'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)',
  'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)',
  'xrpl_resource_restore_v1.build_restored_accounting_state(text)',
  'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
  'xrpl_resource_guard_v2.qualify_transfer_on_completion()',
]
const MUTATION_CAPABILITY = /\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\b/iu

const SQL = String.raw`
with restore_relations as (
  select
    c.oid::bigint as oid,
    c.relname as relation_name,
    c.relkind,
    pg_total_relation_size(c.oid)::bigint as total_bytes
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='xrpl_resource_restore_v1'
), restore_functions as (
  select
    p.oid::bigint as oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.oid::regprocedure::text as signature,
    encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='xrpl_resource_restore_v1'
), target_functions as (
  select
    p.oid::bigint as oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.oid::regprocedure::text as signature,
    encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex') as source_sha256,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.oid in (
    to_regprocedure('public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)'),
    to_regprocedure('public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)'),
    to_regprocedure('xrpl_resource_restore_v1.build_restored_accounting_state(text)'),
    to_regprocedure('xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()'),
    to_regprocedure('xrpl_resource_guard_v2.qualify_transfer_on_completion()')
  )
), target_presence as (
  select wanted.signature, to_regprocedure(wanted.signature)::text as resolved_signature
  from (values
    ('public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)'),
    ('public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)'),
    ('xrpl_resource_restore_v1.build_restored_accounting_state(text)'),
    ('xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()'),
    ('xrpl_resource_guard_v2.qualify_transfer_on_completion()')
  ) wanted(signature)
), source_references as (
  select
    p.oid::bigint as oid,
    n.nspname as schema_name,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments,
    p.oid::regprocedure::text as signature,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_execute,
    p.prosrc ilike '%xrpl_resource_restore_v1%' as names_restore_schema,
    p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%' as names_qualify,
    p.prosrc ilike '%xrpl_restore_revision3_accounting_state%' as names_restore,
    p.prosrc ilike '%build_restored_accounting_state%' as names_builder,
    p.prosrc ilike '%qualify_transfer_after_attempt_finalization%' as names_attempt_trigger_fn,
    p.prosrc ilike '%qualify_transfer_on_completion%' as names_completion_trigger_fn
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (
    p.prosrc ilike '%xrpl_resource_restore_v1%'
    or p.prosrc ilike '%xrpl_qualify_revision3_accounting_transfer%'
    or p.prosrc ilike '%xrpl_restore_revision3_accounting_state%'
    or p.prosrc ilike '%build_restored_accounting_state%'
    or p.prosrc ilike '%qualify_transfer_after_attempt_finalization%'
    or p.prosrc ilike '%qualify_transfer_on_completion%'
  )
), target_oids as (
  select oid::oid from target_functions
), dependent_objects as (
  select distinct
    pg_describe_object(d.classid,d.objid,d.objsubid) as dependent_object,
    pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid) as referenced_object,
    d.deptype
  from pg_depend d
  where d.refobjid in (select oid from target_oids)
     or d.objid in (select oid from target_oids)
), trigger_bindings as (
  select
    tn.nspname as table_schema,
    tc.relname as table_name,
    tg.tgname as trigger_name,
    pn.nspname as function_schema,
    p.proname as function_name,
    pg_get_function_identity_arguments(p.oid) as identity_arguments
  from pg_trigger tg
  join pg_class tc on tc.oid=tg.tgrelid
  join pg_namespace tn on tn.oid=tc.relnamespace
  join pg_proc p on p.oid=tg.tgfoid
  join pg_namespace pn on pn.oid=p.pronamespace
  where not tg.tgisinternal and p.oid in (select oid from target_oids)
), referencing_views as (
  select schemaname as schema_name, viewname as view_name
  from pg_views
  where definition ilike '%xrpl_resource_restore_v1%'
     or definition ilike '%xrpl_qualify_revision3_accounting_transfer%'
     or definition ilike '%xrpl_restore_revision3_accounting_state%'
     or definition ilike '%build_restored_accounting_state%'
     or definition ilike '%qualify_transfer_after_attempt_finalization%'
     or definition ilike '%qualify_transfer_on_completion%'
), transfer_digest as (
  select count(*)::bigint as row_count,
    encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by session_id),''),'UTF8'),'sha256'),'hex') as row_digest
  from xrpl_resource_guard_v2.transfer_qualifications t
), restore_rows as (
  select jsonb_build_object(
    'targets',(select count(*)::bigint from xrpl_resource_restore_v1.targets),
    'attemptRows',(select count(*)::bigint from xrpl_resource_restore_v1.attempt_rows),
    'accountingRows',(select count(*)::bigint from xrpl_resource_restore_v1.accounting_rows)
  ) as value
)
select jsonb_build_object(
  'schemaVersion',1,
  'observedAt',clock_timestamp(),
  'databaseBytes',pg_database_size(current_database())::bigint,
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
  'restoreRelations',coalesce((select jsonb_agg(to_jsonb(x) order by x.relation_name,x.relkind) from restore_relations x),'[]'::jsonb),
  'restoreFunctions',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from restore_functions x),'[]'::jsonb),
  'targetPresence',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from target_presence x),'[]'::jsonb),
  'targetFunctions',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from target_functions x),'[]'::jsonb),
  'sourceReferences',coalesce((select jsonb_agg(to_jsonb(x) order by x.signature) from source_references x),'[]'::jsonb),
  'dependentObjects',coalesce((select jsonb_agg(to_jsonb(x) order by x.dependent_object,x.referenced_object,x.deptype) from dependent_objects x),'[]'::jsonb),
  'triggerBindings',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_schema,x.table_name,x.trigger_name) from trigger_bindings x),'[]'::jsonb),
  'referencingViews',coalesce((select jsonb_agg(to_jsonb(x) order by x.schema_name,x.view_name) from referencing_views x),'[]'::jsonb),
  'restoreRows',(select value from restore_rows),
  'transferQualifications',(select to_jsonb(x) from transfer_digest x),
  'protectedCounts',jsonb_build_object(
    'sessions',(select count(*)::bigint from xrpl_steady_v1.sessions),
    'ticks',(select count(*)::bigint from xrpl_steady_v1.ticks),
    'attempts',(select count(*)::bigint from xrpl_resource_guard_v2.attempts),
    'tickAccounting',(select count(*)::bigint from xrpl_resource_guard_v2.tick_accounting),
    'transferQualifications',(select count(*)::bigint from xrpl_resource_guard_v2.transfer_qualifications)
  ),
  'activeLegacyCronJobs',(select count(*)::bigint from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
  'runningGuardedSessions',(select count(*)::bigint from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
  'leasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased'),
  'liveLeasedTicks',(select count(*)::bigint from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
  'openAttempts',(select count(*)::bigint from xrpl_resource_guard_v2.attempts where status='open'),
  'scheduler',(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%'),
  'safetyBoundary',jsonb_build_object(
    'productionDatabaseReadOnly',true,
    'measurementOnly',true,
    'functionDropAuthorized',false,
    'schemaDropAuthorized',false,
    'tableDropAuthorized',false,
    'cascadeAuthorized',false,
    'rowMutationAuthorized',false,
    'schedulerMutationAuthorized',false,
    'deploymentAuthorized',false,
    'r5RearmAuthorized',false,
    'mainnetDisabled',true
  )
)::text as state;
`

if (MUTATION_CAPABILITY.test(SQL)) fail('restore schema retirement preflight SQL contains forbidden mutation capability')

async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, read_only: true }),
    signal: AbortSignal.timeout(60000),
  })
  const text = await response.text()
  if (!response.ok) fail(`management query failed: ${response.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}
function findState(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('unexpected management query result')
  const raw = rows[0]?.state
  if (typeof raw === 'string') return JSON.parse(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
  fail('restore schema retirement preflight state missing')
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
const outputDir = options['output-dir'] ?? 'r5-restore-schema-retirement-preflight'
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')

const state = findState(await managementQuery(SQL))
const safety = state.safetyBoundary ?? {}
for (const key of ['productionDatabaseReadOnly','measurementOnly','mainnetDisabled']) if (safety[key] !== true) fail(`missing safety boundary: ${key}`)
for (const key of ['functionDropAuthorized','schemaDropAuthorized','tableDropAuthorized','cascadeAuthorized','rowMutationAuthorized','schedulerMutationAuthorized','deploymentAuthorized','r5RearmAuthorized']) {
  if (safety[key] !== false) fail(`preflight unexpectedly authorizes: ${key}`)
}
if (state.restoreSchemaExists !== true) fail('revision-3 restore schema is already absent')
const rows = state.restoreRows ?? {}
if ([rows.targets, rows.attemptRows, rows.accountingRows].some((value) => Number(value) !== 0)) fail('restore schema still contains historical rows')
if (Number(state.activeLegacyCronJobs) !== 0) fail('legacy steady cron is active')
if (Number(state.runningGuardedSessions) !== 0) fail('guarded steady session is running')
if (Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0) fail('legacy steady lease remains')
if (Number(state.openAttempts) !== 0) fail('revision-3 open attempt remains')

const targetPresence = Array.isArray(state.targetPresence) ? state.targetPresence : []
if (targetPresence.length !== RETIREMENT_FUNCTIONS.length) fail('target presence inventory length drifted')
for (const signature of RETIREMENT_FUNCTIONS) {
  const row = targetPresence.find((entry) => entry.signature === signature)
  if (!row?.resolved_signature) fail(`retirement function missing before preflight: ${signature}`)
}
const targetFunctions = Array.isArray(state.targetFunctions) ? state.targetFunctions : []
if (targetFunctions.length !== RETIREMENT_FUNCTIONS.length) fail('retirement function inventory drifted')
for (const row of targetFunctions) {
  if (row.service_role_execute !== false || row.authenticated_execute !== false || row.anon_execute !== false) {
    fail(`retired function regained execution privilege: ${row.signature}`)
  }
}
if ((state.triggerBindings ?? []).length !== 0) fail('retirement target still has a trigger binding')
if ((state.referencingViews ?? []).length !== 0) fail('retirement target still has a referencing view')

const evidence = {
  sourceCommit,
  querySha256: createHash('sha256').update(SQL).digest('hex'),
  retirementFunctions: RETIREMENT_FUNCTIONS,
  state,
}
await mkdir(outputDir, { recursive: true })
const serialized = `${JSON.stringify(evidence, null, 2)}\n`
await writeFile(`${outputDir}/restore-schema-retirement-preflight.json`, serialized)
await writeFile(`${outputDir}/restore-schema-retirement-preflight.sha256`, `${createHash('sha256').update(serialized).digest('hex')}\n`)

const summary = [
  '## R5 revision-3 restore schema retirement read-only preflight',
  '',
  `- source commit: \`${sourceCommit}\``,
  `- restore rows targets / attempts / accounting: \`${rows.targets} / ${rows.attemptRows} / ${rows.accountingRows}\``,
  `- restore relations / schema-local functions: \`${state.restoreRelations?.length ?? 0} / ${state.restoreFunctions?.length ?? 0}\``,
  `- exact retirement functions present: \`${targetFunctions.length} / ${RETIREMENT_FUNCTIONS.length}\``,
  `- source references / dependency edges: \`${state.sourceReferences?.length ?? 0} / ${state.dependentObjects?.length ?? 0}\``,
  `- trigger bindings / referencing views: \`${state.triggerBindings?.length ?? 0} / ${state.referencingViews?.length ?? 0}\``,
  `- active legacy cron / running guarded / leased / live leased / open attempts: \`${state.activeLegacyCronJobs} / ${state.runningGuardedSessions} / ${state.leasedTicks} / ${state.liveLeasedTicks} / ${state.openAttempts}\``,
  `- transfer qualifications rows / digest: \`${state.transferQualifications?.row_count ?? 0} / ${state.transferQualifications?.row_digest ?? '<missing>'}\``,
  '- mutation authorized/performed: `false / false`',
  '',
  'This probe inventories the exact objects and dependency edges needed to build a later no-CASCADE retirement plan. It does not authorize or perform any DROP, row mutation, scheduler/deployment change, R5 rearm, or Mainnet action.',
].join('\n')
await writeFile(`${outputDir}/summary.md`, `${summary}\n`)
process.stdout.write(`${JSON.stringify(evidence)}\n`)
