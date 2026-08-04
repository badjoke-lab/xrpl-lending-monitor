import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803123800_xrpl_r5_adopt_active_descendants.sql',
)

describe('R5 committed active descendant adoption contract', () => {
  it('records adopted progress separately while retaining canonical batch sequencing', () => {
    for (const required of [
      'adopted_batches bigint not null default 0',
      'adopted_ledgers bigint not null default 0',
      "origin text not null default 'r5_executor'",
      "origin in ('r5_executor', 'adopted_active_descendant')",
      'create table if not exists xrpl_r5_v1.recovery_adoptions',
      'work_count = ledger_count',
      'end_ledger_index = start_ledger_index + ledger_count - 1',
      "'adopted_active_descendant'",
      "'standardRevision3AccountingAlreadyRetained', true",
      "'additionalRecoveryEgressUpperBoundBytes', 0",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires an already running healthy R5 recovery with no open batch', () => {
    for (const required of [
      "v_run.status <> 'running'",
      'v_run.completed_batches < 1',
      'v_run.committed_ledgers < 1',
      'v_run.last_accounting_digest is null',
      'v_run.last_error is not null',
      'v_run.started_at is null',
      'v_run.completed_at is not null',
      'v_completed_batch_count <> v_run.completed_batches',
      'v_leased_batch_count <> 0',
      'v_halted_batch_count <> 0',
      'v_last_batch_end <> v_run.current_watermark_ledger_index',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('reuses the qualified pending-scan boundary without resetting retry history', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary(',
      "'r5-adopt-active-descendants'",
      "v_boundary->>'drainedStepCount'",
      "v_boundary->'checks'->>'collectorQuiescent'",
      "v_boundary->'checks'->>'activeStreamHealthy'",
      "v_boundary->'checks'->>'noScanExecuted'",
      "v_boundary->'checks'->>'onePendingScan'",
      "v_boundary->'checks'->>'pendingScanBoundToWatermark'",
      "v_boundary->'checks'->>'noInflightWork'",
      "v_boundary->>'network' <> v_run.network",
      "v_boundary->>'epochId' <> v_run.epoch_id",
      "v_boundary->>'baseIdentity' <> v_run.base_identity",
      "'pendingScanAttemptCountPreserved', true",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('v_pending_scan.attempt_count <> 0')
    expect(migration).not.toContain('update public.xrpl_phase_messages')
  })

  it('proves a complete one-ledger hash-linked chain before adoption', () => {
    for (const required of [
      'row_number() over (order by work.start_ledger_index, work.work_id)',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.scanned_end_ledger_index = chain.start_ledger_index',
      'chain.previous_ledger_index = v_run.current_watermark_ledger_index',
      'chain.expected_parent_hash = v_run.current_watermark_ledger_hash',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_work_count <> v_delta',
      'v_last_ledger_index <> v_watermark.ledger_index',
      'v_last_ledger_hash <> v_watermark.ledger_hash',
      'v_last_work_id <> v_watermark.work_id',
      'r5_recovery_adoption_descendant_chain_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('splits the adopted range into exact one-to-twenty-four-ledger records', () => {
    for (const required of [
      'v_adopted_batch_count := (v_delta + 23) / 24',
      'v_cursor_end := least(v_cursor_start + 23, v_watermark.ledger_index)',
      'v_chunk_count := (v_cursor_end - v_cursor_start + 1)::integer',
      'v_chunk_work_count <> v_chunk_count',
      "'r5-batch-v1-'",
      "lpad(v_batch_sequence::text, 8, '0')",
      '134217728, 0, 0, 134217728, 0, 2',
      'v_batch_sequence - v_first_batch_sequence <> v_adopted_batch_count',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('advances only recovery metadata and preserves exact arithmetic', () => {
    const adoptionInsert = migration.indexOf(
      'insert into xrpl_r5_v1.recovery_adoptions',
    )
    const recoveryUpdate = migration.indexOf(
      'update xrpl_r5_v1.recovery_runs\n  set current_watermark_ledger_index',
    )
    expect(adoptionInsert).toBeGreaterThanOrEqual(0)
    expect(recoveryUpdate).toBeGreaterThan(adoptionInsert)

    for (const required of [
      'completed_batches = completed_batches + v_adopted_batch_count',
      'committed_ledgers = committed_ledgers + v_delta',
      'adopted_batches = adopted_batches + v_adopted_batch_count',
      'adopted_ledgers = adopted_ledgers + v_delta',
      'v_run.current_watermark_ledger_index - v_run.start_watermark_ledger_index',
      'v_run.completed_batches * 24 < v_run.committed_ledgers',
      'r5_recovery_adoption_final_arithmetic_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('reconciles running recovery before the next guarded claim', () => {
    const adoptionCall = migration.lastIndexOf(
      'v_reconcile := public.xrpl_adopt_r5_committed_active_descendants(',
    )
    const claimCall = migration.indexOf(
      'v_claim := public.xrpl_claim_r5_active_recovery_batch(',
    )
    expect(adoptionCall).toBeGreaterThanOrEqual(0)
    expect(claimCall).toBeGreaterThan(adoptionCall)

    for (const required of [
      "if v_run.status = 'prepared' then",
      'public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'public.xrpl_adopt_r5_committed_active_descendants(',
      "'reservationBeforeAnyNetworkRead', true",
      "'freshHeadMustCoverReservedEndBeforeFetch', true",
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
      "rolname = 'supabase_admin'",
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
      "mainnetEnabled', true",
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
    expect(migration.toLowerCase()).toContain('on delete cascade')
  })
})
