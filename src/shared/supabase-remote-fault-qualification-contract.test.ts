import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803002000_xrpl_remote_fault_qualification.sql',
)
const leaseMigration = read(
  'supabase/migrations/20260803002500_xrpl_remote_fault_lease_window.sql',
)
const edge = read('supabase/functions/xrpl-remote-fault-qualification/index.ts')
const verifier = read('scripts/verify-supabase-remote-fault-qualification.mjs')
const publisher = read('scripts/publish-supabase-run-locator.mjs')
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)
const config = read('supabase/config.toml')

describe('Supabase isolated remote fault qualification contract', () => {
  it('creates a typed isolated scheduler without mutating the active profile', () => {
    for (const required of [
      'create schema if not exists xrpl_fault_v1',
      '(like public.xrpl_phase_streams including all)',
      '(like public.xrpl_phase_messages including all)',
      '(like public.xrpl_phase_successors including all)',
      "v_profile_id constant text := 'supabase-devnet-fault-qualification'",
      "v_active_profile_id constant text := 'supabase-devnet'",
      "v_fixture_id constant text := 'r4c2c-remote-fault-qualification-v1'",
      "v_scenarios constant text[] := array['rollback', 'retry', 'stale', 'terminal', 'halt-probe']",
      "raise exception 'fault_qualification_target_not_empty'",
      "v_active_stream.status <> 'active'",
      "v_active_stream.network <> 'devnet'",
      "v_active_stream.epoch_id <> 'supabase-r4c2c-v1'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('update public.xrpl_phase_streams')
    expect(migration).not.toContain('update public.xrpl_phase_messages')
    expect(migration).not.toContain('update public.xrpl_phase_watermarks')
    expect(migration).not.toContain('delete from public.xrpl_phase_')
  })

  it('proves interruption rollback before normal completion', () => {
    for (const required of [
      'create or replace function public.xrpl_inject_remote_fault_rollback',
      "'fault-event:v1:rollback-sentinel'",
      "'fault:v1:rollback-successor'",
      "raise exception 'injected_interruption_rollback'",
      'create or replace function public.xrpl_record_remote_fault_rollback_observation',
      "v_message.status <> 'leased'",
      'v_message.successor_message_id is not null',
      "where event_type = 'rollback-sentinel'",
      "'messageRemainedLeased', true",
      "'sentinelAbsent', true",
      "'successorAbsent', true",
      "'interruptionRolledBack'",
      "'rollbackMessageCompleted'",
    ]) {
      expect(migration).toContain(required)
    }
    for (const required of [
      "'xrpl_inject_remote_fault_rollback'",
      "injected.text.includes('injected_interruption_rollback')",
      "'xrpl_record_remote_fault_rollback_observation'",
      'observation.messageRemainedLeased !== true',
      'observation.sentinelAbsent !== true',
      'observation.successorAbsent !== true',
    ]) {
      expect(edge).toContain(required)
    }
  })

  it('proves exact retry backoff and stale lease reclaim', () => {
    for (const required of [
      'create or replace function public.xrpl_schedule_remote_fault_retry',
      'p_backoff_seconds <> 30',
      "status = 'retry'",
      "error_classification = 'transient'",
      "'backoffSeconds', p_backoff_seconds",
      "'retryBackoffApplied'",
      "v_retry.attempt_count = 2",
      "'staleLeaseReclaimed'",
      'v_stale.attempt_count = 2',
    ]) {
      expect(migration).toContain(required)
    }
    for (const required of [
      "preDue.reason !== 'not_ready'",
      'dueClaim.attemptCount !== 2',
      "beforeExpiry.reason !== 'lease_active'",
      'reclaimed.reclaimed !== true',
      'reclaimed.attemptCount !== 2',
      'reclaimed.previousLeaseOwner',
    ]) {
      expect(edge).toContain(required)
    }
    expect(leaseMigration).toContain(
      "when v_message.payload->>'scenario' = 'stale' then p_lease_seconds",
    )
    expect(leaseMigration).toContain('else 300')
  })

  it('proves terminal fail-closed halt without reserving a successor', () => {
    for (const required of [
      'create or replace function public.xrpl_terminal_halt_remote_fault',
      "p_classification <> 'integrity'",
      "status = 'error'",
      "status = 'halted'",
      'last_error_classification = p_classification',
      "'successorReserved', false",
      "'terminalHaltApplied'",
      "'terminalSuccessorAbsent'",
      "'haltProbeRemainsPending'",
      "'noSuccessorsReserved'",
    ]) {
      expect(migration).toContain(required)
    }
    for (const required of [
      "p_error_message: 'injected terminal qualification failure'",
      'halt.successorReserved !== false',
      'duplicate.duplicate !== true',
      "haltedProbe.reason !== 'stream_halted'",
      'terminalFailClosedHaltProved: true',
      'terminalReplayConverged: true',
    ]) {
      expect(edge).toContain(required)
    }
  })

  it('retains token, purpose, active-isolation, and sanitized evidence boundaries', () => {
    for (const required of [
      "const PURPOSE = 'r4c2c-remote-fault-qualification'",
      "const VERIFY_TOKEN_HEADER = 'x-xrpl-reader-token'",
      "env('XRPL_READER_VERIFY_TOKEN')",
      'verifyActiveIsolation(activeBefore, activeAfter)',
      'remoteFaultQualificationProved: true',
      "request.method !== 'POST'",
      "'cache-control': 'no-store'",
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).not.toContain('MAINNET')
    expect(edge).not.toContain("method: 'submit'")

    for (const required of [
      'verified-remote-fault-qualification.json',
      'failed-remote-fault-qualification-verification.json',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'interruptionRollbackProved: true',
      'retryBackoffProved: true',
      'staleLeaseReclaimProved: true',
      'terminalFailClosedHaltProved: true',
      'activeWatermarkBefore',
      'activeWatermarkAfter',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('verifierToken: verifierToken')
    expect(publisher).toContain('remote fault qualification verifier')
    expect(publisher).toContain('verified-remote-fault-qualification.json')
    expect(publisher).toContain('failed-remote-fault-qualification-verification.json')
  })

  it('retains the ninth function in the historical single guarded workflow contract', () => {
    expect(config).toContain('[functions.xrpl-remote-fault-qualification]')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(9)
    for (const required of [
      "'supabase/functions/xrpl-remote-fault-qualification/index.ts'",
      'remote-fault-qualification-bundle.json',
      'supabase functions deploy xrpl-remote-fault-qualification',
      'node scripts/verify-supabase-remote-fault-qualification.mjs',
      'verified-remote-fault-qualification.json',
      'failed-remote-fault-qualification-verification.json',
      'remote fault qualification verifier: `success`',
      'node scripts/publish-supabase-run-locator.mjs',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
    expect(workflow).not.toContain('  schedule:')
  })
})
