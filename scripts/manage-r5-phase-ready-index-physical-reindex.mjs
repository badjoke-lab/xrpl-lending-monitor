#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const ACTIVE_RUN_ID = 'r5-recovery-selected-revision4-minute2-entry'
const INDEX = 'public.xrpl_phase_messages_ready_idx'
const TABLE = 'public.xrpl_phase_messages'
const EXPECTED_MIGRATION_HEAD = '20260816050000'
const EXPECTED_SCHEDULER_COMMAND_SHA = '98713e805eb43c0b527b04cb1e6bdb2b512408ceb04fb624a93602ac5aa38636'
const MAX_DATABASE_BYTES_BEFORE = 480_000_000
const MAX_INDEX_BYTES_BEFORE = 8_000_000
const MAX_READY_ROWS = 100
const EXPECTED_INDEX_DEFINITION = "CREATE INDEX xrpl_phase_messages_ready_idx ON public.xrpl_phase_messages USING btree (profile_id, status, available_at, created_at, message_id) WHERE (status = ANY (ARRAY['pending'::text, 'retry'::text, 'leased'::text]))"

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
  'indexOid','${INDEX}'::regclass::oid,
  'indexBytes',pg_relation_size('${INDEX}'::regclass)::bigint,
  'indexDefinition',pg_get_indexdef('${INDEX}'::regclass),
  'indexDefinitionSha256',encode(extensions.digest(convert_to(pg_get_indexdef('${INDEX}'::regclass),'UTF8'),'sha256'),'hex'),
  'indexValid',(select indisvalid from pg_index where indexrelid='${INDEX}'::regclass),
  'indexReady',(select indisready from pg_index where indexrelid='${INDEX}'::regclass),
  'indexUnique',(select indisunique from pg_index where indexrelid='${INDEX}'::regclass),
  'indexPrimary',(select indisprimary from pg_index where indexrelid='${INDEX}'::regclass),
  'indexScans',coalesce((select idx_scan::bigint from pg_stat_user_indexes where indexrelid='${INDEX}'::regclass),0),
  'activeRun',(select jsonb_build_object('runId',run_id,'status',status,'lastError',last_error,'network',network,'profileRevision',profile_revision,'watermarkLedgerIndex',current_watermark_ledger_index) from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}'),
  'scheduler',coalesce((select jsonb_agg(to_jsonb(x) order by x.jobid) from scheduler x),'[]'::jsonb)
)::text as state;`

function validateCommon(state) {
  if (state.maxMigrationVersion !== EXPECTED_MIGRATION_HEAD) fail(`migration head drifted: ${state.maxMigrationVersion}`)
  if (state.indexDefinition !== EXPECTED_INDEX_DEFINITION) fail('ready index definition drifted')
  if (state.indexValid !== true || state.indexReady !== true || state.indexUnique !== false || state.indexPrimary !== false) fail('ready index validity/identity drifted')
  if (!state.activeRun || state.activeRun.runId !== ACTIVE_RUN_ID || state.activeRun.status !== 'halted' || state.activeRun.lastError !== 'r5_recovery_database_halt' || state.activeRun.network !== 'devnet' || Number(state.activeRun.profileRevision) !== 4) fail('R5 database-halt boundary drifted')
  if (!Array.isArray(state.scheduler) || state.scheduler.length !== 1 || state.scheduler[0].active !== true || state.scheduler[0].schedule !== '* * * * *' || state.scheduler[0].command_sha256 !== EXPECTED_SCHEDULER_COMMAND_SHA) fail('scheduler boundary drifted')
}
function validateBefore(state) {
  validateCommon(state)
  if (Number(state.databaseBytes) > MAX_DATABASE_BYTES_BEFORE) fail('database above ready-index reindex ceiling')
  if (Number(state.indexBytes) <= 0 || Number(state.indexBytes) > MAX_INDEX_BYTES_BEFORE) fail('ready index bytes outside authorized ceiling')
  if (Number(state.readyRows) < 0 || Number(state.readyRows) > MAX_READY_ROWS) fail('ready row count outside authorized ceiling')
  if (Number(state.tableRows) <= 0) fail('phase message table unexpectedly empty')
}
function validateAfter(state) {
  validateCommon(state)
  if (Number(state.readyRows) > MAX_READY_ROWS) fail('ready row count outside post-reindex ceiling')
}
function structuralState(state, sourceCommit) {
  return {
    schemaVersion: 1,
    purpose: 'r5-phase-ready-index-physical-reindex-structural-state',
    sourceCommit,
    projectIdentityDigest: sha256(env('SUPABASE_PROJECT_ID')),
    maxMigrationVersion: state.maxMigrationVersion,
    tableOid: Number(state.tableOid),
    indexOid: Number(state.indexOid),
    indexDefinition: state.indexDefinition,
    indexDefinitionSha256: state.indexDefinitionSha256,
    indexValid: state.indexValid,
    indexReady: state.indexReady,
    indexUnique: state.indexUnique,
    indexPrimary: state.indexPrimary,
    activeRun: state.activeRun,
    scheduler: state.scheduler,
  }
}
function dataState(state) {
  return {
    schemaVersion: 1,
    purpose: 'r5-phase-ready-index-physical-reindex-data-state',
    databaseBytes: Number(state.databaseBytes),
    tableHeapBytes: Number(state.tableHeapBytes),
    tableRows: Number(state.tableRows),
    readyRows: Number(state.readyRows),
    statusCounts: state.statusCounts,
    indexBytes: Number(state.indexBytes),
  }
}
function mutationSql(expected) {
  for (const key of ['tableRows', 'readyRows', 'tableHeapBytes', 'indexBytes']) {
    if (!Number.isSafeInteger(Number(expected[key])) || Number(expected[key]) < 0) fail(`invalid mutation ${key}`)
  }
  return String.raw`begin;
