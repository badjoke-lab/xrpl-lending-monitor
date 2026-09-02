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
const compiler = read('scripts/compile-current-actions-policy.py')
const generator = read('scripts/generate-actions-policy-r4f-g3-dual.py')
const policyImplementation = `${adapter}\n${compiler}\n${generator}`
const diagnostic = read('scripts/diagnose-supabase-r5-egress-halt-v2.mjs')
const markerPath = 'ops/r5/run-once-20260805-pending-scan-readonly.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')
const sourceMain = '55911f23638fcbf24c157ed2a39235b42d3cef2b'
const expectedDigest =
  '6d2b17c6bd72b1edd2976f149d030dc52f9de59de495a7e8f59726fa61368c4f'
const expectedPolicyDigest =
  '354d4cd5402ff44aa0dd661e036550c66b89ef67c88921a1cad95aebf75fd93c'

describe('R5 egress halt read-only breakdown V2 trigger', () => {
  it('pins the exact halt evidence, failed diagnostic, and fixed thresholds', () => {
    expect(marker).toBe(
      'R5_EGRESS_HALT_BREAKDOWN_DIAGNOSTIC_V2\nmode=read_only\nsource_main_commit=55911f23638fcbf24c157ed2a39235b42d3cef2b\nsource_successful_burst_run_id=31030705329\nsource_failed_burst_run_id=31030990054\nsource_health_diagnostic_run_id=31032129918\nsource_failed_egress_diagnostic_run_id=31033390052\nrecovery_run_id=r5-recovery-selected-revision3-entry\nhalt_error=r5_recovery_monthly_egress_halt\negress_halt_bytes=4294967296\nreservation_bytes=134217728\nattempt_formula=succeeded_finalized_else_reserved\nnonce=r5-egress-halt-breakdown-v2-20260806-0320-jst\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(expectedDigest)
    expect(policyImplementation).toContain(expectedDigest)
  })

  it('binds push only to the read-only V2 diagnostic', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${markerPath}`,
      'diagnose-r5-egress-halt:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'node scripts/diagnose-supabase-r5-egress-halt-v2.mjs',
      'supabase-r5-egress-halt-diagnostic',
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
      `test "$parent_sha" = ${sourceMain}`,
      'git diff-tree --no-commit-id --name-status',
      "test \"$marker_change\" = $'M\\tops/r5/run-once-20260805-pending-scan-readonly.marker'",
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }
  })

  it('recomputes the private function formula explicitly and read only', () => {
    for (const required of [
      'read_only: true',
      'const haltBytes = 4_294_967_296',
      'const reservationBytes = 134_217_728',
      "when a.status = 'succeeded'",
      'a.finalized_egress_upper_bound_bytes',
      'else a.reserved_egress_upper_bound_bytes',
      'xrpl_resource_guard_v2.tick_accounting',
      'xrpl_r5_v1.recovery_batches',
      'Math.max(attemptBytes, legacyBytes)',
      'const priorBytes = steadyBytes + recoveryBytes',
      'const projectedBytes = priorBytes + reservationBytes',
      'claimAllowed: projectedBytes < haltBytes',
      'firstSafeAssumingNoNewContributions',
      'attemptFormula',
      'succeeded_finalized_else_reserved',
      'failedEgressDiagnosticRunId',
      'retained = true',
    ]) {
      expect(diagnostic).toContain(required)
    }
    expect(diagnostic).not.toContain('attempt_effective_egress(')
    expect(diagnostic.indexOf('retained = true')).toBeLessThan(
      diagnostic.indexOf('if (failedChecks.length > 0)'),
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
      '4_294_967_297',
      '134_217_727',
    ]) {
      expect(diagnostic.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('retains only dispatch and exact owner issue mutation paths', () => {
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

  it('adapts the canonical allowlist through the hash-pinned compiler', () => {
    expect(adapter).toContain(
      'python scripts/compile-current-actions-policy.py "$generated_script"',
    )
    expect(compiler).toContain(`EXPECTED_SHA256 = "${expectedPolicyDigest}"`)
    expect(compiler).toContain('generated Actions policy drift:')
    for (const required of [
      'R5 egress halt V2 diagnostic trigger policy',
      'R5 egress halt V2 diagnostic and owner burst contract',
      'R5 read-only egress V2 diagnostic push exception',
      'R5 diagnostic and burst locator count',
      'r5_burst: ["workflow_dispatch", "issue_comment", "push"]',
      'burst.count("gh issue comment 1175") != 2',
      'bash "$generated_script" "$@"',
    ]) {
      expect(policyImplementation).toContain(required)
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
