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

const sourceMain = '6d183fd933ebd3c24be4e60e39ef6d1e9f113238'
const expectedDigest =
  'e8efad1e1c34360ca2ac93a20a23d2750b0d860a3da0eb3833e8f009df71016c'

describe('R5 pending-scan read-only diagnostic V2 trigger', () => {
  it('pins the failed burst, failed diagnostic, bounded watermark, and marker', () => {
    expect(marker).toBe(
      'R5_PENDING_SCAN_DIAGNOSTIC_V2\nmode=read_only\nsource_main_commit=6d183fd933ebd3c24be4e60e39ef6d1e9f113238\nsource_failed_burst_run_id=31021223140\nsource_failed_diagnostic_run_id=31022568428\nrecovery_run_id=r5-recovery-selected-revision3-entry\nminimum_recovery_watermark_ledger=4138631\nmaximum_recovery_watermark_advance=256\nerror=r5_recovery_batch_pending_scan_invalid\nnonce=r5-pending-scan-readonly-v2-20260806-0147-jst\n',
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

  it('verifies the exact marker, parent, modified path, and author', () => {
    for (const required of [
      'fetch-depth: 2',
      `marker='${markerPath}'`,
      `test "$marker_sha" = ${expectedDigest}`,
      'parent_sha="$(git rev-parse "${GITHUB_SHA}^")"',
      `test "$parent_sha" = ${sourceMain}`,
      'git diff-tree --no-commit-id --name-status',
      "test \"$marker_change\" = $'M\\tops/r5/run-once-20260805-pending-scan-readonly.marker'",
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('retains state and function evidence before fail-closed checks', () => {
    for (const required of [
      'read_only: true',
      "const exactError = 'r5_recovery_batch_pending_scan_invalid'",
      'const minimumWatermark = 4_138_631',
      'const maximumWatermarkAdvance = 256',
      'recoveryWatermarkAtLeastMinimum',
      'recoveryWatermarkWithinDiagnosticBound',
      'pg_get_functiondef(p.oid)',
      'public.xrpl_phase_work',
      'public.xrpl_phase_messages',
      'xrpl_r5_v1.recovery_batches',
      'noncommittedWork',
      'nonterminalMessages',
      'definitionSha256',
      'checkFailures',
      'retainedEvidence = true',
      'Exact function excerpt',
      'supabase-r5-pending-scan-diagnostic',
    ]) {
      expect(diagnostic).toContain(required)
    }

    expect(diagnostic.indexOf('retainedEvidence = true')).toBeLessThan(
      diagnostic.indexOf('if (checkFailures.length > 0)'),
    )

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
      'R5 pending-scan V2 diagnostic and owner burst contract',
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

  it('does not add scheduling, broad write, credentials, or deployment', () => {
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