set local lock_timeout='5s';
set local statement_timeout='45s';
select pg_advisory_xact_lock(hashtextextended('xrpl-phase-ready-index-physical-reindex',0));
lock table public.xrpl_phase_messages in share mode;
do $r5$
declare current_definition text; current_table_rows bigint; current_ready_rows bigint; current_heap_bytes bigint; current_index_bytes bigint;
begin
  select pg_get_indexdef('${INDEX}'::regclass) into current_definition;
  select count(*)::bigint,count(*) filter(where status in ('pending','retry','leased'))::bigint into current_table_rows,current_ready_rows from public.xrpl_phase_messages;
  select pg_relation_size('${TABLE}'::regclass)::bigint,pg_relation_size('${INDEX}'::regclass)::bigint into current_heap_bytes,current_index_bytes;
  if current_definition<>${sqlLiteral(EXPECTED_INDEX_DEFINITION)} then raise exception 'ready index definition drift under lock'; end if;
  if current_table_rows<>${Number(expected.tableRows)} or current_ready_rows<>${Number(expected.readyRows)} or current_heap_bytes<>${Number(expected.tableHeapBytes)} or current_index_bytes<>${Number(expected.indexBytes)} then raise exception 'ready index authorized data drift under lock'; end if;
  if current_ready_rows>${MAX_READY_ROWS} or current_index_bytes>${MAX_INDEX_BYTES_BEFORE} or pg_database_size(current_database())>${MAX_DATABASE_BYTES_BEFORE} then raise exception 'ready index reindex safety ceiling exceeded under lock'; end if;
  if not exists(select 1 from xrpl_r5_v1.recovery_runs where run_id='${ACTIVE_RUN_ID}' and status='halted' and last_error='r5_recovery_database_halt' and network='devnet' and profile_revision=4) then raise exception 'R5 halt boundary drift under lock'; end if;
