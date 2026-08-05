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
const diagnostic = read('scripts/diagnose-supabase-r5-database-size.mjs')
const publisher = read(
  'scripts/publish-supabase-r5-recovery-burst-run-locator.mjs',
)
const marker = read('ops/r5/run-once-20260804-8x900-observable-v2.marker')
const markerDigest = createHash('sha256').update(marker).digest('hex')

describe('R5 database-size read-only diagnostic contract', () => {
  it('binds one exact main push path to the database diagnostic job only', () => {
    for (const required of [
      '  push:',
      '    branches: [main]',
      '      - ops/r5/run-once-20260804-8x900-observable-v2.marker',
      'diagnose-database-size:',
      "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      'Verify exact read-only database-size diagnostic marker',
      'test "$GITHUB_REF" = refs/heads/main',
      'gh api "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}"',
      "--jq '.author.login'",
      'test "$author_login" = badjoke-lab',
      'node scripts/diagnose-supabase-r5-database-size.mjs',
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

  it('pins the database halt marker bytes and digest exactly', () => {
    expect(marker).toBe(
      'R5_DATABASE_SIZE_DIAGNOSTIC_V1\nmode=read_only\nsource_run_id=30975277983\ndatabase_halt_bytes=400000000\nobserved_database_bytes=416763027\nnonce=database-size-20260805-4d9c7a21\n',
    )
    expect(markerDigest).toBe(
      '65d4986fc9efff5360e14f4dd794e6ea19ca848259d1e1f604df3c56340578b8',
    )
    expect(workflow).toContain(markerDigest)
    expect(adapter).toContain(markerDigest)
  })

  it('uses only a read-only Management API query and sanitized evidence', () => {
    for (const required of [
      'read_only: true',
      "'r5-database-size-read-only-diagnostic'",
      'const sourceHeadroomRunId = 30975277983',
      'const databaseHaltBytes = 400_000_000',
      'const observedDatabaseBytes = 416_763_027',
      'pg_database_size(current_database())',
      'pg_total_relation_size(c.oid)',
      'pg_relation_size(c.oid)',
      'pg_indexes_size(c.oid)',
      'pg_catalog.pg_stat_user_tables',
      "n.nspname in ('public', 'xrpl_r5_v1')",
      "const output = 'supabase-r5-database-size-diagnostic'",
      'await writeFile(`${output}/diagnostic.json`',
      'await writeFile(`${output}/diagnostic.md`',
      '## R5 database-size read-only diagnostic',
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
      'functions/v1/xrpl-r5-recovery-batch-trigger',
      'SUPABASE_SERVICE_ROLE_KEY',
    ]) {
      expect(diagnostic.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })

  it('reports relation, dead-row and profile breakdowns separately', () => {
    for (const required of [
      'topRelations',
      'schemaTotals',
      'workCounts',
      'messageCounts',
      'referenceCounts',
      'r5BatchCounts',
      'live_rows',
      'dead_rows',
      'heap_bytes',
      'index_bytes',
      'toast_bytes',
      'public.xrpl_phase_work',
      'public.xrpl_phase_messages',
      'public.xrpl_phase_reference_rows',
      'xrpl_r5_v1.recovery_batches',
      'databaseAtOrAboveHalt',
      'relationBreakdownSorted',
      'allowedSchemasOnly',
      'profileBreakdownPresent',
      'mismatched checks:',
    ]) {
      expect(diagnostic).toContain(required)
    }
  })

  it('retains the original owner-only 8 by 900 mutation command', () => {
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

  it('retains the exact owner-only 64 by 1800 catch-up command', () => {
    for (const required of [
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564' && '64'",
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564' && '1800'",
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -le 64',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -le 1800',
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 64',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 1800',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/nonce-cd7eb564/g)).toHaveLength(3)
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
      'R5 database-size diagnostic and owner burst marker contract',
      "github.event.comment.body == '/r5-recovery burst 64 1800 nonce-cd7eb564'",
      'R5 read-only diagnostic push exception',
      'R5 diagnostic and burst locator count',
      'burst.count("gh issue comment 1175") != 2',
      'bash "$generated_script" "$@"',
    ]) {
      expect(adapter).toContain(required)
    }
  })

  it('retains explicit executor and adoption accounting for later burst runs', () => {
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
