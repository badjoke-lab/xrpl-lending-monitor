#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const TABLES = [
  'public.xrpl_phase_payload_chunks',
  'public.xrpl_phase_commit_chunks',
]
const TARGET_BYTES = 400_000_000

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
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
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
  return readOnly ? rowsFromResponse(body) : body
}
function firstJson(rows, key) {
  const raw = rows?.[0]?.[key] ?? rows?.[0]?.[key.toUpperCase()]
  if (raw == null) fail(`${key} row missing`)
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
async function writeJson(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, `${JSON.stringify(value, null, 2)}\n`)
}
function validateSource(options) {
  const sourceCommit = options['source-commit']
  if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
  return sourceCommit
}

const rowDigest = (alias) => `coalesce(md5(string_agg(md5(to_jsonb(${alias})::text),'' order by md5(to_jsonb(${alias})::text))),md5(''))`

function inspectionSql() {
  return String.raw`select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'payloadRows',(select count(*)::bigint from public.xrpl_phase_payload_chunks),
    'commitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks),
    'payloadDigest',(select ${rowDigest('p')} from public.xrpl_phase_payload_chunks p),
    'commitDigest',(select ${rowDigest('c')} from public.xrpl_phase_commit_chunks c),
    'payloadRelationBytes',pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint,
    'commitRelationBytes',pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint,
    'payloadHeapBytes',pg_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint,
    'commitHeapBytes',pg_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint,
    'payloadColumns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default,'identity',is_identity,'generated',is_generated) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_payload_chunks'),
    'commitColumns',(select jsonb_agg(jsonb_build_object('name',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default,'identity',is_identity,'generated',is_generated) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_commit_chunks'),
    'payloadConstraints',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_payload_chunks'::regclass),'[]'::jsonb),
    'commitConstraints',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_commit_chunks'::regclass),'[]'::jsonb),
    'payloadIndexes',coalesce((select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename='xrpl_phase_payload_chunks'),'[]'::jsonb),
    'commitIndexes',coalesce((select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public' and tablename='xrpl_phase_commit_chunks'),'[]'::jsonb),
    'payloadUserTriggers',coalesce((select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.xrpl_phase_payload_chunks'::regclass and not tgisinternal),'[]'::jsonb),
    'commitUserTriggers',coalesce((select jsonb_agg(pg_get_triggerdef(oid) order by tgname) from pg_trigger where tgrelid='public.xrpl_phase_commit_chunks'::regclass and not tgisinternal),'[]'::jsonb),
    'inboundForeignKeys',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'source',conrelid::regclass::text,'target',confrelid::regclass::text,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where contype='f' and confrelid in ('public.xrpl_phase_payload_chunks'::regclass,'public.xrpl_phase_commit_chunks'::regclass)),'[]'::jsonb),
    'crossTargetForeignKeys',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'source',conrelid::regclass::text,'target',confrelid::regclass::text,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where contype='f' and conrelid in ('public.xrpl_phase_payload_chunks'::regclass,'public.xrpl_phase_commit_chunks'::regclass) and confrelid in ('public.xrpl_phase_payload_chunks'::regclass,'public.xrpl_phase_commit_chunks'::regclass)),'[]'::jsonb),
    'payloadPersistence',(select relpersistence from pg_class where oid='public.xrpl_phase_payload_chunks'::regclass),
    'commitPersistence',(select relpersistence from pg_class where oid='public.xrpl_phase_commit_chunks'::regclass),
    'payloadReplicaIdentity',(select relreplident from pg_class where oid='public.xrpl_phase_payload_chunks'::regclass),
    'commitReplicaIdentity',(select relreplident from pg_class where oid='public.xrpl_phase_commit_chunks'::regclass)
  ) as state;`
}

