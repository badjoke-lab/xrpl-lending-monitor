import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803121000_xrpl_r5_recovery_prepare.sql',
)
const selection = JSON.parse(
  read('docs/ops/r4e-deployment-profile-selection-2026-08-03.json'),
) as {
  selectedProfile: {
    profileId: string
    profileRevision: number
    profileIdentityDigest: string
  }
  selectionDigest: string
}

describe('R5 Supabase recovery preparation contract', () => {
  it('binds one dormant recovery run to the exact checkpoint and selected profile', () => {
    for (const required of [
      'create table if not exists xrpl_r5_v1.recovery_runs',
      'checkpoint_id text not null references xrpl_r5_v1.active_checkpoints(checkpoint_id)',
      'checkpoint_state_digest text not null',
      selection.selectedProfile.profileId,
      String(selection.selectedProfile.profileRevision),
      selection.selectedProfile.profileIdentityDigest,
      selection.selectionDigest,
      "source_profile_id text not null check (source_profile_id = 'supabase-devnet')",
      "network text not null check (network = 'devnet')",
      "epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1')",
      "status text not null check (status in ('prepared', 'running', 'caught_up', 'halted'))",
      'batch_size integer not null check (batch_size = 24)',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires a canonical checkpoint digest and rereads the stored checkpoint state', () => {
    for (const required of [
      'create or replace function public.xrpl_prepare_r5_active_recovery',
      "p_checkpoint_state_digest !~ '^[a-f0-9]{64}$'",
      'v_checkpoint.state_digest <> p_checkpoint_state_digest',
      'public.xrpl_transfer_json_digest(v_checkpoint.state) <> v_checkpoint.state_digest',
      "v_checkpoint.source_profile_id <> 'supabase-devnet'",
      "v_checkpoint.network <> 'devnet'",
      "v_checkpoint.epoch_id <> 'supabase-r4c2c-v1'",
      'r5_recovery_prepare_checkpoint_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('takes a quiescent active-state transaction before preparing recovery', () => {
    for (const required of [
      "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-recovery', 0))",
      'lock table public.xrpl_collector_runtime in share mode',
      'lock table public.xrpl_phase_streams in share mode',
      'lock table public.xrpl_phase_messages in share mode',
      'lock table public.xrpl_phase_successors in share mode',
      'lock table public.xrpl_phase_work in share mode',
      'lock table public.xrpl_phase_watermarks in share mode',
      'lock table xrpl_r5_v1.active_checkpoints in share mode',
      "v_runtime.status <> 'stopped'",
      'v_runtime.lease_owner is not null',
      'v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0',
      'v_inflight_work_count <> 0',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('proves the checkpoint-to-current chain one committed ledger at a time', () => {
    for (const required of [
      'v_watermark.ledger_index < v_checkpoint.watermark_ledger_index',
      'v_checkpoint_to_start :=',
      'v_watermark.ledger_index - v_checkpoint.watermark_ledger_index',
      "work.profile_id = 'supabase-devnet'",
      "work.status = 'committed'",
      'work.start_ledger_index > v_checkpoint.watermark_ledger_index',
      'work.scanned_end_ledger_index <= v_watermark.ledger_index',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.scanned_end_ledger_index = chain.start_ledger_index',
      'chain.expected_parent_hash = v_checkpoint.watermark_ledger_hash',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_descendant_count <> v_checkpoint_to_start',
      'v_last_ledger_index <> v_watermark.ledger_index',
      'v_last_ledger_hash <> v_watermark.ledger_hash',
      'v_last_work_id <> v_watermark.work_id',
      'r5_recovery_prepare_checkpoint_descendant_chain_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds the pending successor scan and predecessor finalize to the current watermark', () => {
    for (const required of [
      "v_pending_scan.phase <> 'scan'",
      "v_pending_scan.payload->>'expectedPreviousLedgerIndex'",
      "v_pending_scan.payload->>'expectedPreviousLedgerHash'",
      'successors.successor_message_id = v_pending_scan.message_id',
      "v_predecessor.phase <> 'finalize'",
      "v_predecessor.status <> 'completed'",
      "v_predecessor.result->>'workId' <> v_watermark.work_id",
      "v_current_work.status <> 'committed'",
      'v_current_work.scanned_end_ledger_index <> v_watermark.ledger_index',
      'v_current_work.final_ledger_hash <> v_watermark.ledger_hash',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('records exact starting head and lag without starting active recovery', () => {
    for (const required of [
      'p_validated_head_ledger_index < v_watermark.ledger_index',
      'v_initial_lag := p_validated_head_ledger_index - v_watermark.ledger_index',
      "v_status := case when v_initial_lag = 0 then 'caught_up' else 'prepared' end",
      'initial_validated_head_ledger_index',
      'initial_validated_head_ledger_hash',
      'checkpoint_to_start_ledgers',
      'initial_lag_ledgers',
      'descendant_work_count',
      'completed_batches bigint not null default 0',
      'committed_ledgers bigint not null default 0',
      "'activeRecoveryStarted', v_run.status = 'running'",
      "'caughtUp', v_run.status = 'caught_up'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('converges exact duplicate preparation and rejects changed identity', () => {
    for (const required of [
      'select * into v_existing',
      'where run_id = p_run_id',
      'v_existing.checkpoint_state_digest <> p_checkpoint_state_digest',
      'v_existing.start_watermark_ledger_index <> v_watermark.ledger_index',
      'v_existing.initial_validated_head_ledger_index',
      'r5_recovery_prepare_identity_conflict',
      'return public.xrpl_read_r5_active_recovery(v_existing.run_id)',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps all post-recovery boundaries disabled', () => {
    for (const required of [
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("network = 'mainnet'")
    expect(migration).not.toContain("status = 'running' where")
  })
})
