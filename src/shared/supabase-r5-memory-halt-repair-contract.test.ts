import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const repair = read(
  'supabase/migrations/20260805024500_xrpl_r5_repair_memory_halt_descendants.sql',
)

describe('R5 memory-halt descendant repair contract', () => {
  it('binds the repair to the exact read-only diagnostic and failed batch', () => {
    for (const required of [
      '30969285686',
      '30966882019',
      '7c755902c95873dc94939eff90dd9f8d019ff855',
      "'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000238'",
      "'revision3_resource_halt:memory_upper_bound_halt'",
      'v_run.completed_batches <> 237',
      'v_run.committed_ledgers <> 5030',
      'v_run.current_watermark_ledger_index <> 4138337',
      'v_batch.batch_sequence <> 238',
      'v_batch.start_ledger_index <> 4138338',
      'v_batch.end_ledger_index <> 4138361',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('drains only existing commit or finalize work and never scans', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary(',
      "'r5-memory-halt-descendant-repair'",
      'v_boundary_step_count < 0',
      'v_boundary_step_count > 256',
      "v_boundary->'checks'->>'collectorQuiescent'",
      "v_boundary->'checks'->>'activeStreamHealthy'",
      "v_boundary->'checks'->>'onlyExistingCommitOrFinalizeDrained'",
      "v_boundary->'checks'->>'noScanExecuted'",
      "v_boundary->'checks'->>'onePendingScan'",
      "v_boundary->'checks'->>'pendingScanBoundToWatermark'",
      "v_boundary->'checks'->>'noInflightWork'",
      'v_boundary_after_index > v_boundary_before_index + 1',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('preserves the diagnostic physical ledger as an immutable anchor', () => {
    for (const required of [
      'work.start_ledger_index = 4138354',
      '3D71549DEE5A07C5A550245E766DE1F1420317B3F5689ABE8EDDA605B897599B',
      '5F825698A1A091BE177C5CD7FCDC3B32AA1B3E66E578B8193B5D5E7283FC6EC9',
      'v_diagnostic_hash <> v_diagnostic_physical_hash',
      'v_diagnostic_work_id <> v_diagnostic_physical_work',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('repairs only the committed prefix of the failed twenty-four-ledger range', () => {
    for (const required of [
      'v_repaired_batch_end := least(v_watermark.ledger_index, 4138361)',
      'v_repaired_batch_ledger_count < 17',
      'v_repaired_batch_ledger_count > 24',
      'work.start_ledger_index between 4138338 and v_repaired_batch_end',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_work_count <> v_repaired_batch_ledger_count',
      "'payloadDigest', chain.payload_digest",
      "'valueJson', rows.value_json",
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('shrinks batch 238 to proven committed work and retains the full failed reservation', () => {
    for (const required of [
      "set status = 'completed'",
      "origin = 'adopted_active_descendant'",
      'end_ledger_index = v_repaired_batch_end',
      'ledger_count = v_repaired_batch_ledger_count',
      'finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes',
      'failure_reservation_retained = true',
      'completed_batches = completed_batches + 1',
      'committed_ledgers = committed_ledgers + v_repaired_batch_ledger_count',
      'adopted_batches = adopted_batches + 1',
      'adopted_ledgers = adopted_ledgers + v_repaired_batch_ledger_count',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('delegates only later committed descendants to the qualified adopter', () => {
    const runUpdate = repair.indexOf(
      "update xrpl_r5_v1.recovery_runs\n  set status = 'running'",
    )
    const remainingAdoption = repair.indexOf(
      'public.xrpl_adopt_r5_committed_active_descendants(',
      runUpdate,
    )
    expect(runUpdate).toBeGreaterThanOrEqual(0)
    expect(remainingAdoption).toBeGreaterThan(runUpdate)

    for (const required of [
      'v_remaining_ledger_count := v_watermark.ledger_index - v_repaired_batch_end',
      "v_remaining_adoption->>'reason' <> 'active_boundary_already_equal'",
      "(v_remaining_adoption->>'startLedgerIndex')::bigint",
      '<> v_repaired_batch_end + 1',
      "(v_remaining_adoption->>'firstBatchSequence')::bigint <> 239",
      "(v_remaining_adoption->>'adoptedBatchCount')::bigint",
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('requires exact final arithmetic and no halted batch', () => {
    for (const required of [
      'v_run.completed_batches <> 238 + v_expected_remaining_batches',
      'v_watermark.ledger_index - v_run.start_watermark_ledger_index',
      'v_completed_batch_count <> v_run.completed_batches',
      'v_halted_batch_count <> 0',
      'v_last_completed_end <> v_watermark.ledger_index',
      'insert into xrpl_r5_v1.memory_halt_descendant_repairs',
      'v_prior_batch, v_boundary',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('does not weaken the memory, public-reader, Mainnet, stabilization or soak boundaries', () => {
    for (const required of [
      "'failureReservationRetained', true",
      "'additionalRecoveryEgressUpperBoundBytes', 0",
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
      'from public, anon, authenticated',
      'to service_role',
    ]) {
      expect(repair).toContain(required)
    }

    for (const forbidden of [
      'delete from',
      'truncate ',
      'drop table',
      'drop function',
      'drop schema',
      'drop type',
      'drop owned',
      'memory_halt_bytes',
      'memory_upper_bound_bytes',
      'batch_size =',
      "'mainnetEnabled', true",
      "'stabilizationAuthorized', true",
      "'soakAuthorized', true",
    ]) {
      expect(repair.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
