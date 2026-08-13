import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const expectedCommandDigest = argument('--expected-command-digest')
const expectedProjectDigest = argument('--expected-project-digest')
const outputDirectory = argument('--output-directory') ?? 'r5-revision4-minute-activation-evidence'
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? 0)
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()

if (!/^[a-f0-9]{64}$/u.test(expectedCommandDigest ?? '')) {
  throw new Error('expected command digest must be SHA-256')
}
if (!/^[a-f0-9]{64}$/u.test(expectedProjectDigest ?? '')) {
  throw new Error('expected project digest must be SHA-256')
}
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be exact')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) throw new Error('GITHUB_RUN_ID invalid')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA invalid')

const projectIdentityDigest = createHash('sha256').update(projectRef).digest('hex')
if (projectIdentityDigest !== expectedProjectDigest) throw new Error('project identity digest mismatch')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const collectorJobName = 'xrpl-lending-monitor-minute'
const collectorSchedule = '* * * * *'
const watchdogPrefix = 'xrpl-g3-isolation-watchdog-'
const oldFunctionPath = "'/functions/v1/xrpl-collector-tick'"
const newFunctionPath = "'/functions/v1/xrpl-r5-minute-driver'"

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 2000) }
  }
}

function rowsFromResponse(body) {
  if (Array.isArray(body)) return body
  if (body && typeof body === 'object') {
    for (const candidate of [body.result, body.data, body.rows, body.result?.rows, body.data?.rows]) {
      if (Array.isArray(candidate)) return candidate
    }
  }
  throw new Error('Management API response contains no rows')
}

async function managementQuery(query, parameters = [], readOnly = true) {
  const payload = { query, parameters }
  if (readOnly) payload.read_only = true
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(`Management API query failed (${response.status}): ${JSON.stringify(body).slice(0, 2000)}`)
  }
  return rowsFromResponse(body)
}

