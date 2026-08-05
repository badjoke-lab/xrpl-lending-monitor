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
const diagnostic = read('scripts/diagnose-supabase-r5-egress-halt.mjs')
const markerPath = 'ops/r5/run-once-20260805-pending-scan-readonly.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')
const sourceMain = '45cbfa09399a7d6d5c5d348ab9f3c6d6ee24fc9b'
const expectedDigest =
  '91ad7af532a7cb66d214b30a3d9a3d2faa48e49b46a9d1b96c6808e2400c2c7f'

describe('R5 egress halt read-only breakdown trigger', () => {
  it('pins the exact halt evidence and fixed thresholds', () => {
    expect(marker).toBe(
      'R5_EGRESS_HALT_BREAKDOWN_DIAGNOSTIC_V1\nmode=read_only\nsource_main_commit=45cbfa09399a7d6d5c5d348ab9f3c6d6ee24fc9b\nsource_successful_burst_run_id=31030705329\nsource_failed_burst_run_id=31030990054\nsource_health_diagnostic_run_id=31032129918\nrecovery_run_id=r5-recovery-selected-revision3-entry\nhalt_error=r5_recovery_monthly_egress_halt\negress_halt_bytes=4294967296\nreservation_bytes=134217728\nnonce=r5-egress-halt-breakdown-20260806-0300-jst\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(expectedDigest)
    expect(adapter).toContain(expectedDigest)
  })

  it('binds push only to the read-only egress diagnostic', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${markerPath}`,
      'diagnose-r5-egress-halt:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'node scripts/diagnose-supabase-r5-egress-halt.mjs',
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

  it('recomputes the exact 31-day conservative formula and rolloff read only', () => {
    for (const required of [
      'read_only: true',
      'const haltBytes = 4_294_967_296',
      'const reservationBytes = 134_217_728',
      'attempt_effective_egress(',
      'xrpl_resource_guard_v2.tick_accounting',
      'xrpl_r5_v1.recovery_batches',
      'Math.max(attemptBytes, legacyBytes)',
      'const priorBytes = steadyBytes + recoveryBytes',
      'const projectedBytes = priorBytes + reservationBytes',
      'claimAllowed: projectedBytes < haltBytes',
      'firstSafeAssumingNoNewContributions',
      'failedOrDeferredAttemptCount',
      'noncompletedRecoveryCount',
      'strictClaimCondition',
      'r5_recovery_monthly_egress_halt',
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

  it('adapts the canonical allowlist by exact replacements', () => {
    for (const required of [
      'R5 egress halt diagnostic trigger policy',
      'R5 egress halt diagnostic and owner burst contract',
      'R5 read-only egress diagnostic push exception',
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
