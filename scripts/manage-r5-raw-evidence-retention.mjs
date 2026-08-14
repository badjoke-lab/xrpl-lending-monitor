#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const PROFILE_ID = 'supabase-devnet'
const JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'
const JOB_SCHEDULE = '47 */6 * * *'
const RETENTION_HOURS = 24

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
  return rowsFromResponse(body)
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

const CLEANUP_SQL = String.raw`with active_watermark as (
  select * from public.xrpl_phase_watermarks where profile_id='${PROFILE_ID}'
),
current_work as (
  select w.*
  from public.xrpl_phase_work w
  join active_watermark wm on wm.work_id=w.work_id
  where w.profile_id='${PROFILE_ID}'
    and w.status='committed'
    and w.committed_at is not null
    and w.scanned_end_ledger_index=wm.ledger_index
    and w.final_ledger_hash=wm.ledger_hash
),
predecessor_work as (
  select p.*
  from current_work c
  join public.xrpl_phase_work p
    on p.profile_id=c.profile_id
   and p.status='committed'
   and p.committed_at is not null
   and p.scanned_end_ledger_index=c.previous_ledger_index
   and p.final_ledger_hash=c.expected_parent_hash
  order by p.committed_at desc,p.work_id desc
  limit 1
),
protected_integrity as materialized (
  select 1 / case when
    (select count(*) from current_work)=1
    and (select count(*) from predecessor_work)=1
    and not exists (
      select 1 from current_work w
      where (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)<>w.expected_payload_chunks
         or (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)<>w.expected_commit_chunks
         or (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')<>w.expected_commit_chunks
    )
    and not exists (
      select 1 from predecessor_work w
      where (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)<>w.expected_payload_chunks
         or (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)<>w.expected_commit_chunks
         or (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')<>w.expected_commit_chunks
    )
    then 1 else 0 end as ok
),
protected_work as (
  select work_id from current_work union select work_id from predecessor_work
),
candidate_work_ids as materialized (
  select w.work_id
  from public.xrpl_phase_work w
  where (select ok from protected_integrity)=1
    and w.profile_id='${PROFILE_ID}'
    and w.status='committed'
    and w.committed_at is not null
    and w.committed_at < now() - interval '${RETENTION_HOURS} hours'
    and not exists(select 1 from protected_work p where p.work_id=w.work_id)
    and (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)=w.expected_payload_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)=w.expected_commit_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')=w.expected_commit_chunks
),
deleted_payload as (
  delete from public.xrpl_phase_payload_chunks p using candidate_work_ids x
  where p.work_id=x.work_id returning p.work_id
),
deleted_commit as (
  delete from public.xrpl_phase_commit_chunks c using candidate_work_ids x
  where c.work_id=x.work_id returning c.work_id
)
select jsonb_build_object(
  'payloadDeleted',(select count(*)::bigint from deleted_payload),
  'commitDeleted',(select count(*)::bigint from deleted_commit),
  'candidateWorkCount',(select count(*)::bigint from candidate_work_ids),
  'candidateWorkDigest',coalesce((select md5(string_agg(work_id,E'\\n' order by work_id)) from candidate_work_ids),md5(''))
) as result;`

const escapedCommand = CLEANUP_SQL.replaceAll("'", "''")
const escapedSchedule = JOB_SCHEDULE.replaceAll("'", "''")
const escapedName = JOB_NAME.replaceAll("'", "''")
const MUTATION_SQL = String.raw`begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';
${CLEANUP_SQL}
select cron.schedule('${escapedName}','${escapedSchedule}','${escapedCommand}');
commit;`

