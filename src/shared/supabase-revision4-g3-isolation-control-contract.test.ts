import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r4f-g3-isolated-window.yml')
const manager = read('scripts/manage-r4f-g3-isolated-window.mjs')
const verifier = resolve(process.cwd(), 'scripts/verify-r4f-g3-isolation-prepare-proposal.mjs')
const commit = '1'.repeat(40)
const projectDigest = '2'.repeat(64)
const commandDigest = '3'.repeat(64)
const prepareRun = 12345
const jobId = 1
const prepareCreatedAt = '2026-08-09T00:00:00Z'
const authorizationCreatedAt = '2026-08-09T00:02:00Z'
const exactPauseCommand = `/r4f-g3-isolation-pause commit=${commit} project=${projectDigest} job=${jobId} command=${commandDigest} prepare_run=${prepareRun}`

function proposalBody(overrides: { jobId?: number; commandDigest?: string; exactCommand?: string } = {}): string {
  const proposalJobId = overrides.jobId ?? jobId
  const proposalCommandDigest = overrides.commandDigest ?? commandDigest
  const exactCommand = overrides.exactCommand ?? exactPauseCommand
  return [
    '## R4F G3 isolated-window pause authorization proposal',
    '',
    `Preparation run: \`${prepareRun}\``,
    `Source commit: \`${commit}\``,
    `Project identity digest: \`${projectDigest}\``,
    'Collector cron job: `xrpl-lending-monitor-minute`',
    `Cron job id: \`${proposalJobId}\``,
    'Schedule: `* * * * *`',
    `Scheduler command digest: \`${proposalCommandDigest}\``,
    '',
    'A database-local watchdog is installed before the collector is paused.',
    'The pause is bounded to at most 15 minutes.',
    '',
    `\`${exactCommand}\``,
  ].join('\n')
}

function runProposalVerifier(body: string) {
  const directory = mkdtempSync(join(tmpdir(), 'r4f-g3-isolation-proposal-'))
  const commentsPath = join(directory, 'comments.json')
  const runPath = join(directory, 'run.json')
  writeFileSync(commentsPath, JSON.stringify([{
    id: 9876,
    user: { login: 'github-actions[bot]' },
    created_at: '2026-08-09T00:00:30Z',
    body,
  }]))
  writeFileSync(runPath, JSON.stringify({
    id: prepareRun,
    name: 'R4F G3 Isolated Window',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: commit,
    created_at: prepareCreatedAt,
  }))
  return spawnSync(process.execPath, [
    verifier,
    '--comments', commentsPath,
    '--run', runPath,
    '--prepare-run', String(prepareRun),
    '--commit', commit,
    '--project-digest', projectDigest,
    '--job-id', String(jobId),
    '--command-digest', commandDigest,
    '--authorization-created-at', authorizationCreatedAt,
  ], { encoding: 'utf8' })
}