function positiveInteger(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} invalid`)
  return parsed
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validateOldCommand(command) {
  if (typeof command !== 'string' || command.length < 100) throw new Error('old command unavailable')
  for (const required of [
    'vault.decrypted_secrets',
    "name = 'xrpl_project_url'",
    oldFunctionPath,
    "name = 'xrpl_secret_key'",
    "'source', 'pg_cron'",
  ]) {
    if (!command.includes(required)) throw new Error(`old command missing:${required}`)
  }
  if (command.includes(newFunctionPath)) throw new Error('old command already references minute driver')
  if (sha256(command) !== expectedCommandDigest) throw new Error('old command digest mismatch')
}

function buildNewCommand(oldCommand) {
  const count = oldCommand.split(oldFunctionPath).length - 1
  if (count !== 1) throw new Error(`expected one old function path, found ${count}`)
  const next = oldCommand.replace(oldFunctionPath, newFunctionPath)
  if (next.includes(oldFunctionPath) || !next.includes(newFunctionPath)) {
    throw new Error('minute driver command replacement failed')
  }
  for (const required of [
    'vault.decrypted_secrets',
    "name = 'xrpl_project_url'",
    "name = 'xrpl_secret_key'",
    "'source', 'pg_cron'",
  ]) {
    if (!next.includes(required)) throw new Error(`new command lost required fragment:${required}`)
  }
  return next
}

async function readCollectorJobs() {
  return managementQuery(
    `select jobid, jobname, schedule, command, active from cron.job where jobname = $1::text order by jobid`,
    [collectorJobName],
    true,
  )
}

async function readWatchdogs() {
  return managementQuery(
    `select jobid, jobname, schedule, command, active from cron.job where jobname like $1::text order by jobid`,
    [`${watchdogPrefix}%`],
    true,
  )
}

function decodeOldCommand(watchdogCommand) {
  const match = String(watchdogCommand ?? '').match(/decode\('([A-Za-z0-9+/=]+)', 'base64'\)/u)
  if (!match) throw new Error('watchdog lacks encoded old collector command')
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  validateOldCommand(decoded)
  return decoded
}

async function schedule(command) {
  const rows = await managementQuery(
    'select cron.schedule($1::text, $2::text, $3::text) as job_id',
    [collectorJobName, collectorSchedule, command],
    false,
  )
  if (rows.length !== 1) throw new Error('cron.schedule returned unexpected rows')
  return positiveInteger(rows[0].job_id, 'new job id')
}

async function unschedule(jobId) {
  const rows = await managementQuery(
    'select cron.unschedule($1::bigint) as unscheduled',
    [jobId],
    false,
  )
  if (rows.length !== 1 || rows[0].unscheduled !== true) {
    throw new Error(`cron.unschedule rejected job ${jobId}`)
  }
}

async function verifyNewJob(expectedJobId, expectedNewDigest) {
  const jobs = await readCollectorJobs()
  if (jobs.length !== 1) throw new Error(`expected one active minute job, found ${jobs.length}`)
  const job = jobs[0]
  if (
    positiveInteger(job.jobid, 'verified job id') !== expectedJobId
    || job.jobname !== collectorJobName
    || job.schedule !== collectorSchedule
    || job.active !== true
  ) {
    throw new Error('new minute job shape mismatch')
  }
  const command = String(job.command ?? '')
  if (!command.includes(newFunctionPath) || command.includes(oldFunctionPath)) {
    throw new Error('new minute job endpoint mismatch')
  }
  if (sha256(command) !== expectedNewDigest) throw new Error('new minute command digest mismatch')
  return job
}

await mkdir(outputDirectory, { recursive: true })

const collectorBefore = await readCollectorJobs()
if (collectorBefore.length !== 0) {
  throw new Error(`collector must be paused before switch; found ${collectorBefore.length} jobs`)
}
const watchdogs = await readWatchdogs()
if (watchdogs.length !== 1) throw new Error(`expected one restore watchdog, found ${watchdogs.length}`)
if (watchdogs[0].active !== true || watchdogs[0].schedule !== '* * * * *') {
  throw new Error('restore watchdog is not active every minute')
}

const oldCommand = decodeOldCommand(watchdogs[0].command)
const newCommand = buildNewCommand(oldCommand)
const newCommandDigest = sha256(newCommand)
let newJobId = null
let switched = false

try {
  newJobId = await schedule(newCommand)
  await verifyNewJob(newJobId, newCommandDigest)

  for (const watchdog of watchdogs) {
    await unschedule(positiveInteger(watchdog.jobid, 'watchdog job id'))
  }
  if ((await readWatchdogs()).length !== 0) throw new Error('watchdog remained after successful switch')
  await verifyNewJob(newJobId, newCommandDigest)
  switched = true
} catch (error) {
  const recoveryErrors = []
  if (newJobId !== null) {
    try {
      const jobs = await readCollectorJobs()
      for (const job of jobs) {
        if (Number(job.jobid) === newJobId) await unschedule(newJobId)
      }
    } catch (cleanupError) {
      recoveryErrors.push(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
    }
  }
  try {
    if ((await readCollectorJobs()).length === 0) await schedule(oldCommand)
  } catch (restoreError) {
    recoveryErrors.push(restoreError instanceof Error ? restoreError.message : String(restoreError))
  }
  try {
    for (const watchdog of await readWatchdogs()) {
      await unschedule(positiveInteger(watchdog.jobid, 'watchdog job id'))
    }
  } catch (watchdogError) {
    recoveryErrors.push(watchdogError instanceof Error ? watchdogError.message : String(watchdogError))
  }
  const original = error instanceof Error ? error.message : String(error)
  throw new Error(recoveryErrors.length > 0 ? `${original}; restore errors:${recoveryErrors.join(';')}` : original)
}

const verified = await verifyNewJob(newJobId, newCommandDigest)
const evidence = {
  schemaVersion: 1,
  purpose: 'r5-revision4-one-minute-scheduler-switch',
  sourceRunId,
  sourceCommit,
  projectIdentityDigest,
  switched,
  schedule: collectorSchedule,
  jobName: collectorJobName,
  oldCommandDigest: expectedCommandDigest,
  newCommandDigest,
  newJobId,
  newFunction: 'xrpl-r5-minute-driver',
  oldFunction: 'xrpl-collector-tick',
  watchdogsRemaining: 0,
  active: verified.active === true,
  mainnetDisabled: true,
  switchedAt: new Date().toISOString(),
}
await writeFile(`${outputDirectory}/scheduler-switch.json`, `${JSON.stringify(evidence, null, 2)}\n`)
console.log(JSON.stringify(evidence))
console.log(`new_command_digest=${newCommandDigest}`)
console.log(`new_job_id=${newJobId}`)
