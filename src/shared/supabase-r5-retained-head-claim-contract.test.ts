import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803123200_xrpl_r5_recovery_retained_head_claim.sql',
  ),
  'utf8',
)

describe('R5 retained-head recovery claim contract', () => {
  it('binds claims to the selected revision-3 recovery run', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head',
      "v_run.profile_id <> 'supabase_free_postgres_pgcron_edge'",
      'v_run.profile_revision <> 3',
      "<> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      "<> '13a313d9d0679c7c512b59f9931d733dcb3217ec8e1cc6e74a36125a0354b667'",
      "v_run.source_profile_id <> 'supabase-devnet'",
      "v_run.network <> 'devnet'",
      "v_run.epoch_id <> 'supabase-r4c2c-v1'",
      'v_run.batch_size <> 24',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('reserves from the immutable prepared head before any network read', () => {
    for (const required of [
      'public.xrpl_claim_r5_active_recovery_batch(',
      'v_run.initial_validated_head_ledger_index',
      'v_run.initial_validated_head_ledger_hash',
      "'reservationBeforeAnyNetworkRead', true",
      "'freshHeadMustCoverReservedEndBeforeFetch', true",
      "'networkReadOccurredBeforeReservation', false",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('fetch(')
    expect(migration).not.toContain('http_')
    expect(migration).not.toContain('net.http')
  })

  it('returns the exact active identity and revision-3 accounting baseline', () => {
    for (const required of [
      "'network', v_run.network",
      "'epochId', v_run.epoch_id",
      "'baseIdentity', v_run.base_identity",
      "'currentWatermarkLedgerIndex', v_run.current_watermark_ledger_index",
      "'currentWatermarkLedgerHash', v_run.current_watermark_ledger_hash",
      "'currentWatermarkWorkId', v_run.current_watermark_work_id",
      "'priorInvocations31d', v_projected_invocations - 1",
      "(v_claim->>'projectedInvocations31d')::bigint",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('requires an explicit fresh-head phase after reaching the retained head', () => {
    for (const required of [
      'v_run.current_watermark_ledger_index',
      '>= v_run.initial_validated_head_ledger_index',
      "'reason', 'fresh_head_refresh_required'",
      "'activeRecoveryStarted', v_run.status = 'running'",
      "'publicReaderUnchanged', true",
      "'mainnetDisabled', true",
      "'stabilizationNotStarted', true",
      "'soakNotStarted', true",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain("set status = 'caught_up'")
  })

  it('keeps execution permissions closed', () => {
    for (const required of [
      'from public, anon, authenticated',
      'to service_role',
      'to supabase_admin',
    ]) {
      expect(migration).toContain(required)
    }
  })
})
