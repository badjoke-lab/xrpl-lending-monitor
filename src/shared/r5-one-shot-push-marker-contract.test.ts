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
const marker = read('ops/r5/run-once-20260804-8x900.marker')
const markerDigest = createHash('sha256').update(marker).digest('hex')

describe('R5 one-shot push marker contract', () => {
  it('binds one exact main push path to the existing finite workflow', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      '      - ops/r5/run-once-20260804-8x900.marker',
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      "github.actor == 'badjoke-lab'",
      'test "$GITHUB_REF" = refs/heads/main',
      'test "$GITHUB_ACTOR" = badjoke-lab',
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 8',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 900',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('pins the marker bytes and digest exactly', () => {
    expect(marker).toBe(
      'R5_ONE_SHOT_PUSH_MARKER_V1\nbatch_limit=8\nwall_seconds=900\nnonce=push-20260804-8x900-9b7e4c2a\n',
    )
    expect(markerDigest).toBe(
      'de23cd3f4b06e05d6ffbe212719ca604cbaa23ca285b9d4709d5ad259ecc97fa',
    )
    expect(workflow).toContain(markerDigest)
  })

  it('retains the original owner-only issue command and shared concurrency', () => {
    for (const required of [
      "github.event_name == 'issue_comment'",
      'github.event.issue.number == 1175',
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
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
      'R5 one-shot required marker contract',
      'R5 one-shot push exception',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
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
