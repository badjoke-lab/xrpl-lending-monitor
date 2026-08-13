import { createHash } from 'node:crypto'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID invalid')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN unavailable')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const name = 'xrpl-lending-monitor-minute'
const schedule = '* * * * *'
const oldPath = "'/functions/v1/xrpl-collector-tick'"
const newPath = "'/functions/v1/xrpl-r5-minute-driver'"

function rows(body) {
  if (Array.isArray(body)) return body
  for (const candidate of [body?.result, body?.data, body?.rows, body?.result?.rows, body?.data?.rows]) {
    if (Array.isArray(candidate)) return candidate
  }
  throw new Error('Management API response contains no rows')
}

async function query(sql, parameters = [], readOnly = true) {
  const payload = { query: sql, parameters }
  if (readOnly) payload.read_only = true
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = { raw: text.slice(0, 1000) } }
  if (!response.ok) throw new Error(`Management API query failed (${response.status}): ${JSON.stringify(body)}`)
  return rows(body)
}

const jobs = await query(
  'select jobid, jobname, schedule, command, active from cron.job where jobname = $1::text order by jobid',
  [name],
)
if (jobs.length !== 1) throw new Error(`expected one minute job, found ${jobs.length}`)
const job = jobs[0]
const jobId = Number(job.jobid)
if (!Number.isSafeInteger(jobId) || jobId <= 0 || job.schedule !== schedule || job.active !== true) {
  throw new Error('minute job shape invalid')
}
const command = String(job.command ?? '')
for (const required of ['vault.decrypted_secrets', "name = 'xrpl_project_url'", "name = 'xrpl_secret_key'", "'source', 'pg_cron'", newPath]) {
  if (!command.includes(required)) throw new Error(`new minute command missing:${required}`)
}
if (command.includes(oldPath)) throw new Error('minute command already contains old path')
if (command.split(newPath).length - 1 !== 1) throw new Error('new path occurrence is not exact')
const oldCommand = command.replace(newPath, oldPath)

const unscheduled = await query('select cron.unschedule($1::bigint) as unscheduled', [jobId], false)
if (unscheduled.length !== 1 || unscheduled[0].unscheduled !== true) throw new Error('failed to unschedule new minute job')

let oldJobId
try {
  const scheduled = await query('select cron.schedule($1::text, $2::text, $3::text) as job_id', [name, schedule, oldCommand], false)
  oldJobId = Number(scheduled[0]?.job_id)
  if (!Number.isSafeInteger(oldJobId) || oldJobId <= 0) throw new Error('restored old job id invalid')
} catch (error) {
  try {
    await query('select cron.schedule($1::text, $2::text, $3::text) as job_id', [name, schedule, command], false)
  } catch (recoveryError) {
    console.error(`rollback recovery could not restore the new minute job: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
  }
  throw error
}

const verified = await query(
  'select jobid, jobname, schedule, command, active from cron.job where jobname = $1::text order by jobid',
  [name],
)
if (verified.length !== 1 || Number(verified[0].jobid) !== oldJobId || verified[0].schedule !== schedule || verified[0].active !== true) {
  throw new Error('old minute job restore verification failed')
}
const verifiedCommand = String(verified[0].command ?? '')
if (!verifiedCommand.includes(oldPath) || verifiedCommand.includes(newPath)) throw new Error('old endpoint was not restored')

console.log(JSON.stringify({
  rolledBack: true,
  jobName: name,
  schedule,
  restoredJobId: oldJobId,
  restoredCommandDigest: createHash('sha256').update(verifiedCommand).digest('hex'),
  mainnetDisabled: true,
  rolledBackAt: new Date().toISOString(),
}))
