import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const script = resolve(process.cwd(), 'scripts/verify-r4f-g3-prepare-proposal.mjs')
const commit = '1'.repeat(40)
const projectDigest = '2'.repeat(64)
const prepareRun = 12345
const ledger = 67890
const dashboardAuth = 70001
const pauseRun = 70002
const beforeComment = 70003
const createdAt = '2026-08-08T12:00:00Z'
const authorizedAt = '2026-08-08T12:05:00Z'
const exactCommand = `/r4f-g3-authorize commit=${commit} ledger=${ledger} project=${projectDigest} prepare_run=${prepareRun} dashboard_auth=${dashboardAuth} pause_run=${pauseRun} before_comment=${beforeComment}`

function proposalBody(overrides: { ledger?: number; command?: string } = {}): string {
  const proposalLedger = overrides.ledger ?? ledger
  const command = overrides.command ?? exactCommand
  return [
    '## R4F G3 one-shot authorization proposal',
    '',
    `Preparation run: \`${prepareRun}\``,
    `Source commit: \`${commit}\``,
    `Project identity digest: \`${projectDigest}\``,
    `Exact Devnet ledger: \`${proposalLedger}\``,
    `Dashboard authorization comment: \`${dashboardAuth}\``,
    `Isolation pause run: \`${pauseRun}\``,
    `BEFORE capture comment: \`${beforeComment}\``,
    '',
    'The dashboard capture authorization and isolated BEFORE marker were verified before this prepare run.',
    '',
    `\`${command}\``,
  ].join('\n')
}

function runVerifier(body: string, runOverrides: Record<string, unknown> = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'r4f-g3-proposal-'))
  const commentsPath = join(directory, 'comments.json')
  const runPath = join(directory, 'run.json')
  writeFileSync(
    commentsPath,
    JSON.stringify([
      {
        id: 999,
        user: { login: 'github-actions[bot]' },
        created_at: '2026-08-08T12:00:30Z',
        body,
      },
    ]),
  )
  writeFileSync(
    runPath,
    JSON.stringify({
      id: prepareRun,
      name: 'R4F G3 One-Shot Probe',
      event: 'issue_comment',
      conclusion: 'success',
      head_sha: commit,
      created_at: createdAt,
      ...runOverrides,
    }),
  )
  return spawnSync(
    process.execPath,
    [
      script,
      '--comments',
      commentsPath,
      '--run',
      runPath,
      '--prepare-run',
      String(prepareRun),
      '--commit',
      commit,
      '--ledger',
      String(ledger),
      '--project-digest',
      projectDigest,
      '--dashboard-auth-comment-id',
      String(dashboardAuth),
      '--pause-run-id',
      String(pauseRun),
      '--before-comment-id',
      String(beforeComment),
      '--authorization-created-at',
      authorizedAt,
    ],
    { encoding: 'utf8' },
  )
}

describe('R4F G3 exact prepare proposal binding', () => {
  it('accepts the exact bot proposal generated for the preauthorized isolated tuple', () => {
    const result = runVerifier(proposalBody())
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      prepareRun,
      prepareProposalCommentId: 999,
      sourceCommit: commit,
      ledger,
      projectIdentityDigest: projectDigest,
      dashboardAuthorizationCommentId: dashboardAuth,
      pauseRun,
      beforeCommentId: beforeComment,
      exactCommandVerified: true,
      preauthorizedBeforeSequenceVerified: true,
    })
  })

  it('rejects a ledger that was not the ledger in the prepare proposal', () => {
    const result = runVerifier(proposalBody({ ledger: ledger + 1 }))
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('expected exactly one matching prepare proposal comment')
  })

  it('rejects a successful run whose source commit differs', () => {
    const result = runVerifier(proposalBody(), { head_sha: '3'.repeat(40) })
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('prepare run commit mismatch')
  })

  it('rejects authorization ordered before the prepare run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'r4f-g3-proposal-order-'))
    const commentsPath = join(directory, 'comments.json')
    const runPath = join(directory, 'run.json')
    writeFileSync(commentsPath, JSON.stringify([]))
    writeFileSync(
      runPath,
      JSON.stringify({
        id: prepareRun,
        name: 'R4F G3 One-Shot Probe',
        event: 'issue_comment',
        conclusion: 'success',
        head_sha: commit,
        created_at: createdAt,
      }),
    )
    const result = spawnSync(
      process.execPath,
      [
        script,
        '--comments', commentsPath,
        '--run', runPath,
        '--prepare-run', String(prepareRun),
        '--commit', commit,
        '--ledger', String(ledger),
        '--project-digest', projectDigest,
        '--dashboard-auth-comment-id', String(dashboardAuth),
        '--pause-run-id', String(pauseRun),
        '--before-comment-id', String(beforeComment),
        '--authorization-created-at', '2026-08-08T11:59:59Z',
      ],
      { encoding: 'utf8' },
    )
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain('authorization predates prepare run')
  })
})