for (const required of [
  "delete from public.xrpl_phase_payload_chunks",
  "delete from public.xrpl_phase_commit_chunks",
  "protected_integrity as materialized",
  "w.committed_at < now() - interval '24 hours'",
  "c.status='completed'",
  "set local lock_timeout = '5s'",
  "set local statement_timeout = '45s'",
  `select cron.schedule('${escapedName}','${escapedSchedule}','${escapedCommand}')`,
]) if (!MUTATION_SQL.includes(required)) fail(`raw retention mutation missing contract: ${required}`)
if ((MUTATION_SQL.match(/\bdelete\s+from\b/giu) ?? []).length !== 2) fail('raw retention mutation must contain exactly two DELETE targets')
for (const forbidden of [
  /\bdelete\s+from\s+public\.(?!xrpl_phase_payload_chunks\b|xrpl_phase_commit_chunks\b)/iu,
  /\b(update|insert|truncate|alter|drop|vacuum)\b/iu,
  /\bmainnet\b/iu,
]) if (forbidden.test(MUTATION_SQL)) fail(`raw retention mutation contains forbidden capability: ${forbidden}`)

function inspectionSql() {
  return String.raw`with active_watermark as (
    select * from public.xrpl_phase_watermarks where profile_id='${PROFILE_ID}'
  ), current_work as (
    select w.* from public.xrpl_phase_work w join active_watermark wm on wm.work_id=w.work_id
    where w.profile_id='${PROFILE_ID}' and w.status='committed' and w.committed_at is not null
      and w.scanned_end_ledger_index=wm.ledger_index and w.final_ledger_hash=wm.ledger_hash
  ), predecessor_work as (
    select p.* from current_work c join public.xrpl_phase_work p
      on p.profile_id=c.profile_id and p.status='committed' and p.committed_at is not null
     and p.scanned_end_ledger_index=c.previous_ledger_index and p.final_ledger_hash=c.expected_parent_hash
    order by p.committed_at desc,p.work_id desc limit 1
  ), protected_work as (
    select work_id from current_work union select work_id from predecessor_work
  ), old_committed as (
    select w.* from public.xrpl_phase_work w
    where w.profile_id='${PROFILE_ID}' and w.status='committed' and w.committed_at is not null
      and w.committed_at < now()-interval '${RETENTION_HOURS} hours'
      and not exists(select 1 from protected_work p where p.work_id=w.work_id)
  ), complete_candidates as (
    select w.* from old_committed w
    where (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)=w.expected_payload_chunks
      and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)=w.expected_commit_chunks
      and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')=w.expected_commit_chunks
  )
  select jsonb_build_object(
    'databaseBytes',pg_database_size(current_database())::bigint,
    'currentWorkId',(select work_id from current_work),
    'predecessorWorkId',(select work_id from predecessor_work),
    'currentWorkCount',(select count(*)::bigint from current_work),
    'predecessorWorkCount',(select count(*)::bigint from predecessor_work),
    'currentExpectedPayload',(select expected_payload_chunks from current_work),
    'currentPayloadRows',(select count(*)::bigint from public.xrpl_phase_payload_chunks p join current_work w on w.work_id=p.work_id),
    'currentExpectedCommit',(select expected_commit_chunks from current_work),
    'currentCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join current_work w on w.work_id=c.work_id),
    'currentCompletedCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join current_work w on w.work_id=c.work_id where c.status='completed'),
    'predecessorExpectedPayload',(select expected_payload_chunks from predecessor_work),
    'predecessorPayloadRows',(select count(*)::bigint from public.xrpl_phase_payload_chunks p join predecessor_work w on w.work_id=p.work_id),
    'predecessorExpectedCommit',(select expected_commit_chunks from predecessor_work),
    'predecessorCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join predecessor_work w on w.work_id=c.work_id),
    'predecessorCompletedCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join predecessor_work w on w.work_id=c.work_id where c.status='completed'),
    'oldCommittedWorkCount',(select count(*)::bigint from old_committed),
    'completeCandidateWorkCount',(select count(*)::bigint from complete_candidates),
    'incompleteOldWorkCount',(select count(*)::bigint from old_committed)-(select count(*)::bigint from complete_candidates),
    'candidatePayloadRows',(select count(*)::bigint from public.xrpl_phase_payload_chunks p join complete_candidates w on w.work_id=p.work_id),
    'candidatePayloadLogicalBytes',(select coalesce(sum(pg_column_size(p)),0)::bigint from public.xrpl_phase_payload_chunks p join complete_candidates w on w.work_id=p.work_id),
    'candidateCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join complete_candidates w on w.work_id=c.work_id),
    'candidateCommitLogicalBytes',(select coalesce(sum(pg_column_size(c)),0)::bigint from public.xrpl_phase_commit_chunks c join complete_candidates w on w.work_id=c.work_id),
    'payloadRelationBytes',pg_total_relation_size('public.xrpl_phase_payload_chunks'::regclass)::bigint,
    'commitRelationBytes',pg_total_relation_size('public.xrpl_phase_commit_chunks'::regclass)::bigint,
    'payloadDefinition',(select jsonb_agg(jsonb_build_object('column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_payload_chunks'),
    'commitDefinition',(select jsonb_agg(jsonb_build_object('column',column_name,'type',data_type,'udt',udt_name,'nullable',is_nullable,'default',column_default) order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='xrpl_phase_commit_chunks'),
    'payloadConstraints',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_payload_chunks'::regclass),'[]'::jsonb),
    'commitConstraints',coalesce((select jsonb_agg(jsonb_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid='public.xrpl_phase_commit_chunks'::regclass),'[]'::jsonb),
    'payloadUserTriggers',coalesce((select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) order by tgname) from pg_trigger where tgrelid='public.xrpl_phase_payload_chunks'::regclass and not tgisinternal),'[]'::jsonb),
    'commitUserTriggers',coalesce((select jsonb_agg(jsonb_build_object('name',tgname,'definition',pg_get_triggerdef(oid)) order by tgname) from pg_trigger where tgrelid='public.xrpl_phase_commit_chunks'::regclass and not tgisinternal),'[]'::jsonb),
    'pgCronExtension',coalesce((select jsonb_build_object('name',e.extname,'schema',n.nspname,'version',e.extversion) from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_cron'),'null'::jsonb),
    'jobRows',(select count(*)::bigint from cron.job where jobname='${JOB_NAME}'),
    'jobRecord',coalesce((select jsonb_build_object('schedule',schedule,'command',command,'active',active,'database',database,'username',username) from cron.job where jobname='${JOB_NAME}' limit 1),'null'::jsonb)
  ) as state;`
}
function structuralState(state, sourceCommit) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  return {
    schemaVersion: 1,
    purpose: 'r5-raw-evidence-retention-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    profileId: PROFILE_ID,
    retentionHours: RETENTION_HOURS,
    jobName: JOB_NAME,
    jobSchedule: JOB_SCHEDULE,
    jobCommandSha256: sha256(CLEANUP_SQL),
    mutationSha256: sha256(MUTATION_SQL),
    jobRows: Number(state.jobRows),
    payloadDefinitionSha256: sha256(JSON.stringify(state.payloadDefinition ?? null)),
    commitDefinitionSha256: sha256(JSON.stringify(state.commitDefinition ?? null)),
    payloadConstraintsSha256: sha256(JSON.stringify(state.payloadConstraints ?? [])),
    commitConstraintsSha256: sha256(JSON.stringify(state.commitConstraints ?? [])),
    payloadUserTriggersSha256: sha256(JSON.stringify(state.payloadUserTriggers ?? [])),
    commitUserTriggersSha256: sha256(JSON.stringify(state.commitUserTriggers ?? [])),
    pgCronExtensionSha256: sha256(JSON.stringify(state.pgCronExtension ?? null)),
  }
}
function assertProtectedIntegrity(state) {
  if (Number(state.currentWorkCount) !== 1) fail(`current work count drifted: ${state.currentWorkCount}`)
  if (Number(state.predecessorWorkCount) !== 1) fail(`predecessor work count drifted: ${state.predecessorWorkCount}`)
  if (Number(state.currentPayloadRows) !== Number(state.currentExpectedPayload)) fail('current payload evidence is incomplete')
  if (Number(state.currentCommitRows) !== Number(state.currentExpectedCommit)) fail('current commit evidence is incomplete')
  if (Number(state.currentCompletedCommitRows) !== Number(state.currentExpectedCommit)) fail('current completed commit evidence is incomplete')
  if (Number(state.predecessorPayloadRows) !== Number(state.predecessorExpectedPayload)) fail('predecessor payload evidence is incomplete')
  if (Number(state.predecessorCommitRows) !== Number(state.predecessorExpectedCommit)) fail('predecessor commit evidence is incomplete')
  if (Number(state.predecessorCompletedCommitRows) !== Number(state.predecessorExpectedCommit)) fail('predecessor completed commit evidence is incomplete')
}
async function inspect(sourceCommit) {
  const state = firstJson(await managementQuery(inspectionSql(), true), 'state')
  assertProtectedIntegrity(state)
  const structural = structuralState(state, sourceCommit)
  if (Number(state.jobRows) !== 0) fail(`raw retention job already exists (${state.jobRows}); no new authorization proposal allowed`)
  if (!state.pgCronExtension || state.pgCronExtension.name !== 'pg_cron') fail('pg_cron extension missing')
  return {
    schemaVersion: 1,
    purpose: 'r5-raw-evidence-retention-state',
    sourceCommit,
    ...state,
    cleanup: { jobName: JOB_NAME, schedule: JOB_SCHEDULE, retentionHours: RETENTION_HOURS, commandSha256: sha256(CLEANUP_SQL), mutationSha256: sha256(MUTATION_SQL) },
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    mutationAuthorized: false,
    schedulerMutationAuthorized: false,
    vacuumAuthorized: false,
    deploymentAuthorized: false,
    mainnetDisabled: true,
  }
}

