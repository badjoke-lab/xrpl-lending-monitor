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
const diagnostic = read('scripts/diagnose-supabase-r5-watermark-drift.mjs')
const markerPath = 'ops/r5/run-once-20260805-watermark-drift-readonly.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')

const sourceMain = '1926c4c57f447761b6634fbf3900250a1eca0765'
const expectedDigest =
  'caa7720a79dc1dd6b10dceafbd4050d82bb74aa5df0893daafb81e71ede3f3e8'

describe('R5 watermark drift read-only diagnostic trigger', () => {
  it('pins the exact source failure and recovery watermark', () => {
    expect(marker).toBe(
      'R5_WATERMARK_DRIFT_DIAGNOSTIC_V1\nmode=read_only\nsource_main_commit=1926c4c57f447761b6634fbf3900250a1eca0765\nsource_failed_burst_run_id=31014360049\nrecovery_run_id=r5-recovery-selected-revision3-entry\nexpected_recovery_watermark_ledger=4138491\nnonce=r5-watermark-drift-readonly-20260805-2320-jst\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(expectedDigest)
    expect(adapter).toContain(expectedDigest)
  })

  it('binds the only push path to the read-only diagnostic marker', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${markerPath}`,
      'diagnose-watermark-drift:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'Read R5 and physical watermark boundaries',
      'node scripts/diagnose-supabase-r5-watermark-drift.mjs',
    ]) {
      expect(workflow).toContain(required)
    }

    const executeCondition = workflow.slice(
      workflow.indexOf('  execute-bounded-burst:'),
      workflow.indexOf(
        '    runs-on: ubuntu-latest',
        workflow.indexOf('  execute-bounded-burst:'),
      ),
    )
    expect(executeCondition).not.toContain("github.event_name == 'push'")
    expect(workflow).not.toContain(
      'ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker',
    )
  })

  it('verifies the exact marker, parent, diff and repository author', () => {
    for (const required of [
      'fetch-depth: 2',
      'test "$GITHUB_REF" = refs/heads/main',
      `marker='${markerPath}'`,
      `test "$marker_sha" = ${expectedDigest}`,
      'parent_sha="$(git rev-parse "${GITHUB_SHA}^")"',
      `test "$parent_sha" = ${sourceMain}`,
      'git diff-tree --no-commit-id --name-status',
      "test \"$marker_change\" = $'A\\tops/r5/run-once-20260805-watermark-drift-readonly.marker'",
      'author_login="$(gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}"',
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('uses only a Management API read-only query and sanitized evidence', () => {
    for (const required of [
      'read_only: true',
      "'r5-watermark-drift-read-only-diagnostic'",
      'xrpl_r5_v1.recovery_runs',
      'xrpl_r5_v1.recovery_batches',
      'public.xrpl_phase_watermarks',
      'public.xrpl_phase_work',
      'public.xrpl_phase_messages',
      'single_ledger_chain',
      'hash_linked_chain',
      'works_digest',
      'claimCapTwelveInstalled',
      'claimCapTwentyFourAbsent',
      'pg_database_size(current_database())',
      'supabase-r5-watermark-drift-diagnostic',
      'diagnostic.json',
      'diagnostic.md',
    ]) {
      expect(diagnostic).toContain(required)
    }

    for (const forbidden of [
      'insert into',
      'update public.',
      'update xrpl_r5_v1.',
      'delete from',
      'truncate ',
      'vacuum ',
      'supabase secrets set',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) {
      expect(diagnostic.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('retains dispatch and owner-only issue mutation paths', () => {
    for (const required of [
      'workflow_dispatch:',
      'issue_comment:',
      "github.event.issue.number == 1175",
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      'supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN',
      'node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
      'group: r5-bounded-recovery-burst',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('adapts the canonical allowlist by exact replacements', () => {
    for (const required of [
      "source_script='scripts/check-actions-workflow-allowlist.sh'",
      'def replace_once(name: str, old: str, new: str) -> None:',
      'count != 1',
      'new in text',
      'old in updated',
      'new not in updated',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'R5 read-only watermark diagnostic trigger policy',
      'R5 watermark diagnostic and owner burst contract',
      'R5 read-only diagnostic push exception',
      'R5 diagnostic and burst locator count',
      'burst.count("gh issue comment 1175") != 2',
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

  it('does not add scheduling, broad writes, database credentials or deployment', () => {
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
