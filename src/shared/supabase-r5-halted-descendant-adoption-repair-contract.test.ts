import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260804143500_xrpl_r5_repair_halted_descendant_adoption.sql',
)

describe('R5 halted descendant adoption repair contract', () => {
  it('binds the repair to the exact read-only diagnostic state', () => {
    for (const required of [
      '30918725807',
      'bfa69a4aba02ae718b6af394fa1997d90b8e5186',
      "'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087'",
      'v_run.completed_batches <> 86',
      'v_run.committed_ledgers <> 1805',
      'v_run.current_watermark_ledger_index <> 4135112',
      'v_watermark.ledger_index <> 4135151',
      "'r5_recovery_batch_completion_pending_scan_invalid'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains the failed reservation while allowing only this adopted batch exception', () => {
    for (const required of [
      'failure_reservation_retained boolean not null default false',
      'xrpl_r5_recovery_batch_finalized_egress',
      'failure_reservation_retained is false',
      'failure_reservation_retained is true',
      "status = 'completed'",
      "origin = 'adopted_active_descendant'",
      'finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes',
      'finalized_egress_upper_bound_bytes = 134217728',
      'failureReservationRetained',
      'retainedEgressUpperBoundBytes',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('preserves the original halted batch in an immutable repair audit', () => {
    for (const required of [
      'create table if not exists xrpl_r5_v1.halted_descendant_repairs',
      'prior_batch jsonb not null',
      'source_diagnostic_run_id bigint not null',
      'repaired_works_digest text not null',
      'repaired_rows_digest text not null',
      'remaining_adoption jsonb not null',
      'v_prior_batch := to_jsonb(v_batch)',
      'insert into xrpl_r5_v1.halted_descendant_repairs',
      'primary key (run_id, batch_id)',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('proves the first twenty-four committed ledgers before transforming batch 87', () => {
    for (const required of [
      'work.start_ledger_index between 4135113 and 4135136',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_work_count <> 24',
      'v_first_previous_index <> 4135112',
      'v_first_final_index <> 4135136',
      "'workId', chain.work_id",
      "'payloadDigest', chain.payload_digest",
      "'valueJson', rows.value_json",
      'v_first_works_digest',
      'v_first_rows_digest',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('converts only batch 87 and delegates the remaining fifteen ledgers to the proven adoption function', () => {
    const batchUpdate = migration.indexOf(
      "update xrpl_r5_v1.recovery_batches\n  set status = 'completed'",
    )
    const runUpdate = migration.indexOf(
      "update xrpl_r5_v1.recovery_runs\n  set status = 'running'",
    )
    const remainingAdoption = migration.indexOf(
      'public.xrpl_adopt_r5_committed_active_descendants(',
      runUpdate,
    )

    expect(batchUpdate).toBeGreaterThanOrEqual(0)
    expect(runUpdate).toBeGreaterThan(batchUpdate)
    expect(remainingAdoption).toBeGreaterThan(runUpdate)

    for (const required of [
      "origin = 'adopted_active_descendant'",
      'completed_batches = completed_batches + 1',
      'committed_ledgers = committed_ledgers + 24',
      'adopted_batches = adopted_batches + 1',
      'adopted_ledgers = adopted_ledgers + 24',
      "(v_remaining_adoption->>'startLedgerIndex')::bigint <> 4135137",
      "(v_remaining_adoption->>'endLedgerIndex')::bigint <> 4135151",
      "(v_remaining_adoption->>'ledgerCount')::bigint <> 15",
      "(v_remaining_adoption->>'firstBatchSequence')::bigint <> 88",
      'v_run.completed_batches <> 88',
      'v_run.committed_ledgers <> 1844',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires a zero-step healthy phase boundary and exact final arithmetic', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary(',
      "(v_boundary->>'drainedStepCount')::integer <> 0",
      "v_boundary->'checks'->>'collectorQuiescent'",
      "v_boundary->'checks'->>'activeStreamHealthy'",
      "v_boundary->'checks'->>'noScanExecuted'",
      "v_boundary->'checks'->>'onePendingScan'",
      "v_boundary->'checks'->>'pendingScanBoundToWatermark'",
      "v_boundary->'checks'->>'noInflightWork'",
      'v_run.committed_ledgers',
      'v_run.current_watermark_ledger_index',
      'v_run.start_watermark_ledger_index',
      'v_halted_batch_count <> 0',
      'v_last_completed_end <> 4135151',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps public, Mainnet, stabilization and soak boundaries closed', () => {
    for (const required of [
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
      'from public, anon, authenticated',
      'to service_role',
    ]) {
      expect(migration).toContain(required)
    }

    for (const forbidden of [
      'delete from',
      'truncate ',
      'drop table',
      'drop function',
      'drop schema',
      'drop type',
      'drop owned',
      ' cascade;',
      "'mainnetEnabled', true",
      "'stabilizationAuthorized', true",
      "'soakAuthorized', true",
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }

    expect(migration.toLowerCase()).toContain('on delete cascade')
  })
})
