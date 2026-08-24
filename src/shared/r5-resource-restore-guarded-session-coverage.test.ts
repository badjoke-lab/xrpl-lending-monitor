import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const preflight = readFileSync(
  resolve(process.cwd(), 'scripts/r5-resource-restore-reclaim-readonly-preflight.mjs'),
  'utf8',
)
const transferMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803105500_xrpl_revision3_transfer_after_attempt_finalization.sql'),
  'utf8',
)

describe('revision-3 restore reclaim guarded-session coverage', () => {
  it('separates guarded and unguarded completed sessions before interpreting missing qualifications', () => {
    expect(preflight).toContain("count(*) filter (where status = 'completed' and resource_guard_enabled)")
    expect(preflight).toContain("count(*) filter (where status = 'completed' and not resource_guard_enabled)")
    expect(preflight).toContain('completed_guarded_with_transfer_qualification')
    expect(preflight).toContain('completed_guarded_without_transfer_qualification')
    expect(preflight).toContain('completed_unguarded_without_transfer_qualification')
    expect(preflight).toContain('not_completed_guarded')
    expect(preflight).toContain('not_completed_unguarded')
  })

  it('checks that durable qualifications map only to completed guarded sessions', () => {
    expect(preflight).toContain('transfer_qualification_coverage as (')
    expect(preflight).toContain('completed_guarded_session')
    expect(preflight).toContain('outside_completed_guarded_session')
    expect(preflight).toContain('without_session')
    expect(preflight).toContain("'allTransferQualificationsBelongToCompletedGuardedSessions'")
  })

  it('keeps future-demand closure and restore-schema removal fail-closed', () => {
    expect(preflight).toContain("'futureRevision3QualificationDemandProvenClosed', false")
    expect(preflight).toContain("'restoreSchemaRemovalProvenSafe', false")
    expect(preflight).toContain("state.reclaimEvidence?.futureRevision3QualificationDemandProvenClosed !== false")
    expect(preflight).toContain("state.reclaimEvidence?.restoreSchemaRemovalProvenSafe !== false")
    expect(preflight).toContain("'restoreReclaimAuthorized', false")
    expect(preflight).toContain("'functionRetirementAuthorized', false")
    expect(preflight).toContain("'schemaMutationAuthorized', false")
    expect(preflight).toContain("'r5RestartAuthorized', false")
  })

  it('preserves the durable reader contract on transfer_qualifications rather than restore rows', () => {
    const readerStart = transferMigration.indexOf('create or replace function public.xrpl_read_revision3_session_accounting(')
    expect(readerStart).toBeGreaterThanOrEqual(0)
    const reader = transferMigration.slice(readerStart)
    expect(reader).toContain('from xrpl_resource_guard_v2.transfer_qualifications')
    expect(reader).not.toContain('from xrpl_resource_restore_v1.targets')
    expect(reader).not.toContain('from xrpl_resource_restore_v1.attempt_rows')
    expect(reader).not.toContain('from xrpl_resource_restore_v1.accounting_rows')
  })

  it('remains Management API read-only measurement', () => {
    expect(preflight).toContain('body: JSON.stringify({ query, read_only: true })')
    expect(preflight).toContain("const MUTATION_CAPABILITY = /\\b(delete|update|insert|alter|drop|truncate|vacuum|create|grant|revoke|refresh|cluster|reindex)\\b/iu")
    expect(preflight).toContain('measurementOnly')
  })
})
