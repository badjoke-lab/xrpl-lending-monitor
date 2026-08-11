import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const reclaim = read('.github/workflows/supabase-remote-probe.yml')
const g3 = read('.github/workflows/r4f-g3-one-shot-probe.yml')

describe('R4F G3 workflow safety boundary', () => {
  it('keeps the former remote probe restricted to the separately authorized steady reclaim path', () => {
    expect(reclaim).toContain('name: R4F Steady Qualification Reclaim')
    expect(reclaim).toContain('issue_comment:')
    expect(reclaim).not.toContain('\n  push:')
    expect(reclaim).not.toContain('\n  schedule:')
    expect(reclaim).not.toContain('workflow_dispatch:')
    expect(reclaim).toContain('github.event.issue.number == 1261')
    expect(reclaim).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(reclaim).toContain("github.event.comment.body == '/r4f-steady-reclaim-prepare'")
    expect(reclaim).toContain("startsWith(github.event.comment.body, '/r4f-steady-reclaim-authorize ')")
    expect(reclaim).toContain("MIGRATION_VERSION: '20260811012000'")
    expect(reclaim).toContain('supabase_migrations.schema_migrations')
    expect(reclaim).toContain('read_only:true')
    expect(reclaim).toContain("expected_tail='20260809151000 20260810123000 20260810133000 20260811012000'")
    expect(reclaim).toContain('Unexpected remote migration history for bounded reclaim')
    expect(reclaim).toContain('supabase db push --linked --dry-run')
    expect(reclaim).not.toContain('supabase db push --linked --yes')
    expect(reclaim).not.toContain('supabase migration repair')
    expect(reclaim).toContain('rest/v1/rpc/xrpl_preview_steady_qualification_reclaim')
    expect(reclaim).toContain('rest/v1/rpc/xrpl_execute_steady_qualification_reclaim')
    expect(reclaim.match(/rest\/v1\/rpc\/xrpl_execute_steady_qualification_reclaim/g)).toHaveLength(1)
    expect(reclaim).not.toContain('supabase functions deploy')
    expect(reclaim).not.toContain('xrpl-r5-recovery-batch')
    expect(reclaim).not.toContain('/r4f-g3-')
  })

  it('allows G3 preparation and execution only from exact owner comments on Issue 1261', () => {
    expect(g3).toContain('issue_comment:')
    expect(g3).toContain('github.event.issue.number == 1261')
    expect(g3).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(g3).toContain("startsWith(github.event.comment.body, '/r4f-g3-prepare ')")
    expect(g3).toContain('dashboard_auth=([0-9]+) pause_run=([0-9]+) before_comment=([0-9]+)')
    expect(g3).toContain('verify-r4f-g3-before-sequence.mjs')
    expect(g3).toContain("startsWith(github.event.comment.body, '/r4f-g3-authorize ')")
    expect(g3).toContain("regex='^/r4f-g3-authorize commit=")
  })

  it('keeps the one-shot execution free of database and R5 recovery operations', () => {
    for (const forbidden of [
      'supabase link ',
      'supabase db push',
      'SUPABASE_DB_PASSWORD',
      'xrpl-r5-recovery-batch',
      'xrpl-r5-recovery-batch-trigger',
      'verify-supabase-r5',
      'PRODUCTION',
    ]) {
      expect(g3).not.toContain(forbidden)
    }
    expect(g3).toContain('supabase functions deploy xrpl-r4f-g3-directional-probe')
    expect(g3).toContain('supabase functions delete xrpl-r4f-g3-directional-probe')
    expect(g3).toContain('supabase secrets unset R4F_G3_PROBE_VERIFY_TOKEN R4F_G3_PROBE_SOURCE_COMMIT')
  })

  it('binds execution to exact commit, project digest, prepare run, ledger, dashboard auth, pause, and BEFORE marker', () => {
    for (const required of [
      'test "$commit" = "$(git rev-parse HEAD)"',
      'test "$project_digest" = "$actual_project_digest"',
      'ledger=([0-9]+)',
      'project=([a-f0-9]{64})',
      'prepare_run=([0-9]+)',
      'dashboard_auth=([0-9]+)',
      'pause_run=([0-9]+)',
      'before_comment=([0-9]+)',
      'AUTHORIZATION_CREATED_AT: ${{ github.event.comment.created_at }}',
      'gh api --paginate',
      'scripts/verify-r4f-g3-before-sequence.mjs',
      'scripts/verify-r4f-g3-prepare-proposal.mjs',
      '--dashboard-auth-comment-id "$dashboard_auth"',
      '--pause-run-id "$pause_run"',
      '--before-comment-id "$before_comment"',
      '--authorization-created-at "$AUTHORIZATION_CREATED_AT"',
    ]) {
      expect(g3).toContain(required)
    }
  })

  it('emits immediate resume first, then validates a fresh AFTER before provider log capture', () => {
    expect(g3).toContain('immediate resume command')
    expect(g3).toContain('/r4f-g3-isolation-resume project=${PROJECT_DIGEST}')
    expect(g3).toContain('one_shot_run=${GITHUB_RUN_ID} before_comment=${BEFORE_COMMENT}')
    expect(g3).not.toContain('after_comment=<AFTER_COMMENT_ID>')
    expect(g3).toContain('\n  after_validate:')
    expect(g3).toContain("startsWith(github.event.comment.body, '/r4f-g3-after ')")
    expect(g3).toContain('resume_run=([0-9]+)')
    expect(g3).toContain('verify-r4f-g3-after-sequence.mjs')
    expect(g3).toContain('/r4f-g3-capture-logs run=${ONE_SHOT_RUN} resume_run=${RESUME_RUN} pause_run=${PAUSE_RUN}')
    expect(g3).toContain('after_comment=${AFTER_COMMENT}')
    expect(g3).toContain("startsWith(github.event.comment.body, '/r4f-g3-capture-logs ')")
  })
})
