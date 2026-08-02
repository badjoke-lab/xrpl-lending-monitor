import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803020000_xrpl_isolated_catchup_throughput.sql',
)
const edge = read('supabase/functions/xrpl-catchup-throughput/index.ts')
const verifier = read('scripts/verify-supabase-catchup-throughput.mjs')
const publisher = read('scripts/publish-supabase-run-locator.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')
const config = read('supabase/config.toml')

describe('Supabase R4C2d isolated catch-up throughput contract', () => {
  it('copies exactly 64 contiguous committed active works into an isolated typed schema', () => {
    for (const required of [
      'create schema if not exists xrpl_catchup_v1',
      'create table if not exists xrpl_catchup_v1.trials',
      'create table if not exists xrpl_catchup_v1.source_works',
      'create table if not exists xrpl_catchup_v1.messages',
      'create table if not exists xrpl_catchup_v1.successors',
      'create table if not exists xrpl_catchup_v1.work',
      'create table if not exists xrpl_catchup_v1.payload_chunks',
      'create table if not exists xrpl_catchup_v1.reference_rows',
      'create table if not exists xrpl_catchup_v1.commit_chunks',
      'create table if not exists xrpl_catchup_v1.watermarks',
      'create or replace function public.xrpl_prepare_isolated_catchup_trial',
      "p_source_count <> 64",
      "work.profile_id = 'supabase-devnet'",
      "work.epoch_id = 'supabase-r4c2c-v1'",
      "work.status = 'committed'",
      'limit p_source_count',
      "raise exception 'catch-up source window is not contiguous'",
      "raise exception 'catch-up source window is not bound to the captured watermark'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('executes scan, commit, finalize, and successor reservation for every source work', () => {
    for (const required of [
      'create or replace function public.xrpl_execute_isolated_catchup_trial',
      "v_scan_id := concat('catchup:v1:'",
      "v_commit_id := concat('catchup:v1:'",
      "v_finalize_id := concat('catchup:v1:'",
      "v_next_scan_id := concat('catchup:v1:'",
      "status = 'leased'",
      'attempt_count = attempt_count + 1',
      "status = 'staged'",
      "set status = 'committing'",
      "set status = 'finalizing'",
      "set status = 'committed'",
      'insert into xrpl_catchup_v1.successors',
      "v_message_count <> 193",
      "v_completed_count <> 192",
      "v_pending_count <> 1",
      "v_successor_count <> 192",
      "attempt_count <> 1",
      "raise exception 'catch-up scheduler parity failed'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('proves source/target row digest, target watermark, and active-profile isolation', () => {
    for (const required of [
      "raise exception 'catch-up committed-row parity failed'",
      "'rowCountParity'",
      "'rowDigestParity'",
      "'targetWatermarkMatchesSource'",
      "'activeProfileNonRegressing'",
      'v_source_digest',
      'v_target_digest',
      'v_active_after.ledger_index < v_trial.active_before_ledger_index',
      "where profile_id = 'supabase-devnet'",
      'revoke all on schema xrpl_catchup_v1 from public, anon, authenticated',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('update public.xrpl_phase_')
    expect(migration).not.toContain('delete from public.xrpl_phase_')
  })

  it('runs five 64-work trials and keeps full G7 false when steady evidence fails', () => {
    for (const required of [
      "const PURPOSE = 'r4c2d-isolated-catchup-throughput'",
      'const TRIAL_COUNT = 5',
      'const SOURCE_COUNT = 64',
      'const CATCH_UP_THRESHOLD = 30',
      "'xrpl_prepare_isolated_catchup_trial'",
      "'xrpl_execute_isolated_catchup_trial'",
      'committedLedgersPerMinute',
      'p95CommittedLedgersPerMinute',
      'catchUpObservedPass',
      'steadyObservedPass: false',
      'g7Qualified: false',
      'g7NotOverstated: true',
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).not.toContain('MAINNET')
    expect(edge).not.toContain("method: 'submit'")
  })

  it('retains sanitized five-trial and credential evidence', () => {
    for (const required of [
      'verified-catchup-throughput.json',
      'failed-catchup-throughput-verification.json',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'trialCount !== 5',
      'sourceCount !== 64',
      'messages.total !== 193',
      'messages.completed !== 192',
      'messages.pending !== 1',
      'trial.successors !== 192',
      'summary.g7Qualified !== false',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('verifierToken: verifierToken')
    expect(publisher).toContain('catch-up throughput verifier')
    expect(publisher).toContain('verified-catchup-throughput.json')
    expect(publisher).toContain('failed-catchup-throughput-verification.json')
  })

  it('deploys the eleventh function through the existing single guarded workflow', () => {
    expect(config).toContain('[functions.xrpl-catchup-throughput]')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(9)
    expect(config.match(/verify_jwt=false/g)).toHaveLength(2)
    for (const required of [
      "'supabase/functions/xrpl-catchup-throughput/index.ts'",
      'catchup-throughput-bundle.json',
      'supabase functions deploy xrpl-catchup-throughput',
      'node scripts/verify-supabase-catchup-throughput.mjs',
      'verified-catchup-throughput.json',
      'failed-catchup-throughput-verification.json',
      'catch-up throughput verifier: `success`',
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
