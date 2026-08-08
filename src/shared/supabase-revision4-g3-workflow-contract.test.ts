import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const legacy = read('.github/workflows/supabase-remote-probe.yml')
const g3 = read('.github/workflows/r4f-g3-one-shot-probe.yml')

describe('R4F G3 workflow safety boundary', () => {
  it('removes automatic push execution from the legacy mutation-capable remote probe', () => {
    expect(legacy).toContain('workflow_dispatch:')
    expect(legacy).not.toContain('\n  push:')
    expect(legacy).toContain('Legacy Supabase remote probe is halted')
    expect(legacy).not.toContain('supabase db push')
    expect(legacy).not.toContain('xrpl-r5-recovery-batch')
  })

  it('allows G3 preparation and execution only from exact owner comments on Issue 1261', () => {
    expect(g3).toContain('issue_comment:')
    expect(g3).toContain("github.event.issue.number == 1261")
    expect(g3).toContain("github.event.comment.user.login == 'badjoke-lab'")
    expect(g3).toContain("github.event.comment.body == '/r4f-g3-prepare'")
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

  it('binds execution to exact commit, project digest, prepare run, and ledger proposal', () => {
    for (const required of [
      'test "$commit" = "$(git rev-parse HEAD)"',
      'test "$project_digest" = "$actual_project_digest"',
      'ledger=([0-9]+)',
      'project=([a-f0-9]{64})',
      'prepare_run=([0-9]+)',
      'AUTHORIZATION_CREATED_AT: ${{ github.event.comment.created_at }}',
      'gh api --paginate',
      'scripts/verify-r4f-g3-prepare-proposal.mjs',
      '--authorization-created-at "$AUTHORIZATION_CREATED_AT"',
    ]) {
      expect(g3).toContain(required)
    }
  })
})
