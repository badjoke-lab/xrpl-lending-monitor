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
const markerPath =
  'ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')

const sourceMain = '62f5183d7058711f97660a6e8b19bcb156ec8a6d'
const expectedDigest =
  '15d9b234d8583e3e1cef2913b3754e6c3c9b8770ba3590b5d25147bbff6d221d'

describe('R5 V5 twelve-ledger one-shot proof trigger', () => {
  it('pins V5 to all prior failures and generated-controller matching', () => {
    expect(marker).toBe(
      'R5_TWELVE_LEDGER_CLAIM_CAP_PROOF_V5\nmode=finite_bounded_recovery\nsource_commit=62f5183d7058711f97660a6e8b19bcb156ec8a6d\nsource_verification_run_id=31012179441\nprior_skipped_run_id=31013623911\nprior_watermark_drift_run_id=31014360049\nprior_preclaim_match_miss_run_id=31015285563\nprior_outer_hook_miss_run_id=31016519593\npreclaim_finalization=required\nmatch_boundary=generated_controller_trigger_error\nbatch_limit=8\nwall_seconds=900\nexpected_claim_cap=12\nnonce=twelve-ledger-claim-cap-proof-20260805-v5-6e1d2f9c\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(markerDigest)
    expect(adapter).toContain(markerDigest)
  })

  it('uses the workflow path filter only to start the proof workflow', () => {
    expect(workflow).toContain('  push:')
    expect(workflow).toContain('    branches: [main]')
    expect(workflow).toContain(`      - ${markerPath}`)
    expect(workflow).not.toContain(
      'ops/r5/run-once-20260804-8x900-observable-v2.marker',
    )
    expect(workflow).not.toContain('diagnose-database-size:')
  })

  it('keeps the mutation boundary in exact runner-side git verification', () => {
    const verifyStart = workflow.indexOf(
      '      - name: Verify exact bounded request and secret bindings',
    )
    const rotationStart = workflow.indexOf(
      '      - name: Rotate one-run R5 recovery verifier token',
    )
    const verification = workflow.slice(verifyStart, rotationStart)

    for (const required of [
      'fetch-depth: 2',
      'test "$GITHUB_REF" = refs/heads/main',
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 8',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 900',
      `marker='${markerPath}'`,
      `test "$marker_sha" = ${markerDigest}`,
      'parent_sha="$(git rev-parse "${GITHUB_SHA}^")"',
      `test "$parent_sha" = ${sourceMain}`,
      'git diff-tree --no-commit-id --name-status',
      "test \"$marker_change\" = $'M\\tops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker'",
      'author_login="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}"',
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }

    expect(verifyStart).toBeGreaterThan(-1)
    expect(rotationStart).toBeGreaterThan(verifyStart)
    expect(verification).not.toContain('supabase secrets set')
    expect(verification).not.toContain(
      'node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
    )
  })

  it('forces the one-shot push to exactly eight batches and 900 seconds', () => {
    for (const required of [
      "github.event_name == 'push' && '8'",
      "github.event_name == 'push' && '900'",
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -le 64',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -le 1800',
      'timeout-minutes: 40',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('retains workflow dispatch and both exact owner-only issue commands', () => {
    for (const required of [
      'workflow_dispatch:',
      'issue_comment:',
      "github.event.issue.number == 1175",
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      'group: r5-bounded-recovery-burst',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('keeps execution and sanitized evidence bounded', () => {
    for (const required of [
      'supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN',
      'node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
      'name: supabase-r5-recovery-burst-evidence',
      'retention-days: 14',
      'node scripts/publish-supabase-r5-recovery-burst-run-locator.mjs',
      'gh issue comment 1175',
    ]) {
      expect(workflow).toContain(required)
    }
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

  it('adapts the canonical workflow policy by exact replacements only', () => {
    for (const required of [
      "source_script='scripts/check-actions-workflow-allowlist.sh'",
      'def replace_once(name: str, old: str, new: str) -> None:',
      'count != 1',
      'new in text',
      'old in updated',
      'new not in updated',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'R5 V5 proof marker and owner burst contract',
      'R5 V5 finite-proof push exception',
      'git diff-tree --no-commit-id --name-status',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
    }
    expect(ci).toContain(
      'run: bash scripts/check-actions-workflow-allowlist-r5-one-shot.sh',
    )
    expect(ci).toContain(
      'bash -n scripts/check-actions-workflow-allowlist-r5-one-shot.sh',
    )
  })

  it('does not add scheduling, broad write, database credentials, or deployment', () => {
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
