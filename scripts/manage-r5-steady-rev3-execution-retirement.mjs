#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const SQL_PATH = 'ops/production-sql/20260825172000_xrpl_steady_rev3_execution_retirement.sql'
const EXPECTED_TRIGGER = {
  tableSchema: 'xrpl_resource_guard_v2',
  tableName: 'attempts',
  triggerName: 'xrpl_revision3_transfer_after_attempt_finalization',
  functionSchema: 'xrpl_resource_guard_v2',
  functionName: 'qualify_transfer_after_attempt_finalization',
}
const TARGETS = [
  { key: 'prepareSteady', signature: 'public.xrpl_prepare_network_steady_session(text,timestamp with time zone)' },
  { key: 'claimSteady', signature: 'public.xrpl_claim_network_steady_tick(text,timestamp with time zone,timestamp with time zone,integer)' },
  { key: 'recordAccounting', signature: 'public.xrpl_record_revision3_tick_accounting(text,text,timestamp with time zone,text,jsonb)' },
  { key: 'completeSteady', signature: 'public.xrpl_complete_network_steady_tick(text,text,timestamp with time zone,text,text,numeric,numeric,numeric)' },
  { key: 'beginAttempt', signature: 'public.xrpl_begin_revision3_attempt(text,text,timestamp with time zone,timestamp with time zone)' },
  { key: 'finalizeAttempt', signature: 'public.xrpl_finalize_revision3_attempt(text,text,text,text,bigint,text,text,timestamp with time zone)' },
  { key: 'attemptTransferTriggerFunction', signature: 'xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()' },
  { key: 'completionTransferTriggerFunction', signature: 'xrpl_resource_guard_v2.qualify_transfer_on_completion()' },
]
const ALREADY_RETIRED = [
  { key: 'qualifyTransfer', signature: 'public.xrpl_qualify_revision3_accounting_transfer(text,timestamp with time zone)' },
  { key: 'restoreState', signature: 'public.xrpl_restore_revision3_accounting_state(text,text,jsonb,text,timestamp with time zone)' },
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
  const exactDrop = 'drop trigger xrpl_revision3_transfer_after_attempt_finalization on xrpl_resource_guard_v2.attempts;'
  if (!normalized.includes(exactDrop)) fail('retirement SQL missing exact trigger drop')
  if ((normalized.match(/\bdrop\s+trigger\b/gu) ?? []).length !== 1) fail('retirement SQL must contain exactly one trigger drop')
  for (const re of [
    /\bdelete\s+from\b/iu,
    /\binsert\s+into\b/iu,
    /\bupdate\b/iu,
    /\balter\b/iu,
    /\bdrop\s+(function|table|schema|index|view|materialized)\b/iu,
    /\btruncate\b/iu,
    /\bvacuum\b/iu,
    /\bcreate\b/iu,
    /\bgrant\b/iu,
    /\bcron\./iu,
    /\bnet\./iu,
    /\bsupabase_migrations\b/iu,
  ]) {
    if (re.test(sql)) fail(`retirement SQL contains forbidden capability: ${re}`)
  }
  for (const entry of TARGETS) {
    if (!sql.includes(`revoke all privileges on function ${entry.signature}`)) fail(`retirement SQL missing target ${entry.key}`)
  }
  for (const entry of ALREADY_RETIRED) {
    if (sql.includes(`revoke all privileges on function ${entry.signature}`)) fail(`retirement SQL expands into already-retired proof path: ${entry.key}`)
  }
  const file = { path: SQL_PATH, sha256: sha(sql), bytes: Buffer.byteLength(sql, 'utf8') }
  const digestInput = {
    schemaVersion: 2,
    purpose: 'r5-steady-rev3-execution-retirement-plan',
    sourceCommit,
    file,
    exactTriggerDrop: EXPECTED_TRIGGER,
    targets: TARGETS.map((entry) => entry.signature),
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
  const targets = TARGETS.map(functionJson).join(',\n')
  const alreadyRetired = ALREADY_RETIRED.map(functionJson).join(',\n')
  return `select jsonb_build_object(
'databaseBytes',pg_database_size(current_database()),
'maxMigrationVersion',(select max(version::text) from supabase_migrations.schema_migrations),
'targets',jsonb_build_object(${targets}),
'alreadyRetired',jsonb_build_object(${alreadyRetired}),
'legacyCronJobs',(select count(*) from cron.job where jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%'),
'activeLegacyCronJobs',(select count(*) from cron.job where active and (jobname='xrpl-lending-monitor-steady-qualification-minute' or command::text ilike '%xrpl-steady-batch-tick%')),
'guardedSessions',(select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled),
'runningGuardedSessions',(select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled and status='running'),
'noncompletedGuardedSessions',(select count(*) from xrpl_steady_v1.sessions where resource_guard_enabled and status<>'completed'),
'leasedTicks',(select count(*) from xrpl_steady_v1.ticks where status='leased'),
'liveLeasedTicks',(select count(*) from xrpl_steady_v1.ticks where status='leased' and lease_expires_at>clock_timestamp()),
'openAttempts',(select count(*) from xrpl_resource_guard_v2.attempts where status='open'),
'transferTriggerBindings',(select coalesce(jsonb_agg(jsonb_build_object(
  'triggerName',t.tgname,
  'enabled',t.tgenabled,
  'tableSchema',tn.nspname,
  'tableName',tc.relname,
  'functionSchema',fn.nspname,
  'functionName',p.proname,
  'functionSourceSha256',encode(extensions.digest(convert_to(p.prosrc,'UTF8'),'sha256'),'hex')
) order by t.tgname),'[]'::jsonb)
from pg_trigger t
join pg_class tc on tc.oid=t.tgrelid
join pg_namespace tn on tn.oid=tc.relnamespace
join pg_proc p on p.oid=t.tgfoid
join pg_namespace fn on fn.oid=p.pronamespace
where not t.tgisinternal and (
  t.tgname='xrpl_revision3_transfer_after_attempt_finalization'
  or (fn.nspname='xrpl_resource_guard_v2' and p.proname in ('qualify_transfer_after_attempt_finalization','qualify_transfer_on_completion'))
)),
'counts',jsonb_build_object(
  'sessions',(select count(*) from xrpl_steady_v1.sessions),
  'ticks',(select count(*) from xrpl_steady_v1.ticks),
  'attempts',(select count(*) from xrpl_resource_guard_v2.attempts),
  'tickAccounting',(select count(*) from xrpl_resource_guard_v2.tick_accounting),
  'transferQualifications',(select count(*) from xrpl_resource_guard_v2.transfer_qualifications),
  'restoreTargets',(select count(*) from xrpl_resource_restore_v1.targets),
  'restoreAttemptRows',(select count(*) from xrpl_resource_restore_v1.attempt_rows),
  'restoreAccountingRows',(select count(*) from xrpl_resource_restore_v1.accounting_rows)
),
'scheduler',(select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'jobName',jobname,'schedule',schedule,'active',active,'commandSha256',encode(extensions.digest(command::text,'sha256'),'hex')) order by jobid),'[]'::jsonb) from cron.job where jobname in ('xrpl-lending-monitor-minute','xrpl-lending-monitor-steady-qualification-minute') or command::text ilike '%xrpl-steady-batch-tick%')
)::text as state;`
}
function expectedTriggerBinding(value) {
  return value?.triggerName === EXPECTED_TRIGGER.triggerName
    && value?.tableSchema === EXPECTED_TRIGGER.tableSchema
    && value?.tableName === EXPECTED_TRIGGER.tableName
    && value?.functionSchema === EXPECTED_TRIGGER.functionSchema
    && value?.functionName === EXPECTED_TRIGGER.functionName
}
function classification(state) {
  const targetValues = TARGETS.map((entry) => state.targets?.[entry.key])
  const bindings = Array.isArray(state.transferTriggerBindings) ? state.transferTriggerBindings : []
  if (targetValues.every((value) => value?.serviceRoleExecute === true)
    && bindings.length === 1 && expectedTriggerBinding(bindings[0])) return 'unapplied_expected'
  if (targetValues.every((value) => value?.serviceRoleExecute === false
    && value?.authenticatedExecute === false && value?.anonExecute === false)
    && bindings.length === 0) return 'applied_consistent'
  return 'drift'
}
function validateCommonState(state) {
  for (const entry of TARGETS) if (!state.targets?.[entry.key]) fail(`target missing: ${entry.key}`)
  for (const entry of ALREADY_RETIRED) {
    const value = state.alreadyRetired?.[entry.key]
    if (!value || value.serviceRoleExecute !== false) fail(`already-retired path drifted: ${entry.key}`)
  }
  if (Number(state.activeLegacyCronJobs) !== 0) fail('legacy steady cron is active')
  if (Number(state.runningGuardedSessions) !== 0) fail('guarded steady session is running')
  if (Number(state.leasedTicks) !== 0 || Number(state.liveLeasedTicks) !== 0) fail('legacy steady lease remains')
  if (Number(state.openAttempts) !== 0) fail('revision-3 open attempt remains')
}
function validateBefore(state) {
  validateCommonState(state)
  const bindings = Array.isArray(state.transferTriggerBindings) ? state.transferTriggerBindings : []
  if (bindings.length !== 1 || !expectedTriggerBinding(bindings[0])) fail('exact revision-3 transfer trigger binding is not the sole binding')
  if (classification(state) !== 'unapplied_expected') fail('steady revision-3 retirement pre-state drifted')
}
function validateAfter(state) {
  validateCommonState(state)
  if ((state.transferTriggerBindings ?? []).length !== 0) fail('revision-3 transfer trigger remains bound after retirement')
  if (classification(state) !== 'applied_consistent') fail('steady revision-3 retirement post-state drifted')
}
function structural(state) {
  return {
    maxMigrationVersion: state.maxMigrationVersion,
    targets: state.targets,
    alreadyRetired: state.alreadyRetired,
    legacyCronJobs: Number(state.legacyCronJobs),
    activeLegacyCronJobs: Number(state.activeLegacyCronJobs),
    guardedSessions: Number(state.guardedSessions),
    runningGuardedSessions: Number(state.runningGuardedSessions),
    noncompletedGuardedSessions: Number(state.noncompletedGuardedSessions),
    leasedTicks: Number(state.leasedTicks),
    liveLeasedTicks: Number(state.liveLeasedTicks),
    openAttempts: Number(state.openAttempts),
    transferTriggerBindings: state.transferTriggerBindings ?? [],
    counts: state.counts,
    scheduler: state.scheduler,
  }
}
async function inspect() { return stateRow(await query(inspectionSql(), true)) }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b) }

