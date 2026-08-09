import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const beforeVerifier = resolve(process.cwd(), 'scripts/verify-r4f-g3-before-sequence.mjs')
const resumeVerifier = resolve(process.cwd(), 'scripts/verify-r4f-g3-resume-sequence.mjs')
const afterVerifier = resolve(process.cwd(), 'scripts/verify-r4f-g3-after-sequence.mjs')
const commit = '1'.repeat(40)
const projectDigest = '2'.repeat(64)
const commandDigest = '3'.repeat(64)
const beforeArtifact = '4'.repeat(64)
const afterArtifact = '5'.repeat(64)
const isolationPrepareRun = 1001
const dashboardAuth = 1002
const pauseAuthorization = 1003
const pauseRun = 1004
const beforeComment = 1005
const oneShotAuthorization = 1006
const oneShotRun = 1007
const resumeRun = 1008
const afterComment = 1009
const oneShotLocator = 2001
const resumeLocator = 2002

function comments(afterInvocations = 101, includeAfter = true) {
  const values: Array<Record<string, unknown>> = [
    {
      id: dashboardAuth,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:01:00Z',
      body: `/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=${commit} project=${projectDigest} job=1 command=${commandDigest} prepare_run=${isolationPrepareRun}`,
    },
    {
      id: pauseAuthorization,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:02:00Z',
      body: `/r4f-g3-isolation-pause commit=${commit} project=${projectDigest} job=1 command=${commandDigest} prepare_run=${isolationPrepareRun} dashboard_auth=${dashboardAuth}`,
    },
    {
      id: beforeComment,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:05:30Z',
      body: `/r4f-g3-before dashboard_auth=${dashboardAuth} pause_run=${pauseRun} project=${projectDigest} captured_at=2026-08-09T00:05:00Z invocations=100 artifact=${beforeArtifact}`,
    },
    {
      id: oneShotAuthorization,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:06:30Z',
      body: `/r4f-g3-authorize commit=${commit} ledger=67890 project=${projectDigest} prepare_run=1100 dashboard_auth=${dashboardAuth} pause_run=${pauseRun} before_comment=${beforeComment}`,
    },
    {
      id: oneShotLocator,
      user: { login: 'github-actions[bot]' },
      created_at: '2026-08-09T00:08:40Z',
      body: [
        '## R4F G3 one-shot probe run',
        '',
        `Run: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/${oneShotRun}`,
        'Status: `success`',
        `Authorization comment: \`${oneShotAuthorization}\``,
        `Source commit: \`${commit}\``,
        'Devnet ledger: `67890`',
        `Project identity digest: \`${projectDigest}\``,
        `Pause run: \`${pauseRun}\``,
        `BEFORE capture comment: \`${beforeComment}\``,
      ].join('\n'),
    },
    {
      id: resumeLocator,
      user: { login: 'github-actions[bot]' },
      created_at: '2026-08-09T00:09:40Z',
      body: [
        '## R4F G3 isolated window restored before Usage refresh',
        '',
        `Resume run: https://github.com/badjoke-lab/xrpl-lending-monitor/actions/runs/${resumeRun}`,
        `Pause run: \`${pauseRun}\``,
        `One-shot run: \`${oneShotRun}\``,
        `BEFORE capture comment: \`${beforeComment}\``,
        `Project identity digest: \`${projectDigest}\``,
        `Scheduler command digest: \`${commandDigest}\``,
      ].join('\n'),
    },
  ]
  if (includeAfter) {
    values.push({
      id: afterComment,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:20:30Z',
      body: `/r4f-g3-after run=${oneShotRun} pause_run=${pauseRun} resume_run=${resumeRun} before_comment=${beforeComment} project=${projectDigest} captured_at=2026-08-09T00:20:00Z invocations=${afterInvocations} artifact=${afterArtifact}`,
    })
  }
  return values
}

