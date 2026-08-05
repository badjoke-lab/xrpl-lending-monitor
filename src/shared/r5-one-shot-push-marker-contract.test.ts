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
const proofMarkerPath =
  'ops/r5/run-once-20260805-twelve-ledger-claim-cap-proof.marker'
const proofMarker = read(proofMarkerPath)
const proofMarkerDigest = createHash('sha256')
  .update(proofMarker)
  .digest('hex')

describe('R5 bounded one-shot push contracts', () => {
  it('keeps the read-only database diagnostic push path exact', () => {
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
  })

  it('allows mutation on push only for the exact twelve-ledger proof marker', () => {
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
      `contains(github.event.head_commit.added, '${proofMarkerPath}')`,
      `contains(github.event.head_commit.modified, '${proofMarkerPath}')`,
    ]) {
      expect(executeCondition).toContain(required)
    }
    expect(executeCondition).not.toContain(
      'contains(github.event.head_commit.removed',
    )
  })

  it('pins the all-schema halt marker bytes and digest exactly', () => {
    expect(marker).toBe(
      'R5_DATABASE_SIZE_DIAGNOSTIC_V2\nmode=read_only\nsource_run_id=30976693948\ndatabase_halt_bytes=400000000\nobserved_database_bytes=417082515\nscope=all_non_temporary_schemas\nnonce=database-size-all-schema-20260805-8b31c6d2\n',
    )
    expect(markerDigest).toBe(
      'a7c79e34daa6c1bdd5b11aca5b03dcdfd32cbc1aaa6717d31dd8f4795886e5d7',
    )
    expect(workflow).toContain(markerDigest)
    expect(adapter).toContain(markerDigest)
  })

  it('pins the twelve-ledger proof marker to the verified source state', () => {
    expect(proofMarker).toBe(
      'R5_TWELVE_LEDGER_CLAIM_CAP_PROOF_V1\nmode=finite_bounded_recovery\nsource_commit=dc9f3fc36e5bf71f4462542fdfa03f135f0a61c6\nsource_verification_run_id=31012179441\nbatch_limit=8\nwall_seconds=900\nexpected_claim_cap=12\nnonce=twelve-ledger-claim-cap-proof-20260805-6db3f1a2\n',
    )
    expect(proofMarkerDigest).toBe(
      'ed3acdcfdbaf52f1f50a67762fc744659e6e2d74c2197e10f26693cb40b7efd3',
    )

    for (const required of [
      proofMarkerPath,
      proofMarkerDigest,
      'test "$R5_RECOVERY_BURST_BATCH_LIMIT" -eq 8',
      'test "$R5_RECOVERY_BURST_WALL_SECONDS" -eq 900',
      'test "$(git rev-parse "${GITHUB_SHA}^")" = dc9f3fc36e5bf71f4462542fdfa03f135f0a61c6',
      "author_login=\"$(gh api \"repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}\" --jq '.author.login')\"",
      'test "$author_login" = badjoke-lab',
    ]) {
      expect(workflow).toContain(required)
    }

    for (const required of [
      proofMarkerPath,
      proofMarkerDigest,
      'dc9f3fc36e5bf71f4462542fdfa03f135f0a61c6',
      'author_login=',
    ]) {
      expect(adapter).toContain(required)
    }
  })

  it('uses only a read-only Management API query and sanitized evidence', () => {
    for (const required of [
      'read_only: true',
      "'r5-all-schema-database-size-read-only-diagnostic'",
      'const sourceSizeRunId = 30976693948',
      'const databaseHaltBytes = 400_000_000',
      'const observedDatabaseBytes = 417_082_515',
      'pg_database_size(current_database())',
      'pg_relation_size(c.oid)',
      'pg_total_relation_size(c.oid)',
      'pg_indexes_size(c.oid)',
      'c.relpersistence <>',
      'c.relisshared = false',
      "n.nspname not like 'pg_temp_%'",
      "n.nspname not like 'pg_toast_temp_%'",
      "const output = 'supabase-r5-database-size-diagnostic'",
      'await writeFile(`${output}/diagnostic.json`',
      'await writeFile(`${output}/diagnostic.md`',
      '## R5 all-schema database-size read-only diagnostic',
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

  it('separates all-schema physical bytes from logical table totals', () => {
    for (const required of [
      'physical_relations',
      'schema_physical_totals',
      'physical_total',
      'top_physical_relations',
      'table_sizes',
      'top_tables',
      'schema_category',
      "'application'",
      "'postgres_system'",
      "'supabase_or_extension'",
      'accountedPhysicalBytes',
      'unaccountedDatabaseBytes',
      'allSchemaBreakdownPresent',
      'applicationSchemasPresent',
      'temporarySchemasExcluded',
      'physicalBytesDoNotExceedDatabase',
      'unaccountedArithmeticExact',
      'Physical bytes by schema',
      'Largest logical tables',
      'Largest physical relations',
    ]) {
      expect(diagnostic).toContain(required)
    }
  })

  it('retains application profile and R5 status evidence', () => {
    for (const required of [
      'public.xrpl_phase_work',
      'public.xrpl_phase_messages',
      'public.xrpl_phase_reference_rows',
      'xrpl_r5_v1.recovery_batches',
      'workCounts',
      'messageCounts',
      'referenceCounts',
      'r5BatchCounts',
      'profileBreakdownPresent',
      'r5BatchBreakdownPresent',
      'publicReaderUnchanged',
      'mainnetDisabled',
      'stabilizationUnauthorized',
      'soakUnauthorized',
    ]) {
      expect(diagnostic).toContain(required)
    }
  })

  it('retains both exact owner-only comment commands', () => {
    for (const required of [
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
      'R5 database-size diagnostic, proof marker, and owner burst contract',
      'R5 bounded one-shot push exception',
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
