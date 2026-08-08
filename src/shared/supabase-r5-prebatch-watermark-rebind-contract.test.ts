import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803123400_xrpl_r5_prebatch_watermark_rebind.sql',
)
const detector = read('scripts/detect-supabase-r5-recovery-ownership.mjs')
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)

describe('R5 prebatch watermark rebind contract', () => {
  it('allows rebind only before any recovery progress', () => {
    for (const required of [
      "v_run.status <> 'prepared'",
      'v_run.completed_batches <> 0',
      'v_run.committed_ledgers <> 0',
      'v_run.last_accounting_digest is not null',
      'v_run.started_at is not null',
      'v_run.completed_at is not null',
      'r5_recovery_prebatch_rebind_progress_forbidden',
      'from xrpl_r5_v1.recovery_batches',
      'r5_recovery_prebatch_rebind_batch_present',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires the exact selected revision-three identity and frozen checkpoint', () => {
    for (const required of [
      'supabase_free_postgres_pgcron_edge',
      'v_run.profile_revision <> 3',
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67',
      '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667',
      "v_run.source_profile_id <> 'supabase-devnet'",
      "v_run.network <> 'devnet'",
      "v_run.epoch_id <> 'supabase-r4c2c-v1'",
      'public.xrpl_transfer_json_digest(v_checkpoint.state)',
      'v_checkpoint.state_digest <> v_run.checkpoint_state_digest',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('rebinds only a quiescent one-pending-scan active boundary', () => {
    for (const required of [
      "v_runtime.status <> 'stopped'",
      'v_runtime.lease_owner is not null',
      "v_stream.status <> 'active'",
      "count(*) filter (where status = 'pending')",
      'v_pending_count <> 1',
      'v_leased_count <> 0',
      'v_retry_count <> 0',
      "v_pending_scan.phase <> 'scan'",
      "v_pending_scan.payload->>'expectedPreviousLedgerIndex'",
      "v_pending_scan.payload->>'expectedPreviousLedgerHash'",
      "status in ('planned', 'staged', 'committing', 'finalizing')",
      'r5_recovery_prebatch_rebind_inflight_work_present',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('reproves the complete one-ledger hash-linked checkpoint descendant chain', () => {
    for (const required of [
      'v_checkpoint_to_start :=',
      'v_watermark.ledger_index - v_checkpoint.watermark_ledger_index',
      'chain.start_ledger_index = chain.previous_ledger_index + 1',
      'chain.scanned_end_ledger_index = chain.start_ledger_index',
      'chain.expected_parent_hash = v_checkpoint.watermark_ledger_hash',
      'chain.expected_parent_hash = chain.prior_final_ledger_hash',
      'v_descendant_count <> v_checkpoint_to_start',
      'v_last_ledger_index <> v_watermark.ledger_index',
      'v_last_ledger_hash <> v_watermark.ledger_hash',
      'v_last_work_id <> v_watermark.work_id',
      'r5_recovery_prebatch_rebind_descendant_chain_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('moves start and current together while preserving zero recovery accounting', () => {
    for (const required of [
      'start_watermark_ledger_index = v_watermark.ledger_index',
      'start_watermark_ledger_hash = v_watermark.ledger_hash',
      'start_watermark_work_id = v_watermark.work_id',
      'current_watermark_ledger_index = v_watermark.ledger_index',
      'current_watermark_ledger_hash = v_watermark.ledger_hash',
      'current_watermark_work_id = v_watermark.work_id',
      'checkpoint_to_start_ledgers = v_checkpoint_to_start',
      'descendant_work_count = v_descendant_count',
      'initial_lag_ledgers = v_initial_lag',
      "'zeroRecoveryBatchesPreserved', true",
      "'networkReadOccurredBeforeRebind', false",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('runs the rebind before quota reservation and base batch claim', () => {
    const rebindCall = migration.indexOf(
      'v_rebind := public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
    )
    const claimCall = migration.indexOf(
      'v_claim := public.xrpl_claim_r5_active_recovery_batch(',
    )
    expect(rebindCall).toBeGreaterThanOrEqual(0)
    expect(claimCall).toBeGreaterThan(rebindCall)
    for (const required of [
      "'reservationBeforeAnyNetworkRead', true",
      "'freshHeadMustCoverReservedEndBeforeFetch', true",
      "'prebatchRebind', v_rebind",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('grants only the exact helper and claim signatures to trusted roles', () => {
    for (const required of [
      'revoke all on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      ') from public, anon, authenticated;',
      'grant execute on function public.xrpl_rebind_r5_prebatch_recovery_to_active_boundary(',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      "rolname = 'supabase_admin'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('cascade')
    expect(migration).not.toContain('delete from')
    expect(migration).not.toContain('truncate ')
  })
})

describe('R5 active-stream ownership detection', () => {
  it('uses one read-only parameterized Management API query', () => {
    for (const required of [
      'https://api.supabase.com/v1/projects/${projectRef}/database/query',
      "authorization: `Bearer ${accessToken}`",
      "query: 'select public.xrpl_read_r5_active_recovery($1::text) as recovery'",
      'parameters: [recoveryRunId]',
      'read_only: true',
    ]) {
      expect(detector).toContain(required)
    }
    expect(detector).not.toContain('SUPABASE_DB_PASSWORD')
    expect(detector).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('claims ownership for every durable R5 state and fails closed on malformed state', () => {
    for (const required of [
      "!['prepared', 'running', 'caught_up', 'halted'].includes(recovery.status)",
      'activeRecoveryOwned = true',
      "status = 'absent'",
      "throw new Error('R5 recovery ownership identity or status changed')",
      'activeProbeMustBeSkipped: activeRecoveryOwned',
      'activeProbeMustBeSkipped: true',
      'failClosed: true',
    ]) {
      expect(detector).toContain(required)
    }
  })

  it('exports exact workflow outputs and retains sanitized evidence', () => {
    for (const required of [
      'active_recovery_owned=${activeRecoveryOwned}',
      'recovery_status=${status}',
      'r5-recovery-ownership.json',
      'failed-r5-recovery-ownership-detection.json',
      'publicReaderUnchanged: true',
      'mainnetDisabled: true',
      'stabilizationAuthorized: false',
      'soakAuthorized: false',
    ]) {
      expect(detector).toContain(required)
    }
  })

  it('retains the historical ordering where ownership detection blocks only the mutating active probe', () => {
    const detection = workflow.indexOf('Detect R5 active recovery ownership')
    const activeProbe = workflow.indexOf('Verify repeated remote portable phase execution')
    const committedReader = workflow.indexOf('Verify remote immutable committed reader')
    expect(detection).toBeGreaterThanOrEqual(0)
    expect(activeProbe).toBeGreaterThan(detection)
    expect(committedReader).toBeGreaterThan(activeProbe)
    expect(workflow).toContain('id: r5_recovery_ownership')
    expect(workflow).toContain(
      "if: steps.r5_recovery_ownership.outputs.active_recovery_owned != 'true'",
    )
    expect(workflow).toContain('node scripts/detect-supabase-r5-recovery-ownership.mjs')
    expect(workflow).toContain('node scripts/verify-supabase-committed-reader.mjs')
    expect(workflow).toContain('RETIRED / NON-EXECUTABLE CONTRACT SNAPSHOT')
    expect(workflow).not.toContain(
      "if: steps.r5_recovery_ownership.outputs.active_recovery_owned != 'true'\n        run: node scripts/verify-supabase-committed-reader.mjs",
    )
  })
})
