#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const JOB_NAME = 'xrpl-r5-cron-history-retention-v1'
const JOB_SCHEDULE = '17 */6 * * *'
const SUCCESS_HOURS = 24
const FAILURE_DAYS = 7
const DELETE_SQL = `delete from cron.job_run_details where (status = 'succeeded' and end_time is not null and end_time < now() - interval '${SUCCESS_HOURS} hours') or (status is distinct from 'succeeded' and end_time is not null and end_time < now() - interval '${FAILURE_DAYS} days')`

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
function inspectionSql() {
  return `select jsonb_build_object(
    'currentUser', current_user,
    'databaseBytes', pg_database_size(current_database()),
    'tableBytes', pg_total_relation_size('cron.job_run_details'::regclass),
    'heapBytes', pg_relation_size('cron.job_run_details'::regclass),
    'indexBytes', pg_indexes_size('cron.job_run_details'::regclass),
    'tableReloptions', coalesce((select to_jsonb(reloptions) from pg_class where oid='cron.job_run_details'::regclass),'null'::jsonb),
    'tableDefinitionDigestSource', (select jsonb_agg(jsonb_build_object('column',column_name,'type',data_type,'nullable',is_nullable) order by ordinal_position) from information_schema.columns where table_schema='cron' and table_name='job_run_details'),
    'jobRows', (select count(*) from cron.job where jobname='${JOB_NAME}'),
    'jobRecord', coalesce((select jsonb_build_object('jobid',jobid,'schedule',schedule,'command',command,'database',database,'username',username,'active',active) from cron.job where jobname='${JOB_NAME}' limit 1),'null'::jsonb),
    'exactRows', (select count(*) from cron.job_run_details),
    'candidateSucceededRows', (select count(*) from cron.job_run_details where status='succeeded' and end_time is not null and end_time < now()-interval '${SUCCESS_HOURS} hours'),
    'candidateNonSucceededRows', (select count(*) from cron.job_run_details where status is distinct from 'succeeded' and end_time is not null and end_time < now()-interval '${FAILURE_DAYS} days'),
    'retainedSucceededRows', (select count(*) from cron.job_run_details where status='succeeded' and (end_time is null or end_time >= now()-interval '${SUCCESS_HOURS} hours')),
    'retainedNonSucceededRows', (select count(*) from cron.job_run_details where status is distinct from 'succeeded' and (end_time is null or end_time >= now()-interval '${FAILURE_DAYS} days')),
    'oldestStartTime', (select min(start_time) from cron.job_run_details),
    'newestStartTime', (select max(start_time) from cron.job_run_details),
    'maxRunId', (select max(runid) from cron.job_run_details),
    'stats', coalesce((select jsonb_build_object('live',n_live_tup,'dead',n_dead_tup,'lastAutovacuum',last_autovacuum,'autovacuumCount',autovacuum_count) from pg_stat_all_tables where relid='cron.job_run_details'::regclass),'{}'::jsonb)
  ) as state;`
}
function structuralState(state, sourceCommit) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const job = state.jobRecord
  return {
    schemaVersion: 1,
    purpose: 'r5-cron-history-retention-authorization-state',
    sourceCommit,
    projectIdentityDigest: sha256(projectId),
    jobName: JOB_NAME,
    jobSchedule: JOB_SCHEDULE,
    jobCommandSha256: sha256(DELETE_SQL),
    successRetentionHours: SUCCESS_HOURS,
    nonSuccessRetentionDays: FAILURE_DAYS,
    jobRows: Number(state.jobRows),
    existingJobMatches: Number(state.jobRows) === 1 && job?.schedule === JOB_SCHEDULE && job?.command === DELETE_SQL && job?.active === true,
    tableDefinitionSha256: sha256(JSON.stringify(state.tableDefinitionDigestSource)),
  }
}
async function inspect(sourceCommit) {
  const state = firstState(await managementQuery(inspectionSql(), true))
  const structural = structuralState(state, sourceCommit)
  return {
    schemaVersion: 1,
    purpose: 'r5-cron-history-retention-state',
    sourceCommit,
    ...state,
    cleanup: { jobName: JOB_NAME, schedule: JOB_SCHEDULE, commandSha256: sha256(DELETE_SQL), successRetentionHours: SUCCESS_HOURS, nonSuccessRetentionDays: FAILURE_DAYS },
    structuralState: structural,
    structuralStateSha256: sha256(JSON.stringify(structural)),
    mutationAuthorized: false,
    schedulerMutationAuthorized: false,
    vacuumAuthorized: false,
    deploymentAuthorized: false,
    mainnetDisabled: true,
  }
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
async function prepare(options) {
  const sourceCommit = validateSource(options)
  const state = await inspect(sourceCommit)
  if (Number(state.jobRows) !== 0) fail(`cleanup job already exists (${state.jobRows} row(s)); no new authorization proposal allowed`)
  await writeJson(options.output, state)
  process.stdout.write(`${JSON.stringify(state)}\n`)
}
async function apply(options) {
  const sourceCommit = validateSource(options)
  const authorizedState = options['authorized-state']
  if (!/^[a-f0-9]{64}$/u.test(authorizedState ?? '')) fail('invalid --authorized-state')
  const before = await inspect(sourceCommit)
  if (Number(before.jobRows) !== 0) fail('cleanup job already exists before apply')
  if (before.structuralStateSha256 !== authorizedState) fail('authorized structural state drifted before cron retention mutation')

  const escapedCommand = DELETE_SQL.replaceAll("'", "''")
  const escapedSchedule = JOB_SCHEDULE.replaceAll("'", "''")
  const escapedName = JOB_NAME.replaceAll("'", "''")
  const transaction = `begin;\n${DELETE_SQL};\nselect cron.schedule('${escapedName}', '${escapedSchedule}', '${escapedCommand}');\ncommit;`
  await managementQuery(transaction, false)

  const after = await inspect(sourceCommit)
  if (Number(after.jobRows) !== 1 || after.jobRecord?.schedule !== JOB_SCHEDULE || after.jobRecord?.command !== DELETE_SQL || after.jobRecord?.active !== true) fail('cleanup job post-state mismatch')
  if (Number(after.candidateSucceededRows) !== 0 || Number(after.candidateNonSucceededRows) !== 0) fail('bounded initial cleanup left rows beyond authorized horizons')
  if (Number(after.retainedSucceededRows) > Number(before.exactRows)) fail('retained succeeded row count is impossible')

  const evidence = {
    schemaVersion: 1,
    purpose: 'r5-cron-history-retention-apply',
    sourceCommit,
    authorizedStateSha256: authorizedState,
    jobId: after.jobRecord.jobid,
    jobName: JOB_NAME,
    schedule: JOB_SCHEDULE,
    successRetentionHours: SUCCESS_HOURS,
    nonSuccessRetentionDays: FAILURE_DAYS,
    rowsBefore: Number(before.exactRows),
    rowsAfter: Number(after.exactRows),
    rowsDeleted: Number(before.exactRows) - Number(after.exactRows),
    databaseBytesBefore: Number(before.databaseBytes),
    databaseBytesAfter: Number(after.databaseBytes),
    tableBytesBefore: Number(before.tableBytes),
    tableBytesAfter: Number(after.tableBytes),
    deadRowsAfterEstimate: Number(after.stats?.dead ?? 0),
    vacuumPerformed: false,
    schedulerMutationPerformed: true,
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