function structuralState(state, sourceCommit) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  return {
    schemaVersion: 1,
    purpose: 'r5-raw-evidence-physical-compaction-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    tables: TABLES,
    payloadColumns: state.payloadColumns,
    commitColumns: state.commitColumns,
    payloadConstraints: state.payloadConstraints,
    commitConstraints: state.commitConstraints,
    payloadIndexes: state.payloadIndexes,
    commitIndexes: state.commitIndexes,
    payloadUserTriggers: state.payloadUserTriggers,
    commitUserTriggers: state.commitUserTriggers,
    inboundForeignKeys: state.inboundForeignKeys,
    crossTargetForeignKeys: state.crossTargetForeignKeys,
    payloadPersistence: state.payloadPersistence,
    commitPersistence: state.commitPersistence,
    payloadReplicaIdentity: state.payloadReplicaIdentity,
    commitReplicaIdentity: state.commitReplicaIdentity,
  }
}

const MUTATION_SQL = String.raw`begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';
lock table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks in access exclusive mode;
create temporary table r5_payload_chunks_copy on commit drop as table public.xrpl_phase_payload_chunks;
create temporary table r5_commit_chunks_copy on commit drop as table public.xrpl_phase_commit_chunks;
create temporary table r5_raw_compaction_expected on commit drop as
select
  (select count(*)::bigint from r5_payload_chunks_copy) as payload_rows,
  (select ${rowDigest('p')} from r5_payload_chunks_copy p) as payload_digest,
  (select count(*)::bigint from r5_commit_chunks_copy) as commit_rows,
  (select ${rowDigest('c')} from r5_commit_chunks_copy c) as commit_digest;
truncate table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks;
insert into public.xrpl_phase_payload_chunks select * from r5_payload_chunks_copy;
insert into public.xrpl_phase_commit_chunks select * from r5_commit_chunks_copy;
do $r5$
declare
  expected record;
  actual_payload_rows bigint;
  actual_commit_rows bigint;
  actual_payload_digest text;
  actual_commit_digest text;
begin
  select * into strict expected from r5_raw_compaction_expected;
  select count(*)::bigint, ${rowDigest('p')} into actual_payload_rows,actual_payload_digest from public.xrpl_phase_payload_chunks p;
  select count(*)::bigint, ${rowDigest('c')} into actual_commit_rows,actual_commit_digest from public.xrpl_phase_commit_chunks c;
  if actual_payload_rows<>expected.payload_rows or actual_payload_digest<>expected.payload_digest then raise exception 'payload row preservation mismatch'; end if;
  if actual_commit_rows<>expected.commit_rows or actual_commit_digest<>expected.commit_digest then raise exception 'commit row preservation mismatch'; end if;
end
$r5$;
commit;`

for (const required of [
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '45s'",
  'lock table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks in access exclusive mode',
  'truncate table public.xrpl_phase_payload_chunks, public.xrpl_phase_commit_chunks',
  'insert into public.xrpl_phase_payload_chunks select * from r5_payload_chunks_copy',
  'insert into public.xrpl_phase_commit_chunks select * from r5_commit_chunks_copy',
  'payload row preservation mismatch',
  'commit row preservation mismatch',
]) if (!MUTATION_SQL.includes(required)) fail(`raw compaction mutation missing contract: ${required}`)
if ((MUTATION_SQL.match(/\btruncate\s+table\b/giu) ?? []).length !== 1) fail('raw compaction must contain exactly one TRUNCATE statement')
for (const forbidden of [
  /\bdelete\s+from\b/iu,
  /\bupdate\s+public\b/iu,
  /\b(drop|alter|vacuum|reindex|cluster)\b/iu,
  /\bcascade\b/iu,
  /\bcron\./iu,
  /\bmainnet\b/iu,
  /\bxrpl_phase_work\b/iu,
  /\bxrpl_phase_watermarks\b/iu,
  /\bxrpl_phase_messages\b/iu,
]) if (forbidden.test(MUTATION_SQL)) fail(`raw compaction mutation contains forbidden capability: ${forbidden}`)

