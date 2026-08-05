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
const proofMarkerPath =
  'ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof-v2.marker'
const proofMarker = read(proofMarkerPath)
const proofMarkerDigest = createHash('sha256')
  .update(proofMarker)
  .digest('hex')

const sourceMainCommit = 'cfa3b22686c0ab9bfab6a74d8987ea41b7f66607'
const proofMarkerSha =
  'a06dd69f09694b7553c87676fb05f79dd316f75b78dd66f9029a371ae252947a'

describe('R5 bounded proof v2 push contract', () => {
  it('binds the only push path to the exact proof v2 marker', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${proofMarkerPath}`,
    ]) {
      expect(workflow).toContain(required)
    }

    for (const retired of [
      'ops/r5/run-once-20260804-8x900-observable-v2.marker',
      'ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker',
      'diagnose-database-size:',
      'Read database relation and profile size boundaries',
    ]) {
      expect(workflow).not.toContain(retired)
    }
  })

  it('uses the exact previous main commit and forbids unreliable file-list conditions', () => {
    const executeCondition = workflow.slice(
      workflow.indexOf('  execute-bounded-burst:'),
      workflow.indexOf(
        '    runs-on: ubuntu-latest',
        workflow.indexOf('  execute-bounded-burst:'),
      ),
    )

    for (const required of [
      "github.event_name == 'push'",
      "github.ref == 'refs/heads/main'",
      `github.event.before == '${sourceMainCommit}'`,
    ]) {
      expect(executeCondition).toContain(required)
    }

    for (const forbidden of [
      'github.event.head_commit.added',
      'github.event.head_commit.modified',
      'github.event.head_commit.removed',
    ]) {
      expect(workflow).not.toContain(forbidden)
    }
  })

  it('pins the proof v2 marker bytes, digest, limits, and source runs exactly', () => {
    expect(proofMarker).toBe(
      'R5_TWELVE_LEDGER_CLAIM_CAP_PROOF_V2\nmode=finite_devnet_recovery\nsource_main_commit=cfa3b22686c0ab9bfab6a74d8987ea41b7f66607\nsource_failed_run_id=31013623911\nsource_verified_run_id=31012179441\nbatch_limit=8\nwall_seconds=900\nnonce=twelve-ledger-claim-cap-proof-v2-20260805-2312-jst\n',
    )
    expect(proofMarkerDigest).toBe(proofMarkerSha)

    for (const required of [
      proofMarkerPath,
      proofMarkerSha,
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 8',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 900',
      `test "$parent_sha" = ${sourceMainCommit}`,
      "--jq '.parents[0].sha'",
      "--jq '.author.login'",
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }

    for (const required of [
      proofMarkerPath,
      proofMarkerSha,
      sourceMainCommit,
      'parent_sha=',
      'author_login=',
    ]) {
      expect(adapter).toContain(required)
    }
  })

  it('retains the exact dispatch and owner-only Issue #1175 commands', () => {
    for (const required of [
      "github.event_name == 'workflow_dispatch'",
      'RUN_R5_BOUNDED_BURST',
      "github.event_name == 'issue_comment'",
      'github.event.issue.number == 1175',
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -le 64',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -le 1800',
      'group: r5-bounded-recovery-burst',
      'cancel-in-progress: false',
      'node scripts/run-supabase-r5-recovery-burst-adoption-aware.mjs',
      'gh issue comment 1175',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/nonce-cd7eb564/g)).toHaveLength(3)
    expect(workflow.match(/gh issue comment 1175/g)).toHaveLength(1)
  })

  it('adapts the canonical workflow policy only by exact replacements', () => {
    for (const required of [
      "source_script='scripts/check-actions-workflow-allowlist.sh'",
      'def replace_once(name: str, old: str, new: str) -> None:',
      'count != 1',
      'new in text',
      'old in updated',
      'new not in updated',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'R5 finite proof trigger policy',
      'R5 proof v2 marker and owner burst contract',
      'R5 bounded one-shot push exception',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
    }
    expect(adapter).not.toContain('R5 diagnostic and burst locator count')
  })

  it('retains explicit executor and adoption accounting', () => {
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

  it('does not add scheduled, broad-write, database, deployment, or Mainnet capability', () => {
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
