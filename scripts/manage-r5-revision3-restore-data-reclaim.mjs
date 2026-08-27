#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SQL_PATH = 'ops/production-sql/20260826161000_xrpl_revision3_restore_data_reclaim.sql'
const RESTORE_TABLES = ['attempt_rows', 'accounting_rows', 'targets']
const RETIRED_FUNCTIONS = [
  { key: 'qualifyTransfer', signature: 'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)' },
  { key: 'restoreState', signature: 'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)' },
  { key: 'restoreBuilder', signature: 'xrpl_resource_restore_v1.build_restored_accounting_state(text)' },
  { key: 'attemptTransferTriggerFunction', signature: 'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()' },
  { key: 'completionTransferTriggerFunction', signature: 'xrpl_resource_guard_v2.qualify_transfer_on_completion()' },
]

function fail(message) { throw new Error(message) }
function sha(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function lit(value) { return `'${String(value).replaceAll("'", "''")}'` }
function parse(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let index = 0; index < rest.length; index += 2) {
    if (!rest[index]?.startsWith('--') || rest[index + 1] == null || rest[index + 1].startsWith('--')) {
      fail(`invalid argument near ${rest[index] ?? '<end>'}`)
    }
    options[rest[index].slice(2)] = rest[index + 1]
  }
  return { command, options }
}
function env(name, pattern = null) {
  const value = process.env[name]
  if (!value) fail(`missing ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function rows(body) {
  if (Array.isArray(body)) return body
  for (const value of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(value)) return value
  }
  fail('Management API response contains no rows')
}
async function query(sql, readOnly) {
  const project = env('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = env('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
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
async function out(path, value) {
  if (!path) return
  const output = resolve(path)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)
}
function validateSource(options) {
  if (!/^[a-f0-9]{40}$/u.test(options['source-commit'] ?? '')) fail('invalid --source-commit')
  return options['source-commit']
}

async function plan(sourceCommit) {
  const sql = await readFile(SQL_PATH, 'utf8')
  const normalized = sql.toLowerCase().replace(/\s+/gu, ' ').trim()
  const exact = 'truncate table xrpl_resource_restore_v1.attempt_rows, xrpl_resource_restore_v1.accounting_rows, xrpl_resource_restore_v1.targets;'
  if (normalized !== exact) fail('restore reclaim SQL must be the exact three-table TRUNCATE plan')
  if ((normalized.match(/\btruncate\s+table\b/gu) ?? []).length !== 1) fail('restore reclaim SQL must contain exactly one TRUNCATE TABLE')
  for (const table of RESTORE_TABLES) {
    if (!normalized.includes(`xrpl_resource_restore_v1.${table}`)) fail(`restore reclaim SQL missing table ${table}`)
  }
  for (const re of [
    /\bcascade\b/iu,
    /\brestart\s+identity\b/iu,
    /\bdelete\s+from\b/iu,
    /\binsert\s+into\b/iu,
    /\bupdate\b/iu,
    /\balter\b/iu,
    /\bdrop\b/iu,
    /\bcreate\b/iu,
    /\bgrant\b/iu,
    /\brevoke\b/iu,
    /\bvacuum\b/iu,
    /\breindex\b/iu,
    /\bcluster\b/iu,
    /\bcron\./iu,
    /\bnet\./iu,
    /\bsupabase_migrations\b/iu,
  ]) {
    if (re.test(sql)) fail(`restore reclaim SQL contains forbidden capability: ${re}`)
  }
  const file = { path: SQL_PATH, sha256: sha(sql), bytes: Buffer.byteLength(sql, 'utf8') }
  const digestInput = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-data-reclaim-plan',
    sourceCommit,
    file,
    tables: RESTORE_TABLES.map((name) => `xrpl_resource_restore_v1.${name}`),
    retainSchemaObjects: true,
    cascade: false,
    restartIdentity: false,
  }
  return { sql, file, digestInput, planDigestSha256: sha(JSON.stringify(digestInput)) }
}

function functionJson(entry) {
  return `${lit(entry.key)},(select jsonb_build_object(`
    + `'signature',${lit(entry.signature)},`
    + `'sourceSha256',encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex'),`
    + `'serviceRoleExecute',has_function_privilege('service_role',p.oid,'EXECUTE'),`
    + `'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),`
    + `'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE')) `
    + `from pg_proc p where p.oid=${lit(entry.signature)}::regprocedure)`
}

function inspectionSql() {
  const functions = RETIRED_FUNCTIONS.map(functionJson).join(',\n')
  return `with restore_tables as (
  select
    c.relname as table_name,
    c.oid::bigint as relation_oid,
    pg_total_relation_size(c.oid)::bigint as total_bytes
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='xrpl_resource_restore_v1'
    and c.relkind='r'
    and c.relname in ('attempt_rows','accounting_rows','targets')
), target_digest as (
  select count(*)::bigint as row_count,
    encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by target_id),''),'UTF8'),'sha256'),'hex') as row_digest
  from xrpl_resource_restore_v1.targets t
), attempt_digest as (
  select count(*)::bigint as row_count,
    encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by target_id,session_id,scheduled_minute),''),'UTF8'),'sha256'),'hex') as row_digest
  from xrpl_resource_restore_v1.attempt_rows t
), accounting_digest as (
  select count(*)::bigint as row_count,
    encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by target_id,session_id,tick_id,accounting_digest),''),'UTF8'),'sha256'),'hex') as row_digest
  from xrpl_resource_restore_v1.accounting_rows t
), transfer_digest as (
  select count(*)::bigint as row_count,
    encode(extensions.digest(convert_to(coalesce(string_agg(to_jsonb(t)::text,E'\\n' order by session_id),''),'UTF8'),'sha256'),'hex') as row_digest
  from xrpl_resource_guard_v2.transfer_qualifications t
), transfer_triggers as (
  select jsonb_build_object(
    'triggerName',t.tgname,
    'enabled',t.tgenabled,
    'tableSchema',tn.nspname,
    'tableName',tc.relname,
    'functionSchema',fn.nspname,
    'functionName',p.proname
  ) as value
  from pg_trigger t
  join pg_class tc on tc.oid=t.tgrelid
  join pg_namespace tn on tn.oid=tc.relnamespace
  join pg_proc p on p.oid=t.tgfoid
  join pg_namespace fn on fn.oid=p.pronamespace
  where not t.tgisinternal and (
    t.tgname='xrpl_revision3_transfer_after_attempt_finalization'
    or (fn.nspname='xrpl_resource_guard_v2' and p.proname in ('qualify_transfer_after_attempt_finalization','qualify_transfer_on_completion'))
  )
)
select jsonb_build_object(
  'databaseBytes',pg_database_size(current_database()),
  'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
  'restoreSchemaExists',exists(select 1 from pg_namespace where nspname='xrpl_resource_restore_v1'),
  'restoreTables',coalesce((select jsonb_agg(to_jsonb(x) order by x.table_name) from restore_tables x),'[]'::jsonb),
  'restoreTableBytes',coalesce((select sum(total_bytes)::bigint from restore_tables),0),
  'restoreRows',jsonb_build_object(
    'targets',(select row_count from target_digest),
    'attemptRows',(select row_count from attempt_digest),
    'accountingRows',(select row_count from accounting_digest)
  ),
  'restoreDigests',jsonb_build_object(
    'targets',(select row_digest from target_digest),
    'attemptRows',(select row_digest from attempt_digest),
    'accountingRows',(select row_digest from accounting_digest)
  ),
  'transferQualifications',(select to_jsonb(x) from transfer_digest x),
  'functions',jsonb_build_object(${functions}),
  'activeLegacyCronJobs',(select count(*) from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
  'runningGuardedSessions',(select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
  'leasedTicks',(select count(*) from xrpl_steady_v1.ticks where status='leased'),
  'liveLeasedTicks',(select count(*) from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
  'openAttempts',(select count(*) from xrpl_resource_guard_v2.attempts where status='open'),
  'transferTriggerBindings',coalesce((select jsonb_agg(value) from transfer_triggers),'[]'::jsonb),
  'protectedCounts',jsonb_build_object(
    'sessions',(select count(*) from xrpl_steady_v1.sessions),
    'ticks',(select count(*) from xrpl_steady_v1.ticks),
    'attempts',(select count(*) from xrpl_resource_guard_v2.attempts),
    'tickAccounting',(select count(*) from xrpl_resource_guard_v2.tick_accounting),
    'transferQualifications',(select count(*) from xrpl_resource_guard_v2.transfer_qualifications)
  ),
  'scheduler',(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%')
)::text as state;`
}

async function inspect() { return stateRow(await query(inspectionSql(), true)) }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }
function tableMap(state) { return new Map((state.restoreTables ?? []).map((row) => [row.table_name, row])) }

function validateCommonState(state) {
  if (state.restoreSchemaExists !== true) fail('revision-3 restore schema is missing')
  const tables = tableMap(state)
  for (const table of RESTORE_TABLES) if (!tables.has(table)) fail(`restore table missing: ${table}`)
  for (const entry of RETIRED_FUNCTIONS) {
    const value = state.functions?.[entry.key]
    if (!value) fail(`retired restore path function missing: ${entry.key}`)
    if (value.serviceRoleExecute !== false || value.authenticatedExecute !== false || value.anonExecute !== false) {
      fail(`retired restore path function regained execution: ${entry.key}`)
    }
  }
  if (Number(state.activeLegacyCronJobs) !== 0) fail('legacy steady cron is active')
  if (Number(state.runningGuardedSessions) !== 0) fail('guarded steady session is running')
  if (Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0) fail('legacy steady lease remains')
  if (Number(state.openAttempts) !== 0) fail('revision-3 open attempt remains')
  if ((state.transferTriggerBindings ?? []).length !== 0) fail('revision-3 transfer trigger binding remains')
}
function classification(state) {
  const counts = state.restoreRows ?? {}
  const values = [Number(counts.targets), Number(counts.attemptRows), Number(counts.accountingRows)]
  if (values.every((value) => Number.isFinite(value) && value > 0)) return 'unapplied_expected'
  if (values.every((value) => value === 0)) return 'applied_consistent'
  return 'drift'
}
function validateBefore(state) {
  validateCommonState(state)
  if (classification(state) !== 'unapplied_expected') fail('restore data reclaim pre-state drifted')
}
function validateAfter(state) {
  validateCommonState(state)
  if (classification(state) !== 'applied_consistent') fail('restore data reclaim post-state drifted')
}
function structural(state) {
  return {
    maxMigrationVersion: state.maxMigrationVersion,
    restoreSchemaExists: state.restoreSchemaExists,
    restoreTables: state.restoreTables,
    restoreRows: state.restoreRows,
    restoreDigests: state.restoreDigests,
    transferQualifications: state.transferQualifications,
    functions: state.functions,
    activeLegacyCronJobs: Number(state.activeLegacyCronJobs),
    runningGuardedSessions: Number(state.runningGuardedSessions),
    leasedTicks: Number(state.leasedTicks),
    liveLeasedTicks: Number(state.liveLeasedTicks),
    openAttempts: Number(state.openAttempts),
    transferTriggerBindings: state.transferTriggerBindings ?? [],
    protectedCounts: state.protectedCounts,
    scheduler: state.scheduler,
  }
}

function semanticPreflightState(envelope, sourceCommit) {
  const state = envelope.state ?? {}
  return {
    schemaVersion: envelope.schemaVersion ?? null,
    sourceCommit,
    querySha256: envelope.querySha256 ?? null,
    targets: state.targets ?? {},
    directConsumers: state.directConsumers ?? [],
    directCallers: state.directCallers ?? [],
    triggerBindings: state.triggerBindings ?? [],
    views: state.views ?? [],
    revision4RuntimeConsumerCount: state.revision4RuntimeConsumerCount ?? null,
    revision3Sessions: state.revision3Sessions ?? {},
    transferQualificationCoverage: state.transferQualificationCoverage ?? {},
    guardAttempts: state.guardAttempts ?? {},
    reclaimEvidence: state.reclaimEvidence ?? {},
    futureDemandEvidence: state.futureDemandEvidence ?? {},
  }
}

async function loadPreflight(path, sourceCommit) {
  if (!path) fail('missing --preflight-evidence')
  const raw = await readFile(resolve(path), 'utf8')
  const envelope = JSON.parse(raw)
  if (envelope?.sourceCommit !== sourceCommit) fail('restore reclaim preflight source commit mismatch')
  const state = envelope?.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) fail('restore reclaim preflight state missing')
  const safety = state.safetyBoundary ?? {}
  for (const key of ['probeReadOnly', 'measurementOnly', 'mainnetDisabled']) {
    if (safety[key] !== true) fail(`restore reclaim preflight safety boundary missing: ${key}`)
  }
  for (const key of [
    'restoreReclaimAuthorized',
    'functionRetirementAuthorized',
    'rowMutationAuthorized',
    'schemaMutationAuthorized',
    'vacuumAuthorized',
    'schedulerMutationAuthorized',
    'deploymentAuthorized',
    'r5RestartAuthorized',
  ]) {
    if (safety[key] !== false) fail(`restore reclaim preflight unexpectedly authorizes: ${key}`)
  }
  if (state.reclaimEvidence?.restoreSchemaRemovalProvenSafe !== true) fail('restore reclaim preflight has not proven safe removal')
  if (state.reclaimEvidence?.futureRevision3QualificationDemandProvenClosed !== true) fail('future revision-3 qualification demand is not proven closed')
  if (state.reclaimEvidence?.allRestoreTargetsDurablyQualified !== true) fail('not every restore target is durably qualified')
  if (state.reclaimEvidence?.allTransferQualificationsBelongToCompletedGuardedSessions !== true) fail('transfer qualification ownership is not proven')
  if (state.reclaimEvidence?.noRevision4RuntimeConsumers !== true) fail('revision-4 runtime restore consumer remains')
  if (state.reclaimEvidence?.noOpenGuardAttempts !== true) fail('open resource-guard attempt remains')
  const semanticState = semanticPreflightState(envelope, sourceCommit)
  return { envelope, semanticState, stateSha256: sha(JSON.stringify(semanticState)) }
}

async function prepare(sourceCommit, options) {
  const planned = await plan(sourceCommit)
  const preflight = await loadPreflight(options['preflight-evidence'], sourceCommit)
  const state = await inspect()
  validateBefore(state)
  const structure = structural(state)
  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-data-reclaim-prepare',
    sourceCommit,
    projectIdentityDigest: sha(env('SUPABASE_PROJECT_ID')),
    plan: { file: planned.file, tables: RESTORE_TABLES.map((name) => `xrpl_resource_restore_v1.${name}`) },
    planDigestSha256: planned.planDigestSha256,
    preflightStateSha256: preflight.stateSha256,
    structuralStateSha256: sha(JSON.stringify(structure)),
    classification: classification(state),
    databaseBytes: Number(state.databaseBytes),
    restoreTableBytes: Number(state.restoreTableBytes),
    restoreTables: state.restoreTables,
    restoreRows: state.restoreRows,
    restoreDigests: state.restoreDigests,
    transferQualifications: state.transferQualifications,
    functions: state.functions,
    maxMigrationVersion: state.maxMigrationVersion,
    schedulerSha256: sha(JSON.stringify(state.scheduler)),
    protectedCounts: state.protectedCounts,
    productionDatabaseReadOnly: true,
    restoreDataReclaimAuthorized: false,
    truncateAuthorized: false,
    restoreSchemaDropAuthorized: false,
    functionDropAuthorized: false,
    cascadeAuthorized: false,
    vacuumAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    r5RearmAuthorized: false,
    mainnetDisabled: true,
  }
  await out(options.output, evidence)
  return evidence
}

