import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const ci = read('.github/workflows/ci.yml')
const harness = read(
  'scripts/test-r4f-revision4-directional-persistence-postgres.sh',
)
const sqlBuilder = read(
  'scripts/build-r4f-revision4-persistence-integration-sql.mjs',
)

describe('revision-4 G2D PostgreSQL integration contract', () => {
  it('runs the isolated PostgreSQL harness in normal CI', () => {
    expect(ci).toContain('Verify revision-4 PostgreSQL persistence locally')
    expect(ci).toContain(
      'bash scripts/test-r4f-revision4-directional-persistence-postgres.sh',
    )
    expect(ci).toContain(
      'bash -n scripts/test-r4f-revision4-directional-persistence-postgres.sh',
    )
  })

  it('uses a disposable local PostgreSQL container and no provider credential', () => {
    for (const required of [
      'postgres:15-alpine',
      'docker run --detach --rm',
      'pg_isready',
      'create role anon nologin',
      'create role authenticated nologin',
      'create role service_role nologin',
      'create schema if not exists extensions',
      '20260806120000_xrpl_r4f_revision4_directional_accounting_evidence.sql',
      'postgres-integration.sql',
      'candidate-evidence-export.sql',
    ]) {
      expect(harness.toLowerCase()).toContain(required.toLowerCase())
    }
    expect(harness).toContain(
      'unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_ID SUPABASE_SERVICE_ROLE_KEY SUPABASE_DB_PASSWORD',
    )
    for (const forbidden of [
      'api.supabase.com',
      'supabase.co',
      'database/query',
      'supabase db push',
      'supabase functions deploy',
      'wrangler deploy',
      'gh issue comment',
    ]) {
      expect(harness.toLowerCase()).not.toContain(forbidden)
      expect(sqlBuilder.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('tests writer, replay, reader, conflict, privilege, and export parity', () => {
    for (const required of [
      'first_write_not_new',
      'idempotent_replay_failed',
      'retained_export_parity_failed',
      'reader_reconciliation_failed',
      'observation_identity_conflict',
      'public_role_privilege_leak',
      'postgresIntegrationPassed',
      'recoveryMutationCommitted',
      'publicReaderUnchanged',
      'mainnetDisabled',
      'stabilizationAuthorized',
      'soakAuthorized',
    ]) {
      expect(sqlBuilder).toContain(required)
    }
  })

  it('never invokes active R5 or a provider-side writer', () => {
    for (const forbidden of [
      'r5-recovery-selected-revision3-entry',
      'run-supabase-r5-recovery',
      'xrpl_r5_v1',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_ID',
    ]) {
      expect(sqlBuilder).not.toContain(forbidden)
    }
  })
})
