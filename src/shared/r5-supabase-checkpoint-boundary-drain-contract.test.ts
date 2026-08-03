import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const drain = read(
  'supabase/migrations/20260803122000_xrpl_r5_checkpoint_boundary_drain.sql',
)
const wrapper = read(
  'supabase/migrations/20260803122100_xrpl_r5_checkpoint_drain_wrapper.sql',
)

describe('R5 checkpoint boundary drain contract', () => {
  it('requires a stopped healthy collector and one quiescent pending message', () => {
    for (const required of [
      'create or replace function public.xrpl_drain_r5_checkpoint_boundary',
      "pg_advisory_xact_lock(hashtextextended('xrpl-r5-checkpoint-boundary-drain', 0))",
      "where profile_id = 'supabase-devnet'",
      "v_runtime.status <> 'stopped'",
      'v_runtime.lease_owner is not null',
      'v_runtime.lease_expires_at is not null',
      'v_runtime.last_error is not null',
      'v_runtime.consecutive_failures <> 0',
      "v_stream.status <> 'active'",
      'v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0',
    ]) {
      expect(drain).toContain(required)
    }
  })

  it('never executes a scan and drains only already staged commit or finalize work', () => {
    for (const required of [
      "if v_pending.phase = 'scan' then",
      "if v_pending.phase not in ('commit', 'finalize') then",
      'r5_checkpoint_drain_unexpected_pending_phase',
      'public.xrpl_claim_next_phase(p_owner, v_step_at, 55)',
      'public.xrpl_complete_portable_commit_phase(',
      'public.xrpl_complete_portable_finalize_phase(',
      "'onlyExistingCommitOrFinalizeDrained', true",
      "'noScanExecuted', true",
      'r5_checkpoint_drain_step_limit',
    ]) {
      expect(drain).toContain(required)
    }
    expect(drain).not.toContain('xrpl_complete_portable_scan_phase(')
    expect(drain).not.toContain('xrpl_complete_caught_up_scan(')
  })

  it('reconstructs commit rows from the retained payload chunk and reuses portable validation', () => {
    for (const required of [
      'from public.xrpl_phase_payload_chunks',
      "v_chunk.encoding <> 'normalized-payload-chunk-json-v1'",
      "v_rows_json := ((v_chunk.payload_json::jsonb)->'records')::text",
      "jsonb_typeof(v_rows_json::jsonb) <> 'array'",
      'jsonb_array_length(v_rows_json::jsonb) <> v_chunk.record_count',
      "extensions.digest(convert_to(v_rows_json, 'UTF8'), 'sha256')",
      'v_rows_json,',
      'v_rows_digest',
    ]) {
      expect(drain).toContain(required)
    }
  })

  it('requires the resulting pending scan to bind exactly to the final watermark', () => {
    for (const required of [
      "v_pending.payload->>'expectedPreviousLedgerIndex'",
      "v_pending.payload->>'expectedPreviousLedgerHash'",
      "v_pending.payload->>'network' <> v_stream.network",
      "v_pending.payload->>'epochId' <> v_stream.epoch_id",
      "v_pending.payload->>'baseIdentity' <> v_stream.base_identity",
      'r5_checkpoint_drain_scan_not_bound_to_watermark',
      "status in ('planned', 'staged', 'committing', 'finalizing')",
      'r5_checkpoint_drain_scan_has_inflight_work',
      "'onePendingScan', true",
      "'pendingScanBoundToWatermark', true",
      "'noInflightWork', true",
    ]) {
      expect(drain).toContain(required)
    }
  })

  it('wraps drain and strict checkpoint creation in the same transaction', () => {
    for (const required of [
      'alter function public.xrpl_create_r5_active_checkpoint(text, timestamptz)',
      'rename to xrpl_create_r5_active_checkpoint_strict',
      'create function public.xrpl_create_r5_active_checkpoint(',
      "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0))",
      'public.xrpl_drain_r5_checkpoint_boundary(v_owner, p_observed_at)',
      "v_drain->>'purpose' <> 'r5-checkpoint-boundary-drain'",
      "v_drain #>> '{checks,pendingScanBoundToWatermark}'",
      "v_drain #>> '{checks,noInflightWork}'",
      "v_drain #>> '{checks,noScanExecuted}'",
      'public.xrpl_create_r5_active_checkpoint_strict(',
      "'boundaryDrain'",
      "'drainedStepCount'",
      "'drainedPhases'",
      "'watermarkBefore'",
      "'watermarkAfter'",
    ]) {
      expect(wrapper).toContain(required)
    }
  })

  it('keeps the wrapper private and every later boundary disabled', () => {
    for (const required of [
      'from public, anon, authenticated',
      'to service_role',
      "rolname = 'supabase_admin'",
      'to supabase_admin',
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'activeRecoveryStarted', false",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
    ]) {
      expect(`${drain}\n${wrapper}`).toContain(required)
    }
    expect(`${drain}\n${wrapper}`).not.toContain(' to anon')
    expect(`${drain}\n${wrapper}`).not.toContain(' to authenticated')
    expect(`${drain}\n${wrapper}`).not.toContain("network = 'mainnet'")
  })
})
