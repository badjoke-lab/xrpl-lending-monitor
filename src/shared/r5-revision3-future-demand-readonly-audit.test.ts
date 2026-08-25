import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const audit = readFileSync(
  resolve(process.cwd(), 'scripts/r5-revision3-future-demand-readonly-audit.mjs'),
  'utf8',
)

const steadyEdge = readFileSync(
  resolve(process.cwd(), 'supabase/functions/xrpl-steady-batch-tick/index.ts'),
  'utf8',
)

const steadyMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803030000_xrpl_network_steady_batch.sql'),
  'utf8',
)

const attemptMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260803103000_xrpl_revision3_attempt_lifecycle.sql'),
  'utf8',
)

describe('revision-3 runtime future-demand read-only audit', () => {
  it('covers every mutating rev3 entry point used by the legacy steady path', () => {
    for (const target of [
      'xrpl_prepare_network_steady_session',
      'xrpl_claim_network_steady_tick',
      'xrpl_record_revision3_tick_accounting',
      'xrpl_complete_network_steady_tick',
      'xrpl_begin_revision3_attempt',
      'xrpl_finalize_revision3_attempt',
      'xrpl_qualify_revision3_accounting_transfer',
      'xrpl_restore_revision3_accounting_state',
    ]) {
      expect(audit).toContain(`'${target}'`)
    }

    expect(steadyEdge).toContain("'xrpl_claim_network_steady_tick'")
    expect(steadyEdge).toContain("'xrpl_record_revision3_tick_accounting'")
    expect(steadyEdge).toContain("'xrpl_complete_network_steady_tick'")
    expect(attemptMigration).toContain('public.xrpl_begin_revision3_attempt(')
    expect(attemptMigration).toContain('public.xrpl_finalize_revision3_attempt(')
  })

  it('measures the legacy minute cron instead of assuming it is gone', () => {
    expect(steadyMigration).toContain("'xrpl-lending-monitor-steady-qualification-minute'")
    expect(steadyMigration).toContain("'* * * * *'")
    expect(steadyMigration).toContain('/functions/v1/xrpl-steady-batch-tick')
    expect(audit).toContain("jobname = 'xrpl-lending-monitor-steady-qualification-minute'")
    expect(audit).toContain("command::text ilike '%xrpl-steady-batch-tick%'")
    expect(audit).toContain('activeLegacyCronJobs.length === 0')
  })

  it('requires both direct and recursive service-role execution closure', () => {
    expect(audit).toContain("has_function_privilege('service_role', p.oid, 'EXECUTE')")
    expect(audit).toContain("has_function_privilege('service_role', caller.oid, 'EXECUTE')")
    expect(audit).toContain('executableTargets.length === 0')
    expect(audit).toContain('executableCallers.length === 0')
    expect(audit).toContain('outermostExecutableCallers')
  })

  it('requires no live lease and no open revision-3 attempt', () => {
    expect(audit).toContain("status = 'leased' and lease_expires_at > clock_timestamp()")
    expect(audit).toContain("count(*) filter (where status = 'open') as open")
    expect(audit).toContain('liveLeasedTicks === 0')
    expect(audit).toContain('openAttempts === 0')
  })

  it('keeps restore removal and every mutation unauthorized', () => {
    expect(audit).toContain('restoreSchemaRemovalProvenSafe: false')
    expect(audit).toContain('permissionMutationAuthorized: false')
    expect(audit).toContain('schedulerMutationAuthorized: false')
    expect(audit).toContain('functionRetirementAuthorized: false')
    expect(audit).toContain('restoreReclaimAuthorized: false')
    expect(audit).toContain('schemaMutationAuthorized: false')
    expect(audit).toContain('physicalCompactionAuthorized: false')
    expect(audit).toContain('deploymentAuthorized: false')
    expect(audit).toContain('r5RearmAuthorized: false')
  })

  it('uses only a Management API read-only query', () => {
    expect(audit).toContain('body: JSON.stringify({ query, read_only: true })')
    expect(audit).toContain('MUTATION_CAPABILITY')
    expect(audit).toContain('measurementOnly: true')
  })
})
