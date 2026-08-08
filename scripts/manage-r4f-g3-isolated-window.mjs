import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const mode = argument('--mode')
const expectedJobIdText = argument('--expected-job-id')
const expectedCommandDigest = argument('--expected-command-digest')
const expectedProjectDigest = argument('--expected-project-digest')
const outputDirectory = argument('--output-directory') ?? 'r4f-g3-isolated-window-evidence'
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const sourceRunId = Number(process.env.GITHUB_RUN_ID ?? 0)
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()

if (!['pause', 'resume'].includes(mode ?? '')) throw new Error('mode must be pause or resume')
if (!/^[1-9][0-9]*$/u.test(expectedJobIdText ?? '')) throw new Error('expected job id must be positive')
if (!/^[a-f0-9]{64}$/u.test(expectedCommandDigest ?? '')) throw new Error('expected command digest must be SHA-256')
if (!/^[a-f0-9]{64}$/u.test(expectedProjectDigest ?? '')) throw new Error('expected project digest must be SHA-256')
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
if (!Number.isSafeInteger(sourceRunId) || sourceRunId <= 0) throw new Error('GITHUB_RUN_ID must be positive')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact commit SHA')

const expectedJobId = Number(expectedJobIdText)
const projectIdentityDigest = createHash('sha256').update(projectRef).digest('hex')
if (projectIdentityDigest !== expectedProjectDigest) throw new Error('project identity digest mismatch')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`
const collectorJobName = 'xrpl-lending-monitor-minute'
const collectorSchedule = '* * * * *'
const watchdogPrefix = 'xrpl-g3-isolation-watchdog-'
const quietSeconds = 65
const pauseDeadlineSeconds = 15 * 60

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

async function managementQuery(query, parameters = [], readOnly = true) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ query, parameters, read_only: readOnly }),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  const body = parseJson(text)
  if (!response.ok) {
    throw new Error(`Supabase Management database query failed (${response.status}): ${JSON.stringify(body).slice(0, 2_000)}`)
  }
  return rowsFromResponse(body)
}

function integer(value, name) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

function commandDigest(command) {
  return createHash('sha256').update(command).digest('hex')
}

function validateCollectorCommand(command) {
  if (typeof command !== 'string' || command.length < 100) throw new Error('collector command unavailable')
  for (const required of [
    'vault.decrypted_secrets',
    "name = 'xrpl_project_url'",
    "'/functions/v1/xrpl-collector-tick'",
    "name = 'xrpl_secret_key'",
    "'source', 'pg_cron'",
  ]) {
    if (!command.includes(required)) throw new Error(`collector command missing required fragment:${required}`)
  }
  if (/https:\/\/[a-z]{20}\.supabase\.co|sbp_[A-Za-z0-9_-]{12,}|sb_secret_[A-Za-z0-9_-]{12,}/u.test(command)) {
    throw new Error('collector command contains retained credential or project endpoint material')
  }
  if (commandDigest(command) !== expectedCommandDigest) throw new Error('collector command digest mismatch')
}

async function readCollectorJobs() {
  return managementQuery(
    `select jobid, jobname, schedule, command, active, database, username
     from cron.job
     where jobname = $1::text
     order by jobid`,
    [collectorJobName],
    true,
  )
}

async function readWatchdogs() {
  return managementQuery(
    `select jobid, jobname, schedule, command, active
     from cron.job
     where jobname like $1::text
     order by jobid`,
    [`${watchdogPrefix}%`],
    true,
  )
}

async function readRuntime() {
  const rows = await managementQuery(
    `select profile_id, network, status, lease_owner is not null as lease_active,
            lease_expires_at, last_started_at, last_completed_at,
            last_validated_ledger_index, tick_count, consecutive_failures, updated_at
     from public.xrpl_collector_runtime
     where profile_id = $1::text`,
    ['supabase-devnet'],
    true,
  )
  if (rows.length !== 1) throw new Error(`expected one collector runtime row, found ${rows.length}`)
  const runtime = rows[0]
  if (runtime.profile_id !== 'supabase-devnet' || runtime.network !== 'devnet') throw new Error('collector runtime identity mismatch')
  if (!['stopped', 'running', 'halted'].includes(String(runtime.status))) throw new Error('collector runtime status invalid')
  return runtime
}

function validateCollectorJob(job) {
  if (integer(job.jobid, 'collector job id') !== expectedJobId) throw new Error('collector job id mismatch')
  if (job.jobname !== collectorJobName) throw new Error('collector job name mismatch')
  if (job.schedule !== collectorSchedule) throw new Error('collector schedule mismatch')
  if (job.active !== true) throw new Error('collector job must be active')
  validateCollectorCommand(String(job.command ?? ''))
}

async function waitUntilRuntimeStopped(maxMilliseconds = 70_000) {
  const started = Date.now()
  while (Date.now() - started <= maxMilliseconds) {
    const runtime = await readRuntime()
    if (runtime.status === 'stopped' && runtime.lease_active !== true) return runtime
    if (runtime.status === 'halted') throw new Error('collector runtime is halted')
    await new Promise((resolve) => setTimeout(resolve, 2_000))
  }
  throw new Error('collector runtime did not become stopped before pause')
}

function buildWatchdogCommand({ watchdogName, deadline, collectorCommand }) {
  const encoded = Buffer.from(collectorCommand, 'utf8').toString('base64')
  return `do $r4fg3watchdog$\nbegin\n  if clock_timestamp() >= '${deadline}'::timestamptz then\n    if not exists (select 1 from cron.job where jobname = '${collectorJobName}') then\n      perform cron.schedule(\n        '${collectorJobName}',\n        '${collectorSchedule}',\n        convert_from(decode('${encoded}', 'base64'), 'UTF8')\n      );\n    end if;\n    perform cron.unschedule('${watchdogName}');\n  end if;\nend\n$r4fg3watchdog$;`
}

async function scheduleJob(name, schedule, command) {
  const rows = await managementQuery(
    'select cron.schedule($1::text, $2::text, $3::text) as job_id',
    [name, schedule, command],
    false,
  )
  if (rows.length !== 1) throw new Error(`cron.schedule returned ${rows.length} rows`)
  return integer(rows[0].job_id, 'scheduled job id')
}

async function unscheduleJob(jobId) {
  const rows = await managementQuery(
    'select cron.unschedule($1::bigint) as unscheduled',
    [jobId],
    false,
  )
  if (rows.length !== 1 || rows[0].unscheduled !== true) throw new Error(`cron.unschedule rejected job ${jobId}`)
}

async function verifyCollectorRestored() {
  const jobs = await readCollectorJobs()
  if (jobs.length !== 1) throw new Error(`collector restore verification found ${jobs.length} jobs`)
  validateCollectorCommand(String(jobs[0].command ?? ''))
  if (jobs[0].jobname !== collectorJobName || jobs[0].schedule !== collectorSchedule || jobs[0].active !== true) {
    throw new Error('restored collector scheduler shape mismatch')
  }
  return jobs[0]
}

async function removeWatchdogs() {
  const watchdogs = await readWatchdogs()
  for (const watchdog of watchdogs) {
    await unscheduleJob(integer(watchdog.jobid, 'watchdog job id'))
  }
  return watchdogs.length
}

function decodeCollectorCommandFromWatchdog(command) {
  const match = String(command ?? '').match(/decode\('([A-Za-z0-9+/=]+)', 'base64'\)/u)
  if (!match) throw new Error('watchdog does not contain encoded collector command')
  const decoded = Buffer.from(match[1], 'base64').toString('utf8')
  validateCollectorCommand(decoded)
  return decoded
}

async function pause() {
  const jobs = await readCollectorJobs()
  if (jobs.length !== 1) throw new Error(`expected one collector cron job before pause, found ${jobs.length}`)
  const job = jobs[0]
  validateCollectorJob(job)
  if ((await readWatchdogs()).length !== 0) throw new Error('pre-existing G3 isolation watchdog found')
  const runtimeBefore = await waitUntilRuntimeStopped()
  const collectorCommand = String(job.command)
  const watchdogName = `${watchdogPrefix}${sourceRunId}`
  const deadline = new Date(Date.now() + pauseDeadlineSeconds * 1_000).toISOString()
  const watchdogCommand = buildWatchdogCommand({ watchdogName, deadline, collectorCommand })

  let watchdogJobId = null
  let collectorUnscheduled = false
  try {
    watchdogJobId = await scheduleJob(watchdogName, '* * * * *', watchdogCommand)
    await unscheduleJob(expectedJobId)
    collectorUnscheduled = true
    const pausedAt = new Date().toISOString()

    if ((await readCollectorJobs()).length !== 0) throw new Error('collector scheduler still exists after pause')
    const watchdogs = await readWatchdogs()
    if (watchdogs.length !== 1 || integer(watchdogs[0].jobid, 'watchdog job id') !== watchdogJobId) {
      throw new Error('watchdog verification mismatch after pause')
    }

    let lastTickCount = Number(runtimeBefore.tick_count)
    let lastStartedAt = String(runtimeBefore.last_started_at ?? '')
    let stableSince = Date.now()
    const quietDeadline = Date.now() + 150_000
    let runtimeReady = runtimeBefore
    while (Date.now() < quietDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 5_000))
      const runtime = await readRuntime()
      const tickCount = Number(runtime.tick_count)
      const startedAt = String(runtime.last_started_at ?? '')
      if (runtime.status === 'halted') throw new Error('collector runtime halted during isolation pause')
      if (runtime.status !== 'stopped' || runtime.lease_active === true || tickCount !== lastTickCount || startedAt !== lastStartedAt) {
        lastTickCount = tickCount
        lastStartedAt = startedAt
        stableSince = Date.now()
        runtimeReady = runtime
        continue
      }
      runtimeReady = runtime
      if (Date.now() - stableSince >= quietSeconds * 1_000) break
    }
    if (Date.now() - stableSince < quietSeconds * 1_000) throw new Error('collector did not reach a 65-second quiet interval')

    const quietReadyAt = new Date().toISOString()
    const evidence = {
      schemaVersion: 1,
      purpose: 'r4f-g3-isolated-window-pause',
      sourceRunId,
      sourceCommit,
      projectIdentityDigest,
      pausedAt,
      quietReadyAt,
      automaticRestoreDeadline: deadline,
      scheduler: {
        priorJobId: expectedJobId,
        jobName: collectorJobName,
        schedule: collectorSchedule,
        commandDigest: expectedCommandDigest,
        watchdogJobId,
        watchdogName,
        collectorJobAbsent: true,
        commandRetained: false,
      },
      collectorRuntime: {
        status: runtimeReady.status,
        leaseActive: runtimeReady.lease_active === true,
        tickCount: Number(runtimeReady.tick_count),
        lastStartedAt: runtimeReady.last_started_at ?? null,
        lastCompletedAt: runtimeReady.last_completed_at ?? null,
        lastValidatedLedgerIndex: runtimeReady.last_validated_ledger_index == null ? null : Number(runtimeReady.last_validated_ledger_index),
      },
      checks: {
        exactProjectIdentity: true,
        exactSchedulerIdentity: true,
        automaticRestoreWatchdogInstalledFirst: true,
        collectorSchedulerPaused: true,
        quietIntervalSeconds: quietSeconds,
        recoveryMutationCommitted: false,
        publicReaderUnchanged: true,
        mainnetDisabled: true,
        stabilizationAuthorized: false,
        soakAuthorized: false,
      },
    }
    return evidence
  } catch (error) {
    const restoreErrors = []
    if (collectorUnscheduled) {
      try {
        await scheduleJob(collectorJobName, collectorSchedule, collectorCommand)
        await verifyCollectorRestored()
      } catch (restoreError) {
        restoreErrors.push(restoreError instanceof Error ? restoreError.message : String(restoreError))
      }
    }
    if (watchdogJobId !== null) {
      try {
        await removeWatchdogs()
      } catch (watchdogError) {
        restoreErrors.push(watchdogError instanceof Error ? watchdogError.message : String(watchdogError))
      }
    }
    const original = error instanceof Error ? error.message : String(error)
    throw new Error(restoreErrors.length > 0 ? `${original}; immediate restore errors:${restoreErrors.join(';')}` : original)
  }
}

async function resume() {
  const collectorJobs = await readCollectorJobs()
  const watchdogs = await readWatchdogs()
  let restoredFromWatchdog = false
  let collectorCommand = null

  if (collectorJobs.length === 1) {
    validateCollectorCommand(String(collectorJobs[0].command ?? ''))
    if (collectorJobs[0].jobname !== collectorJobName || collectorJobs[0].schedule !== collectorSchedule || collectorJobs[0].active !== true) {
      throw new Error('existing collector scheduler shape mismatch during resume')
    }
  } else if (collectorJobs.length === 0) {
    if (watchdogs.length < 1) throw new Error('collector absent and no G3 isolation watchdog can restore it')
    const decodedCommands = watchdogs.map((watchdog) => decodeCollectorCommandFromWatchdog(watchdog.command))
    const digests = new Set(decodedCommands.map(commandDigest))
    if (digests.size !== 1 || !digests.has(expectedCommandDigest)) throw new Error('watchdog collector command digests disagree')
    collectorCommand = decodedCommands[0]
    await scheduleJob(collectorJobName, collectorSchedule, collectorCommand)
    await verifyCollectorRestored()
    restoredFromWatchdog = true
  } else {
    throw new Error(`multiple collector scheduler jobs found during resume:${collectorJobs.length}`)
  }

  const removedWatchdogs = await removeWatchdogs()
  const restoredJob = await verifyCollectorRestored()
  const runtime = await readRuntime()
  const evidence = {
    schemaVersion: 1,
    purpose: 'r4f-g3-isolated-window-resume',
    sourceRunId,
    sourceCommit,
    resumedAt: new Date().toISOString(),
    projectIdentityDigest,
    scheduler: {
      jobId: integer(restoredJob.jobid, 'restored collector job id'),
      jobName: restoredJob.jobname,
      schedule: restoredJob.schedule,
      commandDigest: expectedCommandDigest,
      active: restoredJob.active === true,
      watchdogsRemoved: removedWatchdogs,
      restoredFromEncodedWatchdogCommand: restoredFromWatchdog,
      commandRetained: false,
    },
    collectorRuntime: {
      status: runtime.status,
      leaseActive: runtime.lease_active === true,
      tickCount: Number(runtime.tick_count),
      lastStartedAt: runtime.last_started_at ?? null,
      lastCompletedAt: runtime.last_completed_at ?? null,
      lastValidatedLedgerIndex: runtime.last_validated_ledger_index == null ? null : Number(runtime.last_validated_ledger_index),
    },
    checks: {
      exactProjectIdentity: true,
      exactSchedulerCommandDigest: true,
      collectorSchedulerRestored: true,
      watchdogsRemoved: (await readWatchdogs()).length === 0,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  return evidence
}

await mkdir(outputDirectory, { recursive: true })
try {
  const evidence = mode === 'pause' ? await pause() : await resume()
  const filename = mode === 'pause' ? 'pause.json' : 'resume.json'
  await writeFile(`${outputDirectory}/${filename}`, `${JSON.stringify(evidence, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(evidence)}\n`)
} catch (error) {
  const failure = {
    schemaVersion: 1,
    purpose: `r4f-g3-isolated-window-${mode}-failure`,
    sourceRunId,
    sourceCommit,
    failedAt: new Date().toISOString(),
    projectIdentityDigest,
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
    failClosed: true,
  }
  await writeFile(`${outputDirectory}/${mode}-failure.json`, `${JSON.stringify(failure, null, 2)}\n`)
  throw error
}
