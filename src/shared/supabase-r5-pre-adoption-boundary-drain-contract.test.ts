import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const drain = read(
  'supabase/migrations/20260803123750_xrpl_r5_pre_adoption_boundary_drain.sql',
)
const adoption = read(
  'supabase/migrations/20260803123800_xrpl_r5_adopt_active_descendants.sql',
)

describe('R5 pre-adoption boundary drain contract', () => {
  it('runs immediately before the existing adoption migration', () => {
    expect('20260803123750').toBeLessThan('20260803123800')
    expect(drain).toContain("run_id = 'r5-recovery-selected-revision3-entry'")
    expect(drain).toContain("status = 'running'")
    expect(adoption).toContain(
      "perform public.xrpl_adopt_r5_committed_active_descendants(\n      'r5-recovery-selected-revision3-entry'",
    )
  })

  it('reuses the qualified boundary drain and permits only existing commit or finalize completion', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary(',
      "'r5-pre-adoption-drain'",
      "v_boundary->>'drainedStepCount'",
      'v_step_count < 0',
      'v_step_count > 256',
      "v_boundary->'checks'->>'collectorQuiescent'",
      "v_boundary->'checks'->>'activeStreamHealthy'",
      "v_boundary->'checks'->>'onlyExistingCommitOrFinalizeDrained'",
      "v_boundary->'checks'->>'noScanExecuted'",
      "v_boundary->'checks'->>'onePendingScan'",
      "v_boundary->'checks'->>'pendingScanBoundToWatermark'",
      "v_boundary->'checks'->>'noInflightWork'",
      "v_boundary->>'sourceProfileId' <> 'supabase-devnet'",
      "v_boundary->>'network' <> 'devnet'",
      "v_boundary->>'epochId' <> 'supabase-r4c2c-v1'",
      'r5_pre_adoption_boundary_drain_invalid',
    ]) {
      expect(drain).toContain(required)
    }
  })

  it('does not execute a scan or mutate recovery accounting itself', () => {
    for (const forbidden of [
      'xrpl_claim_r5_active_recovery_batch',
      'xrpl_complete_r5_active_recovery_batch',
      'update xrpl_r5_v1.recovery_runs',
      'insert into xrpl_r5_v1.recovery_batches',
      'delete from',
      'truncate ',
      'drop table',
      'drop function',
      'mainnet',
    ]) {
      expect(drain.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(drain).toContain(
      "v_boundary->'checks'->>'noScanExecuted'",
    )
  })
})