async function apply(sourceCommit, options) {
  const authorizedPlan = options['authorized-plan']
  const authorizedState = options['authorized-state']
  const authorizedPreflight = options['authorized-preflight']
  for (const [name, value] of [['plan', authorizedPlan], ['state', authorizedState], ['preflight', authorizedPreflight]]) {
    if (!/^[a-f0-9]{64}$/u.test(value ?? '')) fail(`invalid authorized ${name} digest`)
  }
  const before = await prepare(sourceCommit, options)
  if (before.planDigestSha256 !== authorizedPlan
    || before.structuralStateSha256 !== authorizedState
    || before.preflightStateSha256 !== authorizedPreflight) {
    fail('authorized restore reclaim state, preflight, or plan drifted')
  }
  const planned = await plan(sourceCommit)
  await query(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${planned.sql}\ncommit;`, false)
  const after = await inspect()
  validateAfter(after)

  const beforeTables = tableMap({ restoreTables: before.restoreTables })
  const afterTables = tableMap(after)
  for (const table of RESTORE_TABLES) {
    const beforeOid = Number(beforeTables.get(table)?.relation_oid)
    const afterOid = Number(afterTables.get(table)?.relation_oid)
    if (!Number.isFinite(beforeOid) || !Number.isFinite(afterOid) || beforeOid !== afterOid) {
      fail(`restore relation oid changed: ${table}`)
    }
  }

  if (!same(before.protectedCounts, after.protectedCounts)) fail('restore reclaim changed protected row counts')
  if (before.maxMigrationVersion !== after.maxMigrationVersion) fail('restore reclaim changed migration head')
  if (before.schedulerSha256 !== sha(JSON.stringify(after.scheduler))) fail('restore reclaim changed scheduler')
  if (!same(before.functions, after.functions)) fail('restore reclaim changed retired function identity or privileges')
  if (!same(before.transferQualifications, after.transferQualifications)) fail('restore reclaim changed durable transfer qualifications')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-revision3-restore-data-reclaim-apply',
    sourceCommit,
    planDigestSha256: authorizedPlan,
    authorizedStructuralStateSha256: authorizedState,
    authorizedPreflightStateSha256: authorizedPreflight,
    classificationAfter: 'applied_consistent',
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: Number(after.databaseBytes),
    databaseBytesReclaimed: Math.max(0, Number(before.databaseBytes) - Number(after.databaseBytes)),
    restoreTableBytesBefore: before.restoreTableBytes,
    restoreTableBytesAfter: Number(after.restoreTableBytes),
    restoreTableBytesReclaimed: Math.max(0, Number(before.restoreTableBytes) - Number(after.restoreTableBytes)),
    restoreTablesBefore: before.restoreTables,
    restoreTablesAfter: after.restoreTables,
    restoreRowsBefore: before.restoreRows,
    restoreRowsAfter: after.restoreRows,
    restoreDigestsBefore: before.restoreDigests,
    transferQualificationsBefore: before.transferQualifications,
    transferQualificationsAfter: after.transferQualifications,
    protectedCountsBefore: before.protectedCounts,
    protectedCountsAfter: after.protectedCounts,
    restoreDataReclaimPerformed: true,
    truncatePerformed: true,
    restoreRowsRemoved: true,
    schemaObjectMutationPerformed: false,
    restoreSchemaDropPerformed: false,
    functionDropPerformed: false,
    cascadePerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    r5RearmPerformed: false,
    mainnetDisabled: true,
    postVerificationReadOnly: true,
  }
  await out(options.output, evidence)
  return evidence
}

const { command, options } = parse(process.argv.slice(2))
const sourceCommit = validateSource(options)
let result
if (command === 'prepare') result = await prepare(sourceCommit, options)
else if (command === 'apply') result = await apply(sourceCommit, options)
else fail('command must be prepare or apply')
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
