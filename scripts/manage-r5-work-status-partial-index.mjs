#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const INDEX_NAME = 'xrpl_phase_work_status_idx'
const TEMP_INDEX_NAME = 'xrpl_phase_work_status_noncommitted_idx'
const COMMITTED_READER_INDEX = 'xrpl_phase_work_committed_reader_idx'
const INTERNAL_DB_HALT = 400_000_000
const MAX_EXPECTED_PARTIAL_BYTES = 1_048_576

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = {}
  for (let i = 0; i < rest.length; i += 2) {
    const token = rest[i]
    const value = rest[i + 1]
    if (!token?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${token ?? '<end>'}`)
    options[token.slice(2)] = value
  }
  return { command, options }
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) if (Array.isArray(candidate)) return candidate
  fail('Management API response contains no rows')
}
async function managementQuery(query, readOnly) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: readOnly }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}
function firstState(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  return sourceCommit
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}

const MUTATION_SQL = String.raw`begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';
lock table public.xrpl_phase_work in share mode;
do $$
declare
  v_predicate text;
  v_definition text;
  v_valid boolean;
  v_ready boolean;
begin
  if to_regclass('public.xrpl_phase_work_status_noncommitted_idx') is not null then
    raise exception 'temporary work-status index already exists';
  end if;
  select pg_get_expr(i.indpred,i.indrelid),pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
  into v_predicate,v_definition,v_valid,v_ready
  from pg_index i where i.indexrelid='public.xrpl_phase_work_status_idx'::regclass;
  if v_predicate is not null or v_valid is not true or v_ready is not true or position('(profile_id, status, updated_at, work_id)' in v_definition)=0 then
    raise exception 'full work-status index pre-state drift';
  end if;
  select pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
  into v_definition,v_valid,v_ready
  from pg_index i where i.indexrelid='public.xrpl_phase_work_committed_reader_idx'::regclass;
  if v_valid is not true or v_ready is not true or position('(profile_id, network, epoch_id, base_identity, status, scanned_end_ledger_index, work_id)' in v_definition)=0 then
    raise exception 'committed-reader index pre-state drift';
  end if;
end $$;
create index xrpl_phase_work_status_noncommitted_idx
  on public.xrpl_phase_work(profile_id,status,updated_at,work_id)
  where status <> 'committed';
do $$
declare
  v_predicate text;
  v_definition text;
  v_valid boolean;
  v_ready boolean;
begin
  select pg_get_expr(i.indpred,i.indrelid),pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
  into v_predicate,v_definition,v_valid,v_ready
  from pg_index i where i.indexrelid='public.xrpl_phase_work_status_noncommitted_idx'::regclass;
  if v_predicate is null or position('committed' in v_predicate)=0 or v_valid is not true or v_ready is not true or position('(profile_id, status, updated_at, work_id)' in v_definition)=0 then
    raise exception 'candidate work-status partial index validation failed';
  end if;
end $$;
drop index public.xrpl_phase_work_status_idx;
alter index public.xrpl_phase_work_status_noncommitted_idx rename to xrpl_phase_work_status_idx;
do $$
declare
  v_predicate text;
  v_definition text;
  v_valid boolean;
  v_ready boolean;
begin
  if to_regclass('public.xrpl_phase_work_status_noncommitted_idx') is not null then
    raise exception 'temporary work-status index remains after rename';
  end if;
  select pg_get_expr(i.indpred,i.indrelid),pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready
  into v_predicate,v_definition,v_valid,v_ready
  from pg_index i where i.indexrelid='public.xrpl_phase_work_status_idx'::regclass;
  if v_predicate is null or position('committed' in v_predicate)=0 or v_valid is not true or v_ready is not true or position('(profile_id, status, updated_at, work_id)' in v_definition)=0 then
    raise exception 'final work-status partial index validation failed';
  end if;
end $$;
commit;`

for (const forbidden of [
  /\bdelete\s+from\b/iu,
  /\bupdate\s+[a-z_]/iu,
  /\binsert\s+into\b/iu,
  /\btruncate\b/iu,
  /\bvacuum\b/iu,
  /\bdrop\s+table\b/iu,
  /\balter\s+table\b/iu,
  /\bcreate\s+table\b/iu,
  /\bcron\./iu,
]) {
  if (forbidden.test(MUTATION_SQL)) fail(`work-status mutation SQL contains forbidden capability: ${forbidden}`)
}
for (const required of [
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '45s'",
  'lock table public.xrpl_phase_work in share mode',
  'create index xrpl_phase_work_status_noncommitted_idx',
  "where status <> 'committed'",
  'drop index public.xrpl_phase_work_status_idx',
  'rename to xrpl_phase_work_status_idx',
]) if (!MUTATION_SQL.includes(required)) fail(`work-status mutation SQL missing contract: ${required}`)

function inspectionSql() {
  return `select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database()),
    'workRows',(select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet'),
    'nonCommittedRows',(select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status<>'committed'),
    'statusCounts',(select coalesce(jsonb_object_agg(status,n order by status),'{}'::jsonb) from (select status,count(*) n from public.xrpl_phase_work where profile_id='supabase-devnet' group by status) s),
    'workStatusIndex',coalesce((select jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'bytes',pg_relation_size(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) from pg_index i where i.indexrelid=to_regclass('public.${INDEX_NAME}')),'null'::jsonb),
    'temporaryIndexExists',to_regclass('public.${TEMP_INDEX_NAME}') is not null,
    'committedReaderIndex',coalesce((select jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),'predicate',pg_get_expr(i.indpred,i.indrelid),'bytes',pg_relation_size(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready) from pg_index i where i.indexrelid=to_regclass('public.${COMMITTED_READER_INDEX}')),'null'::jsonb),
    'tableContract',jsonb_build_object(
      'columns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_work'),
      'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_work'::regclass)
    )
  ) as state;`
}
function indexShape(index) {
  if (!index || typeof index !== 'object') return 'missing'
  const definition = String(index.definition ?? '')
  const predicate = index.predicate == null ? null : String(index.predicate)
  const keys = definition.includes('(profile_id, status, updated_at, work_id)')
  if (!keys || index.valid !== true || index.ready !== true) return 'drift'
  if (predicate === null) return 'full'
  if (predicate.includes('committed') && predicate.includes('<>')) return 'partial'
  return 'drift'
}
function committedReaderValid(index) {
  return Boolean(index && index.valid === true && index.ready === true && String(index.definition ?? '').includes('(profile_id, network, epoch_id, base_identity, status, scanned_end_ledger_index, work_id)'))
}
function structuralState(state, sourceCommit) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  return {
    schemaVersion: 1,
    purpose: 'r5-work-status-partial-index-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    mutationSha256: sha256(MUTATION_SQL),
    workStatusIndexShape: indexShape(state.workStatusIndex),
    workStatusIndexDefinitionSha256: sha256(state.workStatusIndex?.definition ?? 'missing'),
    committedReaderDefinitionSha256: sha256(state.committedReaderIndex?.definition ?? 'missing'),
    tableContractSha256: sha256(JSON.stringify(state.tableContract)),
    temporaryIndexExists: state.temporaryIndexExists === true,
    workRows: Number(state.workRows),
    nonCommittedRows: Number(state.nonCommittedRows),
    statusCounts: state.statusCounts ?? {},
  }
}
async function inspect(sourceCommit) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  const structural = structuralState(state, sourceCommit)
  return {
    schemaVersion: 1,
    purpose: 'r5-work-status-partial-index-state',
    sourceCommit,
    databaseBytes: Number(state.databaseBytes),
    databaseHaltBytes: INTERNAL_DB_HALT,
    databaseHeadroomBytes: INTERNAL_DB_HALT - Number(state.databaseBytes),
    theoreticalBytesWithoutFullIndex: Number(state.databaseBytes) - Number(state.workStatusIndex?.bytes ?? 0),
    workRows: Number(state.workRows),
    nonCommittedRows: Number(state.nonCommittedRows),
    statusCounts: state.statusCounts ?? {},
    workStatusIndexBytes: Number(state.workStatusIndex?.bytes ?? 0),
    workStatusIndexShape: indexShape(state.workStatusIndex),
    workStatusIndexDefinition: state.workStatusIndex?.definition ?? null,
    workStatusIndexPredicate: state.workStatusIndex?.predicate ?? null,
    committedReaderIndexBytes: Number(state.committedReaderIndex?.bytes ?? 0),
    committedReaderValid: committedReaderValid(state.committedReaderIndex),
    temporaryIndexExists: state.temporaryIndexExists === true,
    mutationSha256: sha256(MUTATION_SQL),
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    indexMutationAuthorized: false,
    rowMutationAuthorized: false,
    vacuumAuthorized: false,
    schedulerMutationAuthorized: false,
    deploymentAuthorized: false,
    mainnetDisabled: true,
  }
}
async function planUses(query, indexName) {
  const rows = await managementQuery(`explain (format json,costs off) ${query}`, true)
  return JSON.stringify(rows).includes(indexName)
}
async function plannerEvidence() {
  return {
    stagedUsesStatusIndex: await planUses("select work_id,status,updated_at from public.xrpl_phase_work where profile_id='supabase-devnet' and status='staged' order by updated_at,work_id limit 20", INDEX_NAME),
    inflightUsesStatusIndex: await planUses("select count(*) from public.xrpl_phase_work where profile_id='supabase-devnet' and status in ('planned','staged','committing','finalizing')", INDEX_NAME),
    committedReaderUsesDedicatedIndex: await planUses("select work_id,scanned_end_ledger_index from public.xrpl_phase_work where profile_id='supabase-devnet' and network='devnet' and epoch_id=(select epoch_id from public.xrpl_phase_streams where profile_id='supabase-devnet') and base_identity=(select base_identity from public.xrpl_phase_streams where profile_id='supabase-devnet') and status='committed' order by scanned_end_ledger_index desc,work_id desc limit 20", COMMITTED_READER_INDEX),
    workIdUsesPrimaryKey: await planUses("select * from public.xrpl_phase_work where work_id=(select work_id from public.xrpl_phase_work where profile_id='supabase-devnet' limit 1)", 'xrpl_phase_work_pkey'),
  }
}
async function prepare(options) {
  const sourceCommit = validateSource(options)
  const state = await inspect(sourceCommit)
  if (state.workStatusIndexShape !== 'full') fail(`work-status index pre-state is ${state.workStatusIndexShape}, expected full`)
  if (!state.committedReaderValid) fail('committed-reader index contract drifted')
  if (state.temporaryIndexExists) fail('temporary work-status index already exists')
  if (state.workStatusIndexBytes <= MAX_EXPECTED_PARTIAL_BYTES) fail('full work-status index is already too small for this replacement gate')
  const plans = await plannerEvidence()
  if (!plans.stagedUsesStatusIndex || !plans.inflightUsesStatusIndex || !plans.committedReaderUsesDedicatedIndex || !plans.workIdUsesPrimaryKey) fail('production pre-state planner contract mismatch')
  const evidence = { ...state, plannerEvidence: plans }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}
async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedMutation = options['authorized-mutation']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedMutation ?? '')) fail('invalid --authorized-mutation')
  if (authorizedMutation !== sha256(MUTATION_SQL)) fail('authorized mutation SHA does not match exact manager DDL')
  const before = await inspect(sourceCommit)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized work-status structural state drifted before mutation')
  if (before.workStatusIndexShape !== 'full' || before.temporaryIndexExists || !before.committedReaderValid) fail('work-status apply pre-state is not eligible')

  await managementQuery(MUTATION_SQL, false)

  const after = await inspect(sourceCommit)
  if (after.workStatusIndexShape !== 'partial') fail('work-status partial index post-state mismatch')
  if (after.temporaryIndexExists) fail('temporary work-status index remains after apply')
  if (!after.committedReaderValid) fail('committed-reader index drifted after apply')
  if (!(after.workStatusIndexBytes < before.workStatusIndexBytes)) fail('work-status index did not shrink')
  if (after.workStatusIndexBytes > MAX_EXPECTED_PARTIAL_BYTES) fail(`partial work-status index exceeds ${MAX_EXPECTED_PARTIAL_BYTES} bytes`)
  const plans = await plannerEvidence()
  if (!plans.stagedUsesStatusIndex || !plans.inflightUsesStatusIndex || !plans.committedReaderUsesDedicatedIndex || !plans.workIdUsesPrimaryKey) fail('production post-state planner contract mismatch')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-work-status-partial-index-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    mutationSha256: authorizedMutation,
    workRowsBefore: before.workRows,
    workRowsAfter: after.workRows,
    statusCountsBefore: before.statusCounts,
    statusCountsAfter: after.statusCounts,
    nonCommittedRowsBefore: before.nonCommittedRows,
    nonCommittedRowsAfter: after.nonCommittedRows,
    indexBytesBefore: before.workStatusIndexBytes,
    indexBytesAfter: after.workStatusIndexBytes,
    indexBytesReclaimed: before.workStatusIndexBytes - after.workStatusIndexBytes,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseBytesDelta: after.databaseBytes - before.databaseBytes,
    databaseBelowHaltAfter: after.databaseBytes < INTERNAL_DB_HALT,
    databaseHeadroomBytesAfter: INTERNAL_DB_HALT - after.databaseBytes,
    plannerEvidence: plans,
    rowMutationPerformed: false,
    vacuumPerformed: false,
    schedulerMutationPerformed: false,
    deploymentPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RestartAuthorized: false,
  }
  await writeJson(options.output, evidence)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
}

const { command, options } = parseArgs(process.argv.slice(2))
if (command === 'prepare') await prepare(options)
else if (command === 'apply') await apply(options)
else fail('command must be prepare or apply')