end $r5$;
reindex index public.xrpl_phase_messages_ready_idx;
commit;`
}

const SAMPLE = mutationSql({ tableRows: 50238, readyRows: 2, tableHeapBytes: 110092288, indexBytes: 2891776 })
for (const required of [
  "lock table public.xrpl_phase_messages in share mode",
  'ready index authorized data drift under lock',
  'ready index reindex safety ceiling exceeded under lock',
  'reindex index public.xrpl_phase_messages_ready_idx',
]) {
  if (!SAMPLE.includes(required)) fail(`ready reindex mutation missing: ${required}`)
}
for (const forbidden of [
  /\bdelete\s+from\b/iu,
  /\btruncate\b/iu,
  /\bupdate\s+public\b/iu,
  /\binsert\s+into\s+public\b/iu,
  /\bvacuum\b/iu,
  /\bcluster\b/iu,
  /\bcron\.schedule\b/iu,
  /\bcron\.unschedule\b/iu,
  /\bmainnet\b/iu,
]) {
  if (forbidden.test(SAMPLE)) fail(`ready reindex mutation contains forbidden capability: ${forbidden}`)
}

async function inspect(sourceCommit, after = false) {
  const state = firstJson(await query(INSPECTION_SQL, true))
  if (after) validateAfter(state)
  else validateBefore(state)
  const structural = structuralState(state, sourceCommit)
  const data = dataState(state)
  const structuralSha = sha256(JSON.stringify(structural))
  const dataSha = sha256(JSON.stringify(data))
  const mutation = mutationSql(data)
  const mutationSha = sha256(mutation)
  const plan = {
    schemaVersion: 1,
    purpose: 'r5-phase-ready-index-physical-reindex-plan',
    sourceCommit,
    structuralStateSha256: structuralSha,
    dataStateSha256: dataSha,
    mutationSha256: mutationSha,
    maxDatabaseBytesBefore: MAX_DATABASE_BYTES_BEFORE,
    maxIndexBytesBefore: MAX_INDEX_BYTES_BEFORE,
    maxReadyRows: MAX_READY_ROWS,
    lockMode: 'SHARE',
    lockRevalidation: true,
  }
  return {
    ...state,
    structuralState: structural,
    structuralStateSha256: structuralSha,
    dataState: data,
    dataStateSha256: dataSha,
    mutation: { sha256: mutationSha, lockTimeoutSeconds: 5, statementTimeoutSeconds: 45, lockRevalidation: true },
    plan,
    planSha256: sha256(JSON.stringify(plan)),
    rowMutationAuthorized: false,
    vacuumAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    publicReaderMutationAuthorized: false,
    mainnetDisabled: true,
    r5RearmAuthorized: false,
  }
}
async function prepare(options) {
  const sourceCommit = validateSource(options)
  const result = await inspect(sourceCommit, false)
  await writeJson(options.output, result)
  console.log(JSON.stringify(result))
}
async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedData = options['authorized-data']
  const authorizedPlan = options['authorized-plan']
  const authorizedMutation = options['authorized-mutation']
  for (const [name, value] of [
    ['authorized-state', authorizedState],
    ['authorized-data', authorizedData],
    ['authorized-plan', authorizedPlan],
    ['authorized-mutation', authorizedMutation],
  ]) {
    if (!/^[a-f0-9]{64}$/u.test(value ?? '')) fail(`invalid --${name}`)
  }
  const before = await inspect(sourceCommit, false)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state mismatch')
  if (before.dataStateSha256 !== authorizedData) fail('authorized data state mismatch')
  if (before.planSha256 !== authorizedPlan) fail('authorized plan mismatch')
  const mutation = mutationSql(before.dataState)
  if (sha256(mutation) !== authorizedMutation) fail('authorized mutation mismatch')
  await query(mutation, false)
  const after = await inspect(sourceCommit, true)
  if (after.structuralStateSha256 !== before.structuralStateSha256) fail('post-reindex structural state mismatch')
  if (Number(after.tableRows) !== Number(before.tableRows) || Number(after.readyRows) !== Number(before.readyRows) || JSON.stringify(after.statusCounts) !== JSON.stringify(before.statusCounts)) fail('post-reindex phase-message row state mismatch')
  if (Number(after.tableHeapBytes) !== Number(before.tableHeapBytes)) fail('post-reindex table heap bytes changed')
  if (Number(after.indexBytes) >= Number(before.indexBytes)) fail('ready index bytes were not reclaimed')
  if (Number(after.databaseBytes) >= Number(before.databaseBytes)) fail('database bytes were not reclaimed')
  const result = {
    schemaVersion: 1,
    purpose: 'r5-phase-ready-index-physical-reindex-apply',
    sourceCommit,
    structuralStateSha256: authorizedState,
    dataStateSha256: authorizedData,
    planSha256: authorizedPlan,
    mutationSha256: authorizedMutation,
    tableRowsBefore: Number(before.tableRows),
    tableRowsAfter: Number(after.tableRows),
    readyRowsBefore: Number(before.readyRows),
    readyRowsAfter: Number(after.readyRows),
    tableHeapBytesBefore: Number(before.tableHeapBytes),
    tableHeapBytesAfter: Number(after.tableHeapBytes),
    indexBytesBefore: Number(before.indexBytes),
    indexBytesAfter: Number(after.indexBytes),
    indexBytesReclaimed: Number(before.indexBytes) - Number(after.indexBytes),
    databaseBytesBefore: Number(before.databaseBytes),
    databaseBytesAfter: Number(after.databaseBytes),
    databaseBytesReclaimed: Number(before.databaseBytes) - Number(after.databaseBytes),
    indexOidPreserved: Number(after.indexOid) === Number(before.indexOid),
    indexDefinitionPreserved: after.indexDefinition === before.indexDefinition,
    activeRunUnchanged: JSON.stringify(after.activeRun) === JSON.stringify(before.activeRun),
    schedulerUnchanged: JSON.stringify(after.scheduler) === JSON.stringify(before.scheduler),
    rowMutationPerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    publicReaderMutationPerformed: false,
    mainnetDisabled: true,
    r5RearmPerformed: false,
  }
  await writeJson(options.output, result)
  console.log(JSON.stringify(result))
}

const { command, options } = parse(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('usage: manage-r5-phase-ready-index-physical-reindex.mjs <prepare|apply> --source-commit <sha> [...]')
