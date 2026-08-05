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
const diagnostic = read('scripts/diagnose-supabase-r5-pending-scan.mjs')
const markerPath = 'ops/r5/run-once-20260805-pending-scan-readonly.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')

const sourceMain = 'cecd28485c8db64780aed844704690cf3278ed92'
const expectedDigest =
  'aa5d748007c9db9754ec6422e044b564bf86a87edd12624d72b92a4a6e64dfce'

describe('R5 pending-scan read-only diagnostic trigger', () => {
  it('pins the exact failed run, watermark, error, and marker digest', () => {
    expect(marker).toBe(
      'R5_PENDING_SCAN_DIAGNOSTIC_V1\nmode=read_only\nsource_main_commit=cecd28485c8db64780aed844704690cf3278ed92\nsource_failed_burst_run_id=31021223140\nrecovery_run_id=r5-recovery-selected-revision3-entry\nexpected_recovery_watermark_ledger=4138631\nerror=r5_recovery_batch_pending_scan_invalid\nnonce=r5-pending-scan-readonly-20260805-2348-jst\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(expectedDigest)
    expect(adapter).toContain(expectedDigest)
  })

  it('binds push only to the exact read-only diagnostic path', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${markerPath}`,
      'diagnose-pending-scan:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'node scripts/diagnose-supabase-r5-pending-scan.mjs',
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
  })

  it('verifies the exact marker, parent, added path, and repository author', () => {
    for (const required of [
      'fetch-depth: 2',
      `marker='${markerPath}'`,
      `test "$marker_sha" = ${expectedDigest}`,
      'parent_sha="$(git rev-parse "${GITHUB_SHA}^")"',
      `test "$parent_sha" = ${sourceMain}`,
      'git diff-tree --no-commit-id --name-status',
      "test \"$marker_change\" = $'A\\tops/r5/run-once-20260805-pending-scan-readonly.marker'",
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('uses only read-only Management API queries and sanitized output', () => {
    for (const required of [
      'read_only: true',
      "const exactError = 'r5_recovery_batch_pending_scan_invalid'",
      'pg_get_functiondef(p.oid)',
      'public.xrpl_phase_work',
      'public.xrpl_phase_messages',
      'xrpl_r5_v1.recovery_batches',
      'noncommittedWork',
      'nonterminalMessages',
      'exactErrorLocatedOnce',
      'definitionSha256',
      'Exact function excerpt',
      'supabase-r5-pending-scan-diagnostic',
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

  it('retains only dispatch and owner issue mutation paths', () => {
    for (const required of [
      'workflow_dispatch:',
      'issue_comment:',
      "github.event.issue.number == 1175",
      "github.actor == 'badjoke-lab'",
      "github.event.comment.body == '/r5-recovery burst 8 900 nonce-e3378018'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      'supabase secrets set XRPL_R5_RECOVERY_VERIFY_TOKEN',
      'node scripts/run-supabase-r5-recovery-burst-contention-aware.mjs',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('adapts the canonical allowlist by exact replacements', () => {
    for (const required of [
      'R5 pending-scan diagnostic trigger policy',
      'R5 pending-scan diagnostic and owner burst contract',
      'R5 read-only diagnostic push exception',
      'R5 diagnostic and burst locator count',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'burst.count("gh issue comment 1175") != 2',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
    }
    expect(ci).toContain(
      'run: bash scripts/check-actions-workflow-allowlist-r5-one-shot.sh',
    )
  })

  it('does not add scheduled, broad-write, database-credential, or deployment capability', () => {
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