function validateState(state) {
  for (const [name, columns] of [['payload', state.payloadColumns], ['commit', state.commitColumns]]) {
    if (!Array.isArray(columns) || columns.length === 0) fail(`${name} column definition missing`)
    if (columns.some((column) => column.identity === 'YES' || (column.generated && column.generated !== 'NEVER'))) fail(`${name} identity/generated columns are not authorized`)
  }
  if ((state.payloadUserTriggers ?? []).length !== 0 || (state.commitUserTriggers ?? []).length !== 0) fail('non-internal triggers are not authorized')
  if ((state.inboundForeignKeys ?? []).length !== 0) fail('inbound foreign keys are not authorized')
  if ((state.crossTargetForeignKeys ?? []).length !== 0) fail('cross-target foreign keys are not authorized')
  if (state.payloadPersistence !== 'p' || state.commitPersistence !== 'p') fail('target tables must be permanent relations')
}

async function inspect(sourceCommit) {
  const rows = await managementQuery(inspectionSql(), true)
  const state = firstJson(rows, 'state')
  validateState(state)
  const structural = structuralState(state, sourceCommit)
  return {
    ...state,
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    mutation: {
      sha256: sha256(MUTATION_SQL),
      targetTables: TABLES,
      rowPreserving: true,
      lockTimeoutSeconds: 5,
      statementTimeoutSeconds: 45,
    },
    mutationAuthorized: false,
    schedulerMutationAuthorized: false,
    vacuumAuthorized: false,
    retentionPolicyMutationAuthorized: false,
  }
}

async function prepare(options) {
  const sourceCommit = validateSource(options)
  const result = await inspect(sourceCommit)
  await writeJson(options.output, result)
  console.log(JSON.stringify(result))
}

async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  const authorizedMutation = options['authorized-mutation']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedMutation ?? '')) fail('invalid --authorized-mutation')

  const before = await inspect(sourceCommit)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state mismatch')
  if (before.mutation.sha256 !== authorizedMutation) fail('authorized mutation mismatch')

  await managementQuery(MUTATION_SQL, false)

  const after = await inspect(sourceCommit)
  if (after.structuralStateSha256 !== authorizedState) fail('post-compaction structural state mismatch')
  if (after.payloadRows !== before.payloadRows || after.payloadDigest !== before.payloadDigest) fail('post-compaction payload preservation mismatch')
  if (after.commitRows !== before.commitRows || after.commitDigest !== before.commitDigest) fail('post-compaction commit preservation mismatch')

  const result = {
    sourceCommit,
    structuralStateSha256: authorizedState,
    mutationSha256: authorizedMutation,
    payloadRowsBefore: before.payloadRows,
    payloadRowsAfter: after.payloadRows,
    commitRowsBefore: before.commitRows,
    commitRowsAfter: after.commitRows,
    payloadDigestBefore: before.payloadDigest,
    payloadDigestAfter: after.payloadDigest,
    commitDigestBefore: before.commitDigest,
    commitDigestAfter: after.commitDigest,
    databaseBytesBefore: before.databaseBytes,
    databaseBytesAfter: after.databaseBytes,
    databaseBytesReclaimed: Number(before.databaseBytes) - Number(after.databaseBytes),
    payloadRelationBytesBefore: before.payloadRelationBytes,
    payloadRelationBytesAfter: after.payloadRelationBytes,
    payloadRelationBytesReclaimed: Number(before.payloadRelationBytes) - Number(after.payloadRelationBytes),
    commitRelationBytesBefore: before.commitRelationBytes,
    commitRelationBytesAfter: after.commitRelationBytes,
    commitRelationBytesReclaimed: Number(before.commitRelationBytes) - Number(after.commitRelationBytes),
    targetBytes: TARGET_BYTES,
    databaseBelowTarget: Number(after.databaseBytes) < TARGET_BYTES,
    headroomBytes: TARGET_BYTES - Number(after.databaseBytes),
    rowPreservationVerified: true,
    schedulerMutationAuthorized: false,
    vacuumAuthorized: false,
    retentionPolicyMutationAuthorized: false,
  }
  await writeJson(options.output, result)
  console.log(JSON.stringify(result))
}

const { command, options } = parseArgs(process.argv.slice(2))
try {
  if (command === 'prepare') await prepare(options)
  else if (command === 'apply') await apply(options)
  else fail('usage: manage-r5-raw-evidence-compaction.mjs <prepare|apply> --source-commit <sha> [options]')
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
}
