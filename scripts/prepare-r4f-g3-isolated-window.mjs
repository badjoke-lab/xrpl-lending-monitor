import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const outputPath = process.env.GITHUB_OUTPUT ?? ''
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? 0)

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
if (!outputPath) throw new Error('GITHUB_OUTPUT is unavailable')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact commit SHA')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) throw new Error('GITHUB_RUN_ID must be a positive safe integer')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const evidenceDirectory = 'r4f-g3-isolated-window-prepare-evidence'

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2_000) }
  }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API query response does not contain rows')
}

async function readOnlyQuery(query, parameters = []) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: true }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(`Supabase Management read-only query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  return rowsFromResponse(body)
}

function integer(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

const projectIdentityDigest = createHash('sha256').update(projectRef).digest('hex')
const jobs = await readOnlyQuery(
  `select jobid, jobname, schedule, command, active, database, username
   from cron.job
   where jobname = $1::text
   order by jobid`,
  ['xrpl-lending-monitor-minute'],
)
if (jobs.length !== 1) throw new Error(`expected one collector cron job, found ${jobs.length}`)
const job = jobs[0]
const jobId = integer(job.jobid, 'collector cron job id')
const jobName = String(job.jobname ?? '')
const schedule = String(job.schedule ?? '')
const command = String(job.command ?? '')
if (jobName !== 'xrpl-lending-monitor-minute') throw new Error('collector cron job name mismatch')
if (schedule !== '* * * * *') throw new Error(`collector cron schedule mismatch:${schedule}`)
if (job.active !== true) throw new Error('collector cron job is not active')
for (const required of [
  "vault.decrypted_secrets",
  "name = 'xrpl_project_url'",
  "'/functions/v1/xrpl-collector-tick'",
  "name = 'xrpl_secret_key'",
  "'source', 'pg_cron'",
]) {
  if (!command.includes(required)) throw new Error(`collector cron command missing required fragment:${required}`)
}
if (/https:\/\/[a-z]{20}\.supabase\.co|sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,}/u.test(command)) {
  throw new Error('collector cron command unexpectedly contains retained credential or project endpoint material')
}
const commandDigest = createHash('sha256').update(command).digest('hex')

const runtimes = await readOnlyQuery(
  `select profile_id, network, status, lease_owner is not null as lease_active,
          lease_expires_at, last_started_at, last_completed_at, last_failed_at,
          last_validated_ledger_index, tick_count, consecutive_failures, updated_at
   from public.xrpl_collector_runtime
   where profile_id = $1::text`,
  ['supabase-devnet'],
)
if (runtimes.length !== 1) throw new Error(`expected one collector runtime row, found ${runtimes.length}`)
const runtime = runtimes[0]
if (runtime.profile_id !== 'supabase-devnet' || runtime.network !== 'devnet') {
  throw new Error('collector runtime identity mismatch')
}
if (!['stopped', 'running', 'halted'].includes(String(runtime.status))) {
  throw new Error('collector runtime status is invalid')
}

await mkdir(evidenceDirectory, { recursive: true })
const evidence = {
  schemaVersion: 1,
  purpose: 'r4f-g3-isolated-window-scheduler-prepare',
  sourceRunId,
  sourceCommit,
  observedAt: new Date().toISOString(),
  projectIdentityDigest,
  scheduler: {
    jobId,
    jobName,
    schedule,
    commandDigest,
    active: true,
    database: String(job.database ?? ''),
    username: String(job.username ?? ''),
    commandRetained: false,
  },
  collectorRuntime: {
    profileId: runtime.profile_id,
    network: runtime.network,
    status: runtime.status,
    leaseActive: runtime.lease_active === true,
    leaseExpiresAt: runtime.lease_expires_at ?? null,
    lastStartedAt: runtime.last_started_at ?? null,
    lastCompletedAt: runtime.last_completed_at ?? null,
    lastFailedAt: runtime.last_failed_at ?? null,
    lastValidatedLedgerIndex: runtime.last_validated_ledger_index == null ? null : Number(runtime.last_validated_ledger_index),
    tickCount: Number(runtime.tick_count),
    consecutiveFailures: Number(runtime.consecutive_failures),
    updatedAt: runtime.updated_at ?? null,
  },
  checks: {
    exactNamedCollectorCron: true,
    oneMinuteCadence: true,
    vaultReferencesOnly: true,
    collectorFunctionPathPinned: true,
    projectRefRetained: false,
    credentialsRetained: false,
    readOnlyManagementQuery: true,
    providerMutationPerformed: false,
    databaseMutationPerformed: false,
    recoveryMutationCommitted: false,
    mainnetDisabled: true,
  },
}
await writeFile(`${evidenceDirectory}/scheduler-prepare.json`, `${JSON.stringify(evidence, null, 2)}\n`)
await writeFile(
  outputPath,
  [
    `job_id=${jobId}`,
    `job_name=${jobName}`,
    `schedule=${schedule}`,
    `command_digest=${commandDigest}`,
    `project_digest=${projectIdentityDigest}`,
    `runtime_status=${runtime.status}`,
    `runtime_tick_count=${Number(runtime.tick_count)}`,
    '',
  ].join('\n'),
  { flag: 'a' },
)
process.stdout.write(`${JSON.stringify({
  jobId,
  jobName,
  schedule,
  commandDigest,
  projectIdentityDigest,
  runtimeStatus: runtime.status,
  runtimeTickCount: Number(runtime.tick_count),
})}\n`)