function writeFixture(afterInvocations = 101, includeAfter = true) {
  const directory = mkdtempSync(join(tmpdir(), 'r4f-g3-sequence-'))
  const commentsPath = join(directory, 'comments.json')
  const pauseRunPath = join(directory, 'pause-run.json')
  const oneShotRunPath = join(directory, 'one-shot-run.json')
  const resumeRunPath = join(directory, 'resume-run.json')
  writeFileSync(commentsPath, JSON.stringify(comments(afterInvocations, includeAfter)))
  writeFileSync(pauseRunPath, JSON.stringify({
    id: pauseRun,
    name: 'R4F G3 Isolated Window',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: commit,
    created_at: '2026-08-09T00:02:10Z',
    updated_at: '2026-08-09T00:04:30Z',
  }))
  writeFileSync(oneShotRunPath, JSON.stringify({
    id: oneShotRun,
    name: 'R4F G3 One-Shot Probe',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: commit,
    created_at: '2026-08-09T00:07:00Z',
    run_started_at: '2026-08-09T00:07:10Z',
    updated_at: '2026-08-09T00:08:30Z',
  }))
  writeFileSync(resumeRunPath, JSON.stringify({
    id: resumeRun,
    name: 'R4F G3 Isolated Window',
    event: 'issue_comment',
    conclusion: 'success',
    head_sha: commit,
    created_at: '2026-08-09T00:09:00Z',
    run_started_at: '2026-08-09T00:09:05Z',
    updated_at: '2026-08-09T00:09:30Z',
  }))
  return { commentsPath, pauseRunPath, oneShotRunPath, resumeRunPath }
}

describe('R4F G3 capture sequence', () => {
  it('requires dashboard authorization before pause and BEFORE before one-shot prepare', () => {
    const fixture = writeFixture()
    const result = spawnSync(process.execPath, [
      beforeVerifier,
      '--comments', fixture.commentsPath,
      '--pause-run', fixture.pauseRunPath,
      '--dashboard-auth-comment-id', String(dashboardAuth),
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--project-digest', projectDigest,
      '--prepare-created-at', '2026-08-09T00:06:00Z',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceCommit: commit,
      schedulerJobId: 1,
      schedulerCommandDigest: commandDigest,
      dashboardAuthorizationCommentId: dashboardAuth,
      pauseRun,
      beforeCommentId: beforeComment,
      beforeInvocations: 100,
      dashboardAuthorizationPrecedesPause: true,
      pausePrecedesBefore: true,
      beforePrecedesOneShotPrepare: true,
    })
  })

  it('authorizes immediate collector restoration after successful one-shot without waiting for AFTER', () => {
    const fixture = writeFixture(101, false)
    const result = spawnSync(process.execPath, [
      resumeVerifier,
      '--comments', fixture.commentsPath,
      '--pause-run', fixture.pauseRunPath,
      '--one-shot-run', fixture.oneShotRunPath,
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--project-digest', projectDigest,
      '--job-id', '1',
      '--command-digest', commandDigest,
      '--resume-created-at', '2026-08-09T00:09:00Z',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      sourceCommit: commit,
      schedulerJobId: 1,
      schedulerCommandDigest: commandDigest,
      pauseRun,
      beforeCommentId: beforeComment,
      oneShotRun,
      oneShotAuthorizationCommentId: oneShotAuthorization,
      oneShotSucceededBeforeResume: true,
      immediateRestoreAuthorized: true,
    })
  })

  it('requires successful resume before accepting a fresh Usage AFTER count', () => {
    const fixture = writeFixture()
    const result = spawnSync(process.execPath, [
      afterVerifier,
      '--comments', fixture.commentsPath,
      '--one-shot-run', fixture.oneShotRunPath,
      '--resume-run', fixture.resumeRunPath,
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--after-comment-id', String(afterComment),
      '--project-digest', projectDigest,
    ], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      oneShotRun,
      pauseRun,
      resumeRun,
      beforeCommentId: beforeComment,
      afterCommentId: afterComment,
      beforeInvocations: 100,
      afterInvocations: 101,
      invocationDelta: 1,
      usageFresh: true,
      oneShotPrecedesResume: true,
      resumePrecedesAfter: true,
    })
  })

  it('rejects the observed stale Usage pattern where BEFORE and AFTER invocations are unchanged', () => {
    const fixture = writeFixture(100)
    const result = spawnSync(process.execPath, [
      afterVerifier,
      '--comments', fixture.commentsPath,
      '--one-shot-run', fixture.oneShotRunPath,
      '--resume-run', fixture.resumeRunPath,
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--after-comment-id', String(afterComment),
      '--project-digest', projectDigest,
    ], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Supabase Usage is not fresh')
  })
})
