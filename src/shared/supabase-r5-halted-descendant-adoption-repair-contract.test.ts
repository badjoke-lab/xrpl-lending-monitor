import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const preparation = read(
  'supabase/migrations/20260804143500_xrpl_r5_repair_halted_descendant_adoption.sql',
)
const repair = read(
  'supabase/migrations/20260804143600_xrpl_r5_repair_halted_descendant_boundary.sql',
)

describe('R5 halted descendant boundary repair contract', () => {
  it('keeps schema preparation separate from the production mutation', () => {
    expect(preparation).toContain(
      'failure_reservation_retained boolean not null default false',
    )
    expect(preparation).toContain(
      'create table if not exists xrpl_r5_v1.halted_descendant_repairs',
    )
    expect(preparation).toContain('source_failed_deploy_run_id bigint not null')
    expect(preparation).toContain('boundary jsonb not null')
    expect(preparation).toContain('schema_version integer not null default 2')
    expect(preparation).not.toContain(
      'perform public.xrpl_repair_r5_halted_batch_after_boundary_drain',
    )
  })

  it('retains the failed 128 MiB reservation without broadening normal batches', () => {
    for (const required of [
      'xrpl_r5_recovery_batch_finalized_egress',
      'failure_reservation_retained is false',
      'failure_reservation_retained is true',
      "status = 'completed'",
      "origin = 'adopted_active_descendant'",
      'finalized_egress_upper_bound_bytes = reserved_egress_upper_bound_bytes',
      'finalized_egress_upper_bound_bytes = 134217728',
    ]) {
      expect(preparation).toContain(required)
    }
  })

  it('binds execution to both failed production observations and the exact halted batch', () => {
    for (const required of [
      '30918725807',
      '30920985639',
      '4fd28a333646f9c3d9e153c7142b77b80bfa8988',
      "'r5-recovery-selected-revision3-entry'",
      "'r5-batch-v1-r5-recovery-selected-revision3-entry-00000087'",
      'v_run.completed_batches <> 86',
      'v_run.committed_ledgers <> 1805',
      'v_run.current_watermark_ledger_index <> 4135112',
      'r5_recovery_batch_completion_pending_scan_invalid',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('allows only the qualified existing commit or finalize drain', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary(',
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
      'v_boundary_after_index > 4135407',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('preserves the diagnostic ledger as a fixed descendant-chain anchor', () => {
    for (const required of [
      'work.start_ledger_index = 4135151',
      'v_diagnostic_hash <> v_diagnostic_physical_hash',
      'v_diagnostic_work_id <> v_diagnostic_physical_work',
      '82EE12132C2752B9E915D874B50042323E19C2C4E423F5EA411AF32F11C02F46',
      '3CD23A0CFDAE0F96A535A58504A7293DFC6B85ED46779DD24C617ADF5AD34B4E',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('proves the first twenty-four committed ledgers before converting batch 87', () => {
    for (const required of [
      'work.start_ledger_index between 4135113 and 4135136',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_work_count <> 24',
      'v_first_previous_index <> 4135112',
      'v_first_final_index <> 4135136',
      "'payloadDigest', chain.payload_digest",
      "'valueJson', rows.value_json",
      'v_first_works_digest',
      'v_first_rows_digest',
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('repairs batch 87 and delegates the dynamic remainder to the qualified adopter', () => {
    const batchUpdate = repair.indexOf(
      "update xrpl_r5_v1.recovery_batches\n  set status = 'completed'",
    )
    const runUpdate = repair.indexOf(
      "update xrpl_r5_v1.recovery_runs\n  set status = 'running'",
    )
    const remainingAdoption = repair.indexOf(
      'public.xrpl_adopt_r5_committed_active_descendants(',
      runUpdate,
    )

    expect(batchUpdate).toBeGreaterThanOrEqual(0)
    expect(runUpdate).toBeGreaterThan(batchUpdate)
    expect(remainingAdoption).toBeGreaterThan(runUpdate)

    for (const required of [
      "origin = 'adopted_active_descendant'",
      'failure_reservation_retained = true',
      'completed_batches = completed_batches + 1',
      'committed_ledgers = committed_ledgers + 24',
      'v_remaining_ledger_count := v_watermark.ledger_index - 4135136',
      'v_expected_remaining_batches := (v_remaining_ledger_count + 23) / 24',
      "(v_remaining_adoption->>'startLedgerIndex')::bigint <> 4135137",
      "(v_remaining_adoption->>'endLedgerIndex')::bigint",
      "(v_remaining_adoption->>'ledgerCount')::bigint",
      "(v_remaining_adoption->>'adoptedBatchCount')::bigint",
    ]) {
      expect(repair).toContain(required)
    }
  })

  it('requires exact final arithmetic and removes every halted batch', () => {
    for (const required of [
      'v_run.completed_batches <> 87 + v_expected_remaining_batches',
      'v_run.committed_ledgers',
      'v_watermark.ledger_index - v_run.start_watermark_ledger_index',
      'v_completed_batch_count <> v_run.completed_batches',
      'v_halted_batch_count <> 0',
      'v_last_completed_end <> v_watermark.ledger_index',
      'insert into xrpl_r5_v1.halted_descendant_repairs',
      'v_prior_batch, v_boundary',
    ]) {
      expect(repair).toContain(required)
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
      expect(`${preparation}\n${repair}`).toContain(required)
    }

    for (const forbidden of [
      'delete from',
      'truncate ',
      'drop table',
      'drop function',
      'drop schema',
      'drop type',
      'drop owned',
      "'mainnetEnabled', true",
      "'stabilizationAuthorized', true",
      "'soakAuthorized', true",
    ]) {
      expect(`${preparation}\n${repair}`.toLowerCase()).not.toContain(
        forbidden.toLowerCase(),
      )
    }
  })
})
