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
const diagnostic = read('scripts/diagnose-supabase-r5-health-change.mjs')
const markerPath = 'ops/r5/run-once-20260805-pending-scan-readonly.marker'
const marker = read(markerPath)
const markerDigest = createHash('sha256').update(marker).digest('hex')
const sourceMain = '08ee22ddd1dd1685d59329174264c57e7a0fd8d0'
const expectedDigest =
  'bac45f8f4f8c3c9ddef903c154c01ccce223535235f061190b2ee17fb29177c8'

describe('R5 health-change read-only diagnostic trigger', () => {
  it('pins the successful and failed bounded bursts', () => {
    expect(marker).toBe(
      'R5_HEALTH_CHANGE_DIAGNOSTIC_V1\nmode=read_only\nsource_main_commit=08ee22ddd1dd1685d59329174264c57e7a0fd8d0\nsource_successful_burst_run_id=31030705329\nsource_failed_burst_run_id=31030990054\nrecovery_run_id=r5-recovery-selected-revision3-entry\nerror=R5 recovery identity or health changed\nnonce=r5-health-change-readonly-20260806-0242-jst\n',
    )
    expect(markerDigest).toBe(expectedDigest)
    expect(workflow).toContain(expectedDigest)
    expect(adapter).toContain(expectedDigest)
  })

  it('binds push only to the read-only health diagnostic', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      `      - ${markerPath}`,
      'diagnose-r5-health-change:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'node scripts/diagnose-supabase-r5-health-change.mjs',
      'supabase-r5-health-change-diagnostic',
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

  it('compares every verifier identity and health condition read only', () => {
    for (const required of [
      'read_only: true',
      '31030990054',
      "purpose: 'r5-supabase-active-recovery-summary'",
      "profileId: 'supabase_free_postgres_pgcron_edge'",
      'profileRevision: 3',
      "sourceProfileId: 'supabase-devnet'",
      "network: 'devnet'",
      "epochId: 'supabase-r4c2c-v1'",
      'batchSize: 24',
      'lastError: null',
      'exactRevision3Identity',
      'checkpointDescendantChainProved',
      'lagArithmeticExact',
      'stabilizationAuthorized',
      'soakAuthorized',
      'activeBatches',
      'recentBatches',
      'noncommittedWork',
      'nonterminalMessages',
      'mismatches',
      'recent batch errors:',
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
      'R5 health-change diagnostic trigger policy',
      'R5 health-change diagnostic and owner burst contract',
      'R5 read-only health diagnostic push exception',
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
