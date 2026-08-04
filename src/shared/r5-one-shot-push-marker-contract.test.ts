import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const workflow = read('.github/workflows/r5-bounded-recovery-burst.yml')
const ci = read('.github/workflows/ci.yml')
const adapter = read('scripts/check-actions-workflow-allowlist-r5-one-shot.sh')
const publisher = read(
  'scripts/publish-supabase-r5-recovery-burst-run-locator.mjs',
)
const marker = read('ops/r5/run-once-20260804-8x900-observable-v2.marker')
const markerDigest = createHash('sha256').update(marker).digest('hex')

describe('R5 observable one-shot push marker contract', () => {
  it('binds one exact main push path to the existing finite workflow', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      '      - ops/r5/run-once-20260804-8x900-observable-v2.marker',
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      'test "$GITHUB_REF" = refs/heads/main',
      'gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}"',
      "--jq '.author.login'",
      'test "$author_login" = badjoke-lab',
      "github.event_name == 'push' && '64'",
      "github.event_name == 'push' && '1800'",
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 64',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 1800',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('pins the finite scale marker bytes and digest exactly', () => {
    expect(marker).toBe(
      'R5_ONE_SHOT_PUSH_MARKER_V5\nbatch_limit=64\nwall_seconds=1800\nnonce=push-20260804-64x1800-scale-51d9c7b2\n',
    )
    expect(markerDigest).toBe(
      'd5c1f9a2c75e43438308d3972f22a7665e075857906310e4d892554b7dc353f0',
    )
    expect(workflow).toContain(markerDigest)
  })

  it('publishes a sanitized start locator before token rotation and mutation', () => {
    const startIndex = workflow.indexOf(
      '- name: Publish bounded R5 burst start locator',
    )
    const tokenIndex = workflow.indexOf(
      '- name: Rotate one-run R5 recovery verifier token',
    )
    const executeIndex = workflow.indexOf(
      '- name: Execute and verify one finite R5 recovery burst',
    )

    expect(startIndex).toBeGreaterThan(-1)
    expect(tokenIndex).toBeGreaterThan(startIndex)
    expect(executeIndex).toBeGreaterThan(tokenIndex)

    for (const required of [
      'gh issue comment 1175',
      'R5 bounded active recovery burst start',
      'mutation started: `false`',
      'public reader unchanged: `true`',
      'Mainnet disabled: `true`',
      'stabilization authorized: `false`',
      'soak authorized: `false`',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/gh issue comment 1175/g)).toHaveLength(2)
  })

  it('retains the original owner-only 8 by 900 issue command', () => {
    for (const required of [
      "github.event_name == 'issue_comment'",
      'github.event.issue.number == 1175',
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
      "github.event_name == 'issue_comment' && '8'",
      "github.event_name == 'issue_comment' && '900'",
      'group: r5-bounded-recovery-burst',
      'cancel-in-progress: false',
      'timeout-minutes: 40',
      'node scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('adapts the workflow policy only through exact one-occurrence replacements', () => {
    for (const required of [
      "source_script='scripts/check-actions-workflow-allowlist.sh'",
      'def replace_once(name: str, old: str, new: str) -> None:',
      'count != 1',
      'new in text',
      'old in updated',
      'new not in updated',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'R5 observable one-shot required marker contract',
      'R5 observable one-shot push exception',
      'R5 observable start and final locator count',
      'burst.count("gh issue comment 1175") != 2',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
    }
  })

  it('publishes executor and materialized-row accounting separately', () => {
    for (const required of [
      'requested executor batch limit:',
      'executed recovery batches:',
      'materialized batch rows:',
      'adoption materialized rows:',
      'adoption rows excluded from executor budget:',
    ]) {
      expect(publisher).toContain(required)
    }
  })

  it('runs the adapted policy and validates its shell syntax in CI', () => {
    expect(ci).toContain(
      'run: bash scripts/check-actions-workflow-allowlist-r5-one-shot.sh',
    )
    expect(ci).toContain(
      'bash -n scripts/check-actions-workflow-allowlist-r5-one-shot.sh',
    )
  })

  it('does not add scheduled, broad-write or deployment capability', () => {
    for (const forbidden of [
      '  schedule:',
      'pull_request_target',
      'contents: write',
      'SUPABASE_DB_PASSWORD',
      'SUPABASE_SERVICE_ROLE_KEY',
      'supabase db',
      'supabase functions deploy',
      'wrangler deploy',
      "MAINNET_ENABLED: 'true'",
    ]) {
      expect(workflow).not.toContain(forbidden)
    }
  })
})
