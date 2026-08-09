import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const runtime = read('src/shared/supabase-revision4-r5-runtime-accounting.ts')
const executor = read('supabase/functions/xrpl-r5-recovery-batch/index.ts')

describe('revision-4 R5 runtime-accounting integration boundary', () => {
  it('contains the directional runtime model and does not weaken the 12-ledger claim cap', () => {
    expect(runtime).toContain('selectedMaximumLedgersPerClaim: 12')
    expect(runtime).toContain("boundaryId: 'xrpl_to_edge_response'")
    expect(runtime).toContain("boundaryId: 'edge_to_xrpl_request'")
    expect(runtime).toContain("boundaryId: 'edge_to_invoker_response'")
  })

  it('wires the R5 executor to revision-4 precommit accounting and removes revision-3 blanket accounting', () => {
    expect(executor).toContain('resolveSupabaseRevision4R5CompletionFixedPoint')
    expect(executor).toContain('SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST')
    expect(executor).toContain("const RECOVERY_RUN_ID = 'r5-recovery-selected-revision4-entry'")
    expect(executor).toContain('XRPL_R5_REVISION4_SELECTION_DIGEST')
    expect(executor).toContain('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')
    expect(executor).toContain('xrpl_claim_r5_revision4_recovery_batch_from_prepared_head')
    expect(executor).toContain('xrpl_complete_r5_revision4_recovery_batch')
    expect(executor).toContain('xrpl_fail_r5_revision4_recovery_batch')
    expect(executor).toContain('COMPLETION_RESPONSE_ACCOUNTING_RESERVE_BYTES = 4 * 1024')
    expect(executor).toContain('COMPLETION_REQUEST_MAX_BYTES = 2 * 1024 * 1024')
    expect(executor).not.toContain('evaluateSupabaseRevision3ResourceAccounting')
    expect(executor).not.toContain('SUPABASE_REVISION3_PROFILE')
    expect(executor).not.toContain('FUNCTION_RESPONSE_RESERVE_BYTES = 128 * 1024')
    expect(executor).not.toContain('COMPLETION_REQUEST_RESERVE_BYTES = 2 * 1024 * 1024')
  })

  it('keeps the executor fail-closed until an explicit revision-4 selection and unexplained-delta reserve exist', () => {
    expect(executor).toContain("env('XRPL_R5_REVISION4_SELECTION_DIGEST')")
    expect(executor).toContain("env('XRPL_R5_REVISION4_UNEXPLAINED_EGRESS_RESERVE_BYTES')")
    expect(executor).toContain(
      'claim.ledgerCount > SUPABASE_REVISION4_R5_RUNTIME_LIMITS.selectedMaximumLedgersPerClaim',
    )
    expect(executor).toContain(
      'projectedEgress31dBytes\n          >= SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes',
    )
  })
})
