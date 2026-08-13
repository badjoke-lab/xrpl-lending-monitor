import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const driver = readFileSync(
  new URL('../../supabase/functions/xrpl-r5-minute-driver/index.ts', import.meta.url),
  'utf8',
)
const migration = readFileSync(
  new URL('../../supabase/migrations/20260813060000_xrpl_r5_revision4_continuous_head.sql', import.meta.url),
  'utf8',
)

describe('revision-4 one-minute live path contract', () => {
  it('uses two 12-ledger steady batches and a third catch-up batch', () => {
    expect(driver).toContain('const STEADY_BATCHES_PER_MINUTE = 2')
    expect(driver).toContain('const MAX_BATCHES_PER_MINUTE = 3')
    expect(driver).toContain('const BATCH_LEDGER_CAP = 12')
    expect(driver).toContain('head.index - finalWatermark')
  })

  it('refreshes the continuous head before invoking the active R5 executor', () => {
    const refresh = driver.indexOf('await refreshContinuousHead')
    const execute = driver.indexOf('await executeRecoveryBatch')
    expect(refresh).toBeGreaterThan(0)
    expect(execute).toBeGreaterThan(refresh)
    expect(driver).toContain('xrpl_refresh_r5_revision4_continuous_head')
    expect(driver).toContain("source: 'pg_cron'")
    expect(driver).toContain('qualification_override: false')
  })

  it('requires atomic R5 completion before counting a batch', () => {
    expect(driver).toContain('result.completionAcknowledged !== true')
    expect(driver).toContain('result.activeMutationCommitted !== true')
    expect(driver).toContain('publicReaderMutationOnlyThroughR5AtomicCompletion: true')
  })

  it('does not reopen arbitrary R5 halts', () => {
    expect(migration).toContain("v_run.last_error <> 'r5_recovery_monthly_invocation_halt'")
    expect(migration).toContain("'non_invocation_halt_requires_operator'")
    expect(migration).toContain("'provider_snapshot_stale'")
    expect(migration).toContain('v_snapshot_projection >= v_invocation_halt')
    expect(migration).toContain('v_invocation_halt constant bigint := 400000')
  })

  it('keeps revision-4 identity, quiescence, and service-role boundaries', () => {
    expect(migration).toContain('v_run.profile_revision <> 4')
    expect(migration).toContain('39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5')
    expect(migration).toContain("v_runtime.status <> 'stopped'")
    expect(migration).toContain('r5_revision4_continuous_head_batch_lease_active')
    expect(migration).toContain('grant execute on function public.xrpl_refresh_r5_revision4_continuous_head')
    expect(migration).toContain('to service_role;')
  })
})