describe('R4F G3 bounded isolation control', () => {
  it('binds pause to one exact owner proposal on Issue 1261', () => {
    const result = runProposalVerifier(proposalBody())
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      prepareRun,
      prepareProposalCommentId: 9876,
      sourceCommit: commit,
      projectIdentityDigest: projectDigest,
      cronJobId: jobId,
      commandDigest,
      exactCommandVerified: true,
      watchdogBeforePauseVerified: true,
      fifteenMinuteMaximumVerified: true,
    })

    for (const required of [
      "github.event.issue.number == 1261",
      "github.event.comment.user.login == 'badjoke-lab'",
      "startsWith(github.event.comment.body, '/r4f-g3-isolation-pause ')",
      "regex='^/r4f-g3-isolation-pause commit=",
      'verify-r4f-g3-isolation-prepare-proposal.mjs',
      'test "$commit" = "$(git rev-parse HEAD)"',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('rejects changed job identity or command digest in the proposal', () => {
    const wrongJob = runProposalVerifier(proposalBody({ jobId: 2 }))
    expect(wrongJob.status).not.toBe(0)
    expect(wrongJob.stderr).toContain('expected exactly one matching isolation prepare proposal')

    const wrongDigest = runProposalVerifier(proposalBody({ commandDigest: '4'.repeat(64) }))
    expect(wrongDigest.status).not.toBe(0)
    expect(wrongDigest.stderr).toContain('expected exactly one matching isolation prepare proposal')
  })

  it('installs the database watchdog before unscheduling the collector and bounds the pause', () => {
    const scheduleWatchdog = manager.indexOf("watchdogJobId = await scheduleJob(watchdogName, '* * * * *', watchdogCommand)")
    const unscheduleCollector = manager.indexOf('await unscheduleJob(expectedJobId)')
    expect(scheduleWatchdog).toBeGreaterThan(0)
    expect(unscheduleCollector).toBeGreaterThan(scheduleWatchdog)
    expect(manager).toContain('const quietSeconds = 65')
    expect(manager).toContain('const pauseDeadlineSeconds = 15 * 60')
    expect(manager).toContain("if (Date.now() - stableSince < quietSeconds * 1_000) throw new Error('collector did not reach a 65-second quiet interval')")
    expect(manager).toContain("perform cron.unschedule('${watchdogName}')")
  })

  it('uses read_only true only for inspections and omits the flag for mutation queries', () => {
    expect(manager).toContain('const payload = { query, parameters }')
    expect(manager).toContain('if (readOnly) payload.read_only = true')
    expect(manager).not.toContain('read_only: readOnly')
    expect(manager).toContain("'select cron.schedule($1::text, $2::text, $3::text) as job_id'")
    expect(manager).toContain("'select cron.unschedule($1::bigint) as unscheduled'")
  })

  it('attempts immediate restoration on pause failure and also supports watchdog-based recovery', () => {
    const catchStart = manager.indexOf('} catch (error) {')
    const immediateRestore = manager.indexOf('await scheduleJob(collectorJobName, collectorSchedule, collectorCommand)', catchStart)
    const watchdogCleanup = manager.indexOf('await removeWatchdogs()', catchStart)
    expect(immediateRestore).toBeGreaterThan(catchStart)
    expect(watchdogCleanup).toBeGreaterThan(immediateRestore)
    expect(manager).toContain("decodeCollectorCommandFromWatchdog")
    expect(manager).toContain("if (digests.size !== 1 || !digests.has(expectedCommandDigest))")
    expect(manager).toContain('restoredFromEncodedWatchdogCommand: restoredFromWatchdog')
  })

  it('keeps pause and resume outside R5, public-reader, Mainnet, stabilization, and soak authority', () => {
    for (const forbidden of [
      'xrpl-r5-recovery-batch',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'supabase db',
      'supabase link',
      'supabase functions deploy',
      'supabase secrets set',
      "MAINNET_ENABLED: 'true'",
    ]) {
      expect(workflow).not.toContain(forbidden)
      expect(manager).not.toContain(forbidden)
    }
    expect(manager).toContain('recoveryMutationCommitted: false')
    expect(manager).toContain('publicReaderUnchanged: true')
    expect(manager).toContain('mainnetDisabled: true')
    expect(manager).toContain('stabilizationAuthorized: false')
    expect(manager).toContain('soakAuthorized: false')
  })

  it('makes resume recovery-only and independent of current-main equality', () => {
    const resumeJob = workflow.slice(workflow.indexOf('\n  resume:'))
    expect(resumeJob).toContain("startsWith(github.event.comment.body, '/r4f-g3-isolation-resume ')")
    expect(resumeJob).toContain("regex='^/r4f-g3-isolation-resume project=")
    expect(resumeJob).toContain('--mode resume')
    expect(resumeJob).not.toContain('test "$commit" = "$(git rev-parse HEAD)"')
    expect(resumeJob).toContain("if (run.conclusion !== 'success')")
    expect(resumeJob).toContain('The exact collector scheduler has been restored')
  })
})
