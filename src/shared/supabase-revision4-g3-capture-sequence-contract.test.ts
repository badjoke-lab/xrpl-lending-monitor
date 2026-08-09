import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const beforeVerifier = resolve(process.cwd(), 'scripts/verify-r4f-g3-before-sequence.mjs')
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
const oneShotRun = 1006
const afterComment = 1007

function comments(afterInvocations = 101) {
  return [
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
      id: afterComment,
      user: { login: 'badjoke-lab' },
      created_at: '2026-08-09T00:09:30Z',
      body: `/r4f-g3-after run=${oneShotRun} pause_run=${pauseRun} before_comment=${beforeComment} project=${projectDigest} captured_at=2026-08-09T00:09:00Z invocations=${afterInvocations} artifact=${afterArtifact}`,
    },
  ]
}

function writeFixture(afterInvocations = 101) {
  const directory = mkdtempSync(join(tmpdir(), 'r4f-g3-sequence-'))
  const commentsPath = join(directory, 'comments.json')
  const pauseRunPath = join(directory, 'pause-run.json')
  const oneShotRunPath = join(directory, 'one-shot-run.json')
  writeFileSync(commentsPath, JSON.stringify(comments(afterInvocations)))
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
  return { commentsPath, pauseRunPath, oneShotRunPath }
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

  it('requires one-shot completion, a fresh Usage invocation count, then AFTER before resume', () => {
    const fixture = writeFixture()
    const result = spawnSync(process.execPath, [
      afterVerifier,
      '--comments', fixture.commentsPath,
      '--one-shot-run', fixture.oneShotRunPath,
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--after-comment-id', String(afterComment),
      '--project-digest', projectDigest,
      '--resume-created-at', '2026-08-09T00:10:00Z',
    ], { encoding: 'utf8' })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      oneShotRun,
      pauseRun,
      beforeCommentId: beforeComment,
      afterCommentId: afterComment,
      beforeInvocations: 100,
      afterInvocations: 101,
      invocationDelta: 1,
      usageFresh: true,
      oneShotPrecedesAfter: true,
      afterPrecedesResume: true,
    })
  })

  it('rejects the observed stale Usage pattern where BEFORE and AFTER invocations are unchanged', () => {
    const fixture = writeFixture(100)
    const result = spawnSync(process.execPath, [
      afterVerifier,
      '--comments', fixture.commentsPath,
      '--one-shot-run', fixture.oneShotRunPath,
      '--pause-run-id', String(pauseRun),
      '--before-comment-id', String(beforeComment),
      '--after-comment-id', String(afterComment),
      '--project-digest', projectDigest,
      '--resume-created-at', '2026-08-09T00:10:00Z',
    ], { encoding: 'utf8' })

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('Supabase Usage is not fresh')
  })
})
