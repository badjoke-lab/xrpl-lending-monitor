import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803120000_xrpl_r5_active_checkpoint.sql',
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
  nextPhase: { phase: string; r5Authorized: boolean }
  restrictions: Record<string, boolean>
}

describe('R5 selected Supabase active checkpoint contract', () => {
  it('binds the checkpoint to the exact R4E selection', () => {
    expect(selection.nextPhase).toEqual({
      phase: 'R5',
      objective:
        'Recover the selected Supabase revision-3 profile from the retained checkpoint, close Devnet lag to zero, and qualify stabilization without changing the public reader or enabling Mainnet.',
      r5Authorized: true,
    })
    for (const required of [
      selection.selectedProfile.profileId,
      String(selection.selectedProfile.profileRevision),
      selection.selectedProfile.profileIdentityDigest,
      selection.selectionDigest,
      "source_profile_id text not null check (source_profile_id = 'supabase-devnet')",
      "network text not null check (network = 'devnet')",
      "epoch_id text not null check (epoch_id = 'supabase-r4c2c-v1')",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('takes a single-transaction quiescent lock across active and quota state', () => {
    for (const required of [
      "pg_advisory_xact_lock(hashtextextended('xrpl-r5-active-checkpoint', 0))",
      'lock table public.xrpl_collector_runtime in share mode',
      'lock table public.xrpl_phase_streams in share mode',
      'lock table public.xrpl_phase_messages in share mode',
      'lock table public.xrpl_phase_successors in share mode',
      'lock table public.xrpl_phase_work in share mode',
      'lock table public.xrpl_phase_payload_chunks in share mode',
      'lock table public.xrpl_phase_reference_rows in share mode',
      'lock table public.xrpl_phase_commit_chunks in share mode',
      'lock table public.xrpl_phase_watermarks in share mode',
      'lock table xrpl_resource_guard_v2.attempts in share mode',
      'lock table xrpl_resource_guard_v2.tick_accounting in share mode',
      "v_runtime.status <> 'stopped'",
      'v_runtime.lease_owner is not null',
      'v_pending_count <> 1 or v_leased_count <> 0 or v_retry_count <> 0',
      'v_inflight_work_count <> 0',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('binds the pending scan, predecessor finalize, and committed work to one watermark', () => {
    for (const required of [
      "v_pending_scan.phase <> 'scan'",
      "v_pending_scan.payload->>'expectedPreviousLedgerIndex'",
      "v_pending_scan.payload->>'expectedPreviousLedgerHash'",
      'successors.successor_message_id = v_pending_scan.message_id',
      "v_predecessor.phase <> 'finalize'",
      "v_predecessor.status <> 'completed'",
      "v_predecessor.result->>'workId' <> v_watermark.work_id",
      "v_latest_work.status <> 'committed'",
      'v_latest_work.scanned_end_ledger_index <> v_watermark.ledger_index',
      'v_latest_work.final_ledger_hash <> v_watermark.ledger_hash',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('captures all active phase sections and revision-3 rolling accounting', () => {
    for (const required of [
      "'runtime', v_runtime_json",
      "'stream', v_stream_json",
      "'watermark', v_watermark_json",
      "'messages', v_messages_json",
      "'successors', v_successors_json",
      "'work', v_work_json",
      "'payloadChunks', v_payload_chunks_json",
      "'referenceRows', v_reference_rows_json",
      "'commitChunks', v_commit_chunks_json",
      'xrpl_resource_guard_v2.build_accounting_transfer_state(p_observed_at)',
      "'resourceAccounting', v_resource_json",
      "'resourceAttempts'",
      "'resourceTickAccounting'",
      "'revision3AccountingIncluded', true",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('stores canonical section and whole-state digests with duplicate convergence', () => {
    for (const required of [
      'section_digests jsonb not null',
      'state_digest text not null',
      "'messages', public.xrpl_transfer_json_digest(v_messages_json)",
      "'resourceAccounting', public.xrpl_transfer_json_digest(v_resource_json)",
      'v_state_digest := public.xrpl_transfer_json_digest(v_state)',
      'v_existing.state_digest <> v_state_digest',
      'v_existing.state <> v_state',
      "'duplicate', true",
      "'duplicate', false",
      'v_recomputed_digest = v_checkpoint.state_digest',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps every post-R5 boundary disabled', () => {
    expect(selection.restrictions).toEqual({
      publicReaderCutover: false,
      mainnet: false,
      stabilization: false,
      soak: false,
      retiredCloudflareCollectorRestart: false,
    })
    for (const required of [
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationAuthorized', false",
      "'soakAuthorized', false",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("network = 'mainnet'")
  })
})
