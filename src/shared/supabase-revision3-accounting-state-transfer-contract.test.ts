import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const transfer = read(
  'supabase/migrations/20260803105000_xrpl_revision3_accounting_state_transfer.sql',
)
const activation = read(
  'supabase/migrations/20260803105500_xrpl_revision3_transfer_after_attempt_finalization.sql',
)

describe('Supabase revision-3 accounting state transfer contract', () => {
  it('exports the complete rolling application-owned quota state', () => {
    for (const required of [
      'create schema if not exists xrpl_resource_restore_v1',
      'create table if not exists xrpl_resource_restore_v1.attempt_rows',
      'create table if not exists xrpl_resource_restore_v1.accounting_rows',
      'create or replace function xrpl_resource_guard_v2.build_accounting_transfer_state',
      "started_at >= p_observed_at - interval '31 days'",
      "recorded_at >= p_observed_at - interval '31 days'",
      "case when rows.status = 'succeeded'",
      'greatest(v_attempt_egress, v_legacy_egress)',
      'v_attempt_count::bigint * 2',
      "'providerId'",
    ]) {
      if (required === "'providerId'") {
        expect(transfer).not.toContain(required)
      } else {
        expect(transfer).toContain(required)
      }
    }
  })

  it('performs typed isolated restore with exact canonical parity', () => {
    for (const required of [
      'create or replace function public.xrpl_restore_revision3_accounting_state',
      'public.xrpl_transfer_json_digest(p_state)',
      "raise exception 'revision3_accounting_state_digest_mismatch'",
      'insert into xrpl_resource_restore_v1.attempt_rows',
      'insert into xrpl_resource_restore_v1.accounting_rows',
      'xrpl_resource_restore_v1.build_restored_accounting_state(p_target_id)',
      'v_restored <> p_state',
      'public.xrpl_transfer_json_digest(v_restored) <> p_state_digest',
      "raise exception 'revision3_accounting_restore_parity_failure'",
    ]) expect(transfer).toContain(required)
  })

  it('proves duplicate convergence, tamper rejection, quota parity, and isolation', () => {
    for (const required of [
      'create or replace function public.xrpl_qualify_revision3_accounting_transfer',
      "v_state || jsonb_build_object('profileRevision', 2)",
      "position('revision3_accounting_state_digest_mismatch' in sqlerrm)",
      "(v_duplicate->>'duplicate')::boolean",
      "(v_first->>'effectiveEgressBytes')::bigint",
      "(v_first->>'reservedInvocations')::bigint",
      'v_stream_after.epoch_id <> v_stream_before.epoch_id',
      'v_watermark_after.ledger_index < v_watermark_before.ledger_index',
      "'rolling31dStateExported', true",
      "'typedRestoreCompleted', true",
      "'duplicateRestoreConverged', true",
      "'digestTamperRejected', true",
      "'effectiveEgressPreserved', true",
      "'reservedInvocationsPreserved', true",
      "'activeProfileReadOnly', true",
    ]) expect(transfer).toContain(required)
  })

  it('qualifies only after the final wrapper attempt has succeeded', () => {
    for (const required of [
      'drop trigger if exists xrpl_revision3_accounting_transfer_on_completion',
      'create or replace function xrpl_resource_guard_v2.qualify_transfer_after_attempt_finalization()',
      "old.status = 'open' and new.status = 'succeeded'",
      "v_session.status = 'completed'",
      'v_session.completed_ticks = 6',
      'v_session.committed_ledgers = 144',
      'after update of status on xrpl_resource_guard_v2.attempts',
    ]) expect(activation).toContain(required)
  })

  it('makes the existing remote accounting verifier fail closed on missing transfer state', () => {
    for (const required of [
      "v_transfer #>> '{checks,rolling31dStateExported}' = 'true'",
      "v_transfer #>> '{checks,typedRestoreCompleted}' = 'true'",
      "v_transfer #>> '{checks,canonicalDigestParity}' = 'true'",
      "v_transfer #>> '{checks,duplicateRestoreConverged}' = 'true'",
      "v_transfer #>> '{checks,digestTamperRejected}' = 'true'",
      "v_transfer #>> '{checks,effectiveEgressPreserved}' = 'true'",
      "v_transfer #>> '{checks,reservedInvocationsPreserved}' = 'true'",
      "'resourceAccountingStateTransferQualified', v_transfer_qualified",
      "'activeProfileReadOnly', v_transfer_qualified",
    ]) expect(activation).toContain(required)
  })
})
