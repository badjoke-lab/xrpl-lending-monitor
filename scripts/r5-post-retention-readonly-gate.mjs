#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const PROFILE_ID = 'supabase-devnet'
const DATABASE_HALT_BYTES = 400_000_000
const CRON_JOB_NAME = 'xrpl-r5-cron-history-retention-v1'
const CRON_JOB_SCHEDULE = '17 */6 * * *'
const CRON_JOB_COMMAND_SHA256 = 'ac60d960ced46834e5046f0911d4127cb58e5036f679005d3900d10a7b57ac72'
const RAW_JOB_NAME = 'xrpl-r5-raw-evidence-retention-v1'
const RAW_JOB_SCHEDULE = '47 */6 * * *'
const RAW_JOB_COMMAND_SHA256 = 'a7029e464b56f7652b7690b6a8f5b90331d5dfbb0812e3a0ab2788987c64ec98'
const CRON_CADENCE_LAG_BUDGET_ROWS = 360
const RAW_CADENCE_LAG_BUDGET_WORK = 120

function fail(message) { throw new Error(message) }
function sha256(value) { return createHash('sha256').update(String(value), 'utf8').digest('hex') }
function requireEnv(name, pattern) {
  const value = process.env[name]
  if (!value) fail(`missing required environment variable: ${name}`)
  if (pattern && !pattern.test(value)) fail(`invalid ${name}`)
  return value
}
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value == null || value.startsWith('--')) fail(`invalid argument near ${key ?? '<end>'}`)
    out[key.slice(2)] = value
  }
  return out
}
function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  fail('Management API response contains no rows')
}
async function managementQuery(query) {
  const projectId = requireEnv('SUPABASE_PROJECT_ID', /^[a-z]{20}$/u)
  const token = requireEnv('SUPABASE_ACCESS_TOKEN')
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ query, parameters: [], read_only: true }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 2000) } }
  if (!response.ok) fail(`Supabase Management API read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  return rowsFromResponse(body)
}
function firstJson(rows) {
  const raw = rows?.[0]?.state ?? rows?.[0]?.STATE
  if (raw == null) fail('state row missing')
  return typeof raw === 'string' ? JSON.parse(raw) : raw
}
async function writeText(path, value) {
  if (!path) return
  const absolute = resolve(path)
  await mkdir(dirname(absolute), { recursive: true })
  await writeFile(absolute, value)
}

const SQL = String.raw`with active_watermark as (
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
), old_complete_work as (
  select w.* from public.xrpl_phase_work w
  where w.profile_id='${PROFILE_ID}' and w.status='committed' and w.committed_at is not null
    and w.committed_at < now()-interval '24 hours'
    and not exists(select 1 from protected_work p where p.work_id=w.work_id)
    and (select count(*) from public.xrpl_phase_payload_chunks p where p.work_id=w.work_id)=w.expected_payload_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id)=w.expected_commit_chunks
    and (select count(*) from public.xrpl_phase_commit_chunks c where c.work_id=w.work_id and c.status='completed')=w.expected_commit_chunks
), jobs as (
  select jobname,schedule,command,active,database,username from cron.job
  where jobname in ('${CRON_JOB_NAME}','${RAW_JOB_NAME}')
)
select jsonb_build_object(
  'capturedAt',now(),
  'databaseBytes',pg_database_size(current_database())::bigint,
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
  'rawOldCompleteWorkCount',(select count(*)::bigint from old_complete_work),
  'rawOldPayloadRows',(select count(*)::bigint from public.xrpl_phase_payload_chunks p join old_complete_work w on w.work_id=p.work_id),
  'rawOldCommitRows',(select count(*)::bigint from public.xrpl_phase_commit_chunks c join old_complete_work w on w.work_id=c.work_id),
  'cronSucceededOlder24h',(select count(*)::bigint from cron.job_run_details where status='succeeded' and end_time is not null and start_time < now()-interval '24 hours'),
  'cronTerminalNonSucceededOlder7d',(select count(*)::bigint from cron.job_run_details where status is distinct from 'succeeded' and end_time is not null and start_time < now()-interval '7 days'),
  'cronRunRows',(select count(*)::bigint from cron.job_run_details),
  'cronRunRelationBytes',pg_total_relation_size('cron.job_run_details'::regclass)::bigint,
  'cronJobRows',(select count(*)::bigint from jobs where jobname='${CRON_JOB_NAME}'),
  'cronJob',(select jsonb_build_object('schedule',schedule,'command',command,'active',active,'database',database,'username',username) from jobs where jobname='${CRON_JOB_NAME}' limit 1),
  'rawJobRows',(select count(*)::bigint from jobs where jobname='${RAW_JOB_NAME}'),
  'rawJob',(select jsonb_build_object('schedule',schedule,'command',command,'active',active,'database',database,'username',username) from jobs where jobname='${RAW_JOB_NAME}' limit 1)
) as state;`

function integrity(state) {
  return Number(state.currentWorkCount) === 1
    && Number(state.predecessorWorkCount) === 1
    && Number(state.currentPayloadRows) === Number(state.currentExpectedPayload)
    && Number(state.currentCommitRows) === Number(state.currentExpectedCommit)
    && Number(state.currentCompletedCommitRows) === Number(state.currentExpectedCommit)
    && Number(state.predecessorPayloadRows) === Number(state.predecessorExpectedPayload)
    && Number(state.predecessorCommitRows) === Number(state.predecessorExpectedCommit)
    && Number(state.predecessorCompletedCommitRows) === Number(state.predecessorExpectedCommit)
}
function jobVerdict(rowCount, job, name, schedule, commandSha) {
  if (Number(rowCount) === 0) return { state: 'pending', reason: `${name} is not installed` }
  if (Number(rowCount) !== 1) return { state: 'block', reason: `${name} row count is ${rowCount}` }
  if (!job || job.active !== true || job.schedule !== schedule || sha256(job.command ?? '') !== commandSha) {
    return { state: 'block', reason: `${name} contract mismatch` }
  }
  return { state: 'pass', reason: `${name} exact contract present` }
}

const options = parseArgs(process.argv.slice(2))
const sourceCommit = options['source-commit']
if (!/^[a-f0-9]{40}$/u.test(sourceCommit ?? '')) fail('invalid --source-commit')
const state = firstJson(await managementQuery(SQL))
const cronJob = jobVerdict(state.cronJobRows, state.cronJob, CRON_JOB_NAME, CRON_JOB_SCHEDULE, CRON_JOB_COMMAND_SHA256)
const rawJob = jobVerdict(state.rawJobRows, state.rawJob, RAW_JOB_NAME, RAW_JOB_SCHEDULE, RAW_JOB_COMMAND_SHA256)
const activeEvidenceComplete = integrity(state)
const databaseUnderHalt = Number(state.databaseBytes) < DATABASE_HALT_BYTES
const cronLagWithinCadence = Number(state.cronSucceededOlder24h) <= CRON_CADENCE_LAG_BUDGET_ROWS && Number(state.cronTerminalNonSucceededOlder7d) === 0
const rawLagWithinCadence = Number(state.rawOldCompleteWorkCount) <= RAW_CADENCE_LAG_BUDGET_WORK
let verdict = 'pass'
const blockers = []
if (cronJob.state === 'pending' || rawJob.state === 'pending') verdict = 'pending'
for (const [ok, reason] of [
  [activeEvidenceComplete, 'current/predecessor raw evidence is incomplete'],
  [databaseUnderHalt, `database is at or above ${DATABASE_HALT_BYTES} bytes`],
  [cronLagWithinCadence, 'cron history retention lag exceeds the 6h cadence budget'],
  [rawLagWithinCadence, 'raw evidence retention lag exceeds the 6h cadence budget'],
  [cronJob.state !== 'block', cronJob.reason],
  [rawJob.state !== 'block', rawJob.reason],
]) if (!ok) { verdict = 'block'; blockers.push(reason) }

const output = {
  schemaVersion: 1,
  purpose: 'r5-post-retention-readonly-gate',
  sourceCommit,
  capturedAt: state.capturedAt,
  verdict,
  blockers,
  database: {
    bytes: Number(state.databaseBytes),
    haltBytes: DATABASE_HALT_BYTES,
    headroomBytes: DATABASE_HALT_BYTES - Number(state.databaseBytes),
    underHalt: databaseUnderHalt,
  },
  protectedEvidence: { complete: activeEvidenceComplete },
  cronRetention: {
    job: cronJob,
    succeededOlder24h: Number(state.cronSucceededOlder24h),
    terminalNonSucceededOlder7d: Number(state.cronTerminalNonSucceededOlder7d),
    cadenceLagBudgetRows: CRON_CADENCE_LAG_BUDGET_ROWS,
    lagWithinCadence: cronLagWithinCadence,
    runRows: Number(state.cronRunRows),
    relationBytes: Number(state.cronRunRelationBytes),
  },
  rawRetention: {
    job: rawJob,
    oldCompleteWorkCount: Number(state.rawOldCompleteWorkCount),
    oldPayloadRows: Number(state.rawOldPayloadRows),
    oldCommitRows: Number(state.rawOldCommitRows),
    cadenceLagBudgetWork: RAW_CADENCE_LAG_BUDGET_WORK,
    lagWithinCadence: rawLagWithinCadence,
  },
  boundary: {
    readOnly: true,
    productionMutationAuthorized: false,
    deploymentAuthorized: false,
    mainnetDisabled: true,
    stabilizationAuthorized: false,
    soakAuthorized: false,
    r5RestartAuthorized: false,
  },
}
const summary = `## R5 post-retention read-only gate\n\n- source commit: \`${sourceCommit}\`\n- verdict: **${verdict.toUpperCase()}**\n- database: **${output.database.bytes} B** / halt ${DATABASE_HALT_BYTES} B / headroom **${output.database.headroomBytes} B**\n- current + predecessor raw evidence complete: **${activeEvidenceComplete}**\n- cron retention job: **${cronJob.state}**; succeeded >24h: **${output.cronRetention.succeededOlder24h}** / cadence budget ${CRON_CADENCE_LAG_BUDGET_ROWS}\n- raw retention job: **${rawJob.state}**; complete old work >24h: **${output.rawRetention.oldCompleteWorkCount}** / cadence budget ${RAW_CADENCE_LAG_BUDGET_WORK}\n- production mutation / deployment / Mainnet / stabilization / soak / R5 restart: **not authorized**\n${blockers.length ? `- blockers: ${blockers.join('; ')}\n` : ''}`
await writeText(options.output, `${JSON.stringify(output, null, 2)}\n`)
await writeText(options.summary, summary)
process.stdout.write(`${JSON.stringify(output)}\n`)