async function apply(sourceCommit, authorizedState, authorizedMutation) {
  const before = await inspect(sourceCommit)
  if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state no longer matches production')
  if (before.cleanup.mutationSha256 !== authorizedMutation) fail('authorized mutation SHA does not match exact raw-evidence retention transaction')
  const result = firstJson(await managementQuery(MUTATION_SQL, false), 'result')
  const afterState = firstJson(await managementQuery(inspectionSql(), true), 'state')
  assertProtectedIntegrity(afterState)
  if (Number(afterState.jobRows) !== 1) fail(`raw retention job creation mismatch: ${afterState.jobRows}`)
  const job = afterState.jobRecord
  if (!job || job.schedule !== JOB_SCHEDULE || job.command !== CLEANUP_SQL || job.active !== true) fail('raw retention job contract mismatch after apply')
  return {
    schemaVersion: 1,
    purpose: 'r5-raw-evidence-retention-apply-result',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    authorizedMutationSha256: authorizedMutation,
    payloadDeleted: Number(result.payloadDeleted ?? 0),
    commitDeleted: Number(result.commitDeleted ?? 0),
    candidateWorkCount: Number(result.candidateWorkCount ?? 0),
    candidateWorkDigest: result.candidateWorkDigest,
    databaseBytesBefore: Number(before.databaseBytes),
    databaseBytesAfter: Number(afterState.databaseBytes),
    payloadRelationBytesBefore: Number(before.payloadRelationBytes),
    payloadRelationBytesAfter: Number(afterState.payloadRelationBytes),
    commitRelationBytesBefore: Number(before.commitRelationBytes),
    commitRelationBytesAfter: Number(afterState.commitRelationBytes),
    incompleteOldWorkCountBefore: Number(before.incompleteOldWorkCount),
    schedulerMutationPerformed: true,
    rowMutationTargets: ['public.xrpl_phase_payload_chunks', 'public.xrpl_phase_commit_chunks'],
    workRowMutationPerformed: false,
    canonicalReferenceMutationPerformed: false,
    messageMutationPerformed: false,
    successorMutationPerformed: false,
    vacuumPerformed: false,
    deploymentPerformed: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RestartAuthorized: false,
  }
}

const { command, options } = parseArgs(process.argv.slice(2))
const sourceCommit = validateSource(options)
let output
if (command === 'prepare') output = await inspect(sourceCommit)
else if (command === 'apply') {
  const authorizedState = options['authorized-state']
  const authorizedMutation = options['authorized-mutation']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  if (!/^[a-f0-9]{64}$/u.test(authorizedMutation ?? '')) fail('invalid --authorized-mutation')
  output = await apply(sourceCommit, authorizedState, authorizedMutation)
} else fail(`unsupported command: ${command ?? '<missing>'}`)
await writeJson(options.output, output)
process.stdout.write(`${JSON.stringify(output)}\n`)
