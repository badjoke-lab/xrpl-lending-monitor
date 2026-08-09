import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const PROJECT = '81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8'
const COMMAND = 'fbf7deef93198a3de84690747c660a41223a2f30df6a0e695593bfbf7eac411e'
const COMMIT = '5d33787ebb9dff16e05ce9efdbc8c1af54ae2dd5'
const PAUSE_RUN = 31320186675
const ONE_SHOT_RUN = 31320474370
const DASHBOARD_AUTH = 5232150979
const BEFORE = 5232202185
const AUTH = 5232211747

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runVerifier(locatorCreatedAt: string, resumeCreatedAt = '2026-08-09T15:12:54Z') {
  const dir = mkdtempSync(join(tmpdir(), 'r4f-g3-resume-regression-'))
  dirs.push(dir)
  const commentsPath = join(dir, 'comments.json')
  const pausePath = join(dir, 'pause.json')
  const oneShotPath = join(dir, 'one-shot.json')

  const comments = [
    {
      id: DASHBOARD_AUTH,
      created_at: '2026-08-09T14:58:12Z',
      user: { login: 'badjoke-lab' },
      body: `/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=${COMMIT} project=${PROJECT} job=296 command=${COMMAND} prepare_run=31319801477`,
    },
    {
      id: BEFORE,
      created_at: '2026-08-09T15:09:55Z',
      user: { login: 'badjoke-lab' },
      body: `/r4f-g3-before dashboard_auth=${DASHBOARD_AUTH} pause_run=${PAUSE_RUN} project=${PROJECT} captured_at=2026-08-09T15:09:39Z invocations=19469 artifact=43a25bfed22b62bda5b06033c54c45cfb53873ae815e6e5f526534636c5ba249`,
    },
    {
      id: AUTH,
      created_at: '2026-08-09T15:12:06Z',
      user: { login: 'badjoke-lab' },
      body: `/r4f-g3-authorize commit=${COMMIT} ledger=4337208 project=${PROJECT} prepare_run=31320380347 dashboard_auth=${DASHBOARD_AUTH} pause_run=${PAUSE_RUN} before_comment=${BEFORE}`,
    },
    {
      id: 5232213326,
      created_at: locatorCreatedAt,
      user: { login: 'github-actions[bot]' },
      body: `## R4F G3 one-shot probe run\n\nRun: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/${ONE_SHOT_RUN}\nStatus: \`success\`\nAuthorization comment: \`${AUTH}\`\nSource commit: \`${COMMIT}\`\nDevnet ledger: \`4337208\`\nProject identity digest: \`${PROJECT}\`\nPause run: \`${PAUSE_RUN}\`\nBEFORE capture comment: \`${BEFORE}\``,
    },
  ]
  const pauseRun = {
    id: PAUSE_RUN,
    name: 'R4F G3 Isolated Window',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: COMMIT,
  }
  const oneShotRun = {
    id: ONE_SHOT_RUN,
    name: 'R4F G3 One-Shot Probe',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: COMMIT,
    run_started_at: '2026-08-09T15:12:09Z',
    updated_at: '2026-08-09T15:12:30Z',
  }

  writeFileSync(commentsPath, JSON.stringify(comments))
  writeFileSync(pausePath, JSON.stringify(pauseRun))
  writeFileSync(oneShotPath, JSON.stringify(oneShotRun))

  return execFileSync(
    process.execPath,
    [
      'scripts/verify-r4f-g3-resume-sequence.mjs',
      '--comments', commentsPath,
      '--pause-run', pausePath,
      '--one-shot-run', oneShotPath,
      '--pause-run-id', String(PAUSE_RUN),
      '--before-comment-id', String(BEFORE),
      '--project-digest', PROJECT,
      '--job-id', '296',
      '--command-digest', COMMAND,
      '--resume-created-at', resumeCreatedAt,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
}

function runAfterVerifier(afterCapturedAt = '2026-08-09T16:43:14.000Z') {
  const dir = mkdtempSync(join(tmpdir(), 'r4f-g3-after-regression-'))
  dirs.push(dir)
  const commentsPath = join(dir, 'comments.json')
  const oneShotPath = join(dir, 'one-shot.json')
  const resumePath = join(dir, 'resume.json')

  const currentPauseRun = 31322480413
  const currentOneShotRun = 31322760094
  const currentResumeRun = 31322794804
  const currentBefore = 5232434512
  const currentAfter = 5232614780
  const currentDashboardAuth = 5232398886

  const comments = [
    {
      id: currentBefore,
      created_at: '2026-08-09T16:02:06Z',
      user: { login: 'badjoke-lab' },
      body: `/r4f-g3-before dashboard_auth=${currentDashboardAuth} pause_run=${currentPauseRun} project=${PROJECT} captured_at=2026-08-09T16:00:38.320Z invocations=19528 artifact=2f474013b2c590c965dd137da7cf9d3b03ac2e301ca71f6b0211bf551f745106`,
    },
    {
      id: 5232443276,
      created_at: '2026-08-09T16:04:04Z',
      user: { login: 'github-actions[bot]' },
      body: `## R4F G3 isolated window restored before Usage refresh\n\nResume run: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/${currentResumeRun}\nPause run: \`${currentPauseRun}\`\nOne-shot run: \`${currentOneShotRun}\`\nBEFORE capture comment: \`${currentBefore}\`\nProject identity digest: \`${PROJECT}\``,
    },
    {
      id: currentAfter,
      created_at: '2026-08-09T16:45:16Z',
      user: { login: 'badjoke-lab' },
      body: `/r4f-g3-after run=${currentOneShotRun} pause_run=${currentPauseRun} resume_run=${currentResumeRun} before_comment=${currentBefore} project=${PROJECT} captured_at=${afterCapturedAt} invocations=19570 artifact=cee627395fe4f82b0c40670460f730cfec2041ae8843670f1b54801310ee745e`,
    },
  ]
  const oneShotRun = {
    id: currentOneShotRun,
    name: 'R4F G3 One-Shot Probe',
    event: 'issue_comment',
    conclusion: 'success',
    run_started_at: '2026-08-09T16:03:08Z',
    updated_at: '2026-08-09T16:03:28Z',
  }
  const resumeRun = {
    id: currentResumeRun,
    name: 'R4F G3 Isolated Window',
    event: 'issue_comment',
    conclusion: 'success',
    run_started_at: '2026-08-09T16:03:53Z',
    updated_at: '2026-08-09T16:04:07Z',
  }

  writeFileSync(commentsPath, JSON.stringify(comments))
  writeFileSync(oneShotPath, JSON.stringify(oneShotRun))
  writeFileSync(resumePath, JSON.stringify(resumeRun))

  return execFileSync(
    process.execPath,
    [
      'scripts/verify-r4f-g3-after-sequence.mjs',
      '--comments', commentsPath,
      '--one-shot-run', oneShotPath,
      '--resume-run', resumePath,
      '--pause-run-id', String(currentPauseRun),
      '--before-comment-id', String(currentBefore),
      '--after-comment-id', String(currentAfter),
      '--project-digest', PROJECT,
    ],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
}

describe('R4F G3 resume sequence regression', () => {
  it('accepts the real incident ordering where the success locator precedes Actions updated_at cleanup', () => {
    const output = JSON.parse(runVerifier('2026-08-09T15:12:27Z'))
    expect(output.oneShotRun).toBe(ONE_SHOT_RUN)
    expect(output.oneShotWorkflowUpdatedAt).toBe('2026-08-09T15:12:30Z')
    expect(output.oneShotSuccessLocatorAt).toBe('2026-08-09T15:12:27Z')
    expect(output.immediateRestoreAuthorized).toBe(true)
  })

  it('still rejects a resume command that predates the success locator', () => {
    expect(() => runVerifier('2026-08-09T15:12:27Z', '2026-08-09T15:12:20Z')).toThrow()
  })

  it('accepts the fresh AFTER when the successful restore locator precedes mutable Actions updated_at cleanup', () => {
    const output = JSON.parse(runAfterVerifier())
    expect(output.invocationDelta).toBe(42)
    expect(output.usageFresh).toBe(true)
    expect(output.resumeSuccessLocatorAt).toBe('2026-08-09T16:04:04Z')
    expect(output.resumeWorkflowUpdatedAt).toBe('2026-08-09T16:04:07Z')
    expect(output.resumePrecedesAfter).toBe(true)
  })

  it('still rejects an AFTER capture that predates the successful restore locator', () => {
    expect(() => runAfterVerifier('2026-08-09T16:04:03.000Z')).toThrow()
  })
})