async function prepare(sourceCommit, options) {
  const planned = await plan(sourceCommit)
  const state = await inspect()
  validateBefore(state)
  const structure = structural(state)
  const evidence = {
    schemaVersion: 2,
    purpose: 'r5-steady-rev3-execution-retirement-prepare',
    sourceCommit,
    projectIdentityDigest: sha(env('SUPABASE_PROJECT_ID')),
    plan: { file: planned.file, exactTriggerDrop: EXPECTED_TRIGGER },
    planDigestSha256: planned.planDigestSha256,
    structuralStateSha256: sha(JSON.stringify(structure)),
    classification: classification(state),
    databaseBytes: Number(state.databaseBytes),
    maxMigrationVersion: state.maxMigrationVersion,
    targets: state.targets,
    alreadyRetired: state.alreadyRetired,
    legacyCronJobs: Number(state.legacyCronJobs),
    activeLegacyCronJobs: Number(state.activeLegacyCronJobs),
    guardedSessions: Number(state.guardedSessions),
    runningGuardedSessions: Number(state.runningGuardedSessions),
    noncompletedGuardedSessions: Number(state.noncompletedGuardedSessions),
    leasedTicks: Number(state.leasedTicks),
    liveLeasedTicks: Number(state.liveLeasedTicks),
    openAttempts: Number(state.openAttempts),
    transferTriggerBindingCount: state.transferTriggerBindings.length,
    transferTriggerBindings: state.transferTriggerBindings,
    protectedCounts: state.counts,
    schedulerSha256: sha(JSON.stringify(state.scheduler)),
    productionDatabaseReadOnly: true,
    permissionMutationAuthorized: false,
    exactTriggerDropAuthorized: false,
    schemaMutationAuthorized: false,
    rowMutationAuthorized: false,
    restoreSchemaMutationAuthorized: false,
    physicalCompactionAuthorized: false,
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
  if (!/^[a-f0-9]{64}$/u.test(authorizedPlan ?? '') || !/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid authorization digest')
  const before = await prepare(sourceCommit, {})
  if (before.planDigestSha256 !== authorizedPlan || before.structuralStateSha256 !== authorizedState) fail('authorized retirement state or plan drifted')
  const planned = await plan(sourceCommit)
  await query(`begin; set local lock_timeout='5s'; set local statement_timeout='30s'; ${planned.sql}\ncommit;`, false)
  const after = await inspect()
  validateAfter(after)
  if (!same(before.protectedCounts, after.counts)
    || before.maxMigrationVersion !== after.maxMigrationVersion
    || before.schedulerSha256 !== sha(JSON.stringify(after.scheduler))) fail('retirement changed protected state')
  const evidence = {
    schemaVersion: 2,
    purpose: 'r5-steady-rev3-execution-retirement-apply',
    sourceCommit,
    planDigestSha256: authorizedPlan,
    authorizedStructuralStateSha256: authorizedState,
    classificationAfter: 'applied_consistent',
    targetsAfter: after.targets,
    alreadyRetiredAfter: after.alreadyRetired,
    transferTriggerBindingsBefore: before.transferTriggerBindings,
    transferTriggerBindingsAfter: after.transferTriggerBindings,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: Number(after.databaseBytes),
    protectedCountsBefore: before.protectedCounts,
    protectedCountsAfter: after.counts,
    permissionMutationPerformed: true,
    exactTriggerDropPerformed: true,
    schemaMutationPerformed: true,
    rowMutationPerformed: false,
    restoreSchemaMutationPerformed: false,
    physicalCompactionPerformed: false,
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
