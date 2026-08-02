import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2 Supabase remote probe and phase-chain contract', () => {
  const probeMigration = read(
    'supabase/migrations/20260802002000_xrpl_remote_collector_probe.sql',
  )
  const phaseMigration = read(
    'supabase/migrations/20260802095000_xrpl_remote_portable_phase_chain.sql',
  )
  const phaseIdentityMigration = read(
    'supabase/migrations/20260802095100_xrpl_remote_phase_message_identity.sql',
  )
  const edgeFunction = read('supabase/functions/xrpl-collector-tick/index.ts')
  const verifier = read('scripts/verify-supabase-remote-probe.mjs')
  const config = read('supabase/config.toml')
  const setup = read('docs/ops/supabase-one-time-setup-2026-08-02.md')

  it('keeps the remote runtime Devnet-only and fail-closed', () => {
    expect(edgeFunction).toContain('https://s.devnet.rippletest.net:51234/')
    expect(edgeFunction).toContain("request.headers.get('apikey') !== secretKey")
    expect(edgeFunction).toContain("request.method === 'GET'")
    expect(edgeFunction).toContain("request.method !== 'POST'")
    expect(edgeFunction).toContain('AbortSignal.timeout(8_000)')
    expect(edgeFunction).toContain("message.network !== 'devnet'")
    expect(edgeFunction).toContain("message.epochId !== 'supabase-r4c2b-v1'")
    expect(edgeFunction).not.toContain('xrplcluster.com')
    expect(edgeFunction).not.toContain('MAINNET')
  })

  it('binds the original Cron probe, Vault, RLS, and transactional tick lease', () => {
    for (const required of [
      'create extension if not exists pg_cron',
      'create extension if not exists pg_net with schema extensions',
      'create extension if not exists supabase_vault with schema vault',
      'alter table public.xrpl_collector_runtime enable row level security',
      'alter table public.xrpl_collector_runs enable row level security',
      'xrpl_claim_collector_tick',
      'xrpl_complete_collector_tick',
      'xrpl_fail_collector_tick',
      "'xrpl_project_url'",
      "'xrpl_secret_key'",
      "'xrpl-lending-monitor-minute'",
      "'* * * * *'",
      'timeout_milliseconds := 10000',
      "grant execute on function public.xrpl_claim_collector_tick",
    ]) {
      expect(probeMigration).toContain(required)
    }
    expect(probeMigration).not.toContain('YOUR_PROJECT_SECRET_KEY')
    expect(probeMigration).not.toContain('service_role key')
  })

  it('creates durable exact phase messages and committed-only storage', () => {
    for (const required of [
      'create table if not exists public.xrpl_phase_streams',
      'create table if not exists public.xrpl_phase_messages',
      'create table if not exists public.xrpl_phase_successors',
      'create table if not exists public.xrpl_phase_work',
      'create table if not exists public.xrpl_phase_payload_chunks',
      'create table if not exists public.xrpl_phase_reference_rows',
      'create table if not exists public.xrpl_phase_commit_chunks',
      'create table if not exists public.xrpl_phase_watermarks',
      'create or replace view public.xrpl_phase_committed_reference_rows',
      "where work.status = 'committed'",
      "status in ('pending', 'leased', 'retry', 'completed', 'error')",
      "status in ('planned', 'staged', 'committing', 'finalizing', 'committed', 'error')",
      'alter table public.xrpl_phase_messages enable row level security',
      'revoke all on public.xrpl_phase_messages from anon, authenticated',
      'grant select, insert, update on public.xrpl_phase_messages to service_role',
    ]) {
      expect(phaseMigration).toContain(required)
    }
  })

  it('keeps claim, stale reclaim, retry, terminal halt, and successor reservation transactional', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_next_phase',
      'for update skip locked',
      "status = 'leased' and lease_expires_at <= p_now",
      'attempt_count = attempt_count + 1',
      'create or replace function public.xrpl_phase_reserve_successor',
      'phase successor identity conflict',
      'create or replace function public.xrpl_retry_phase_message',
      "p_classification not in ('retryable_transport', 'retryable_storage')",
      "status = 'retry'",
      'create or replace function public.xrpl_fail_phase_terminal',
      "status = 'halted'",
      'create or replace function public.xrpl_complete_scan_phase',
      'create or replace function public.xrpl_complete_commit_phase',
      'create or replace function public.xrpl_complete_finalize_phase',
      'payload digest or byte count mismatch',
      'finalize watermark conflict',
    ]) {
      expect(phaseMigration).toContain(required)
    }
  })

  it('uses portable-compatible deterministic message IDs', () => {
    expect(phaseMigration).toContain("'scan:v1:'")
    expect(phaseMigration).toContain("'collector-work-v1:'")
    expect(phaseIdentityMigration).toContain("replace(p_work_id, ':', '%3A')")
    expect(phaseIdentityMigration).toContain("'commit:v1:'")
    expect(phaseIdentityMigration).toContain("'finalize:v1:'")
    expect(edgeFunction).toContain('encodeURIComponent(workId)')
    expect(edgeFunction).toContain('scan message ID does not match semantic identity')
    expect(edgeFunction).toContain('commit message ID does not match semantic identity')
    expect(edgeFunction).toContain('finalize message ID does not match semantic identity')
  })

  it('executes one real phase per Cron tick against exact validated Devnet ledgers', () => {
    for (const required of [
      "'xrpl_claim_next_phase'",
      "'xrpl_complete_caught_up_scan'",
      "'xrpl_complete_scan_phase'",
      "'xrpl_complete_commit_phase'",
      "'xrpl_complete_finalize_phase'",
      "'xrpl_retry_phase_message'",
      "'xrpl_fail_phase_terminal'",
      "rpcRequest(endpoint, 'server_info'",
      "rpcRequest(endpoint, 'ledger'",
      'message.expectedPreviousLedgerIndex + 1',
      'ledger.parentHash !== message.expectedPreviousLedgerHash',
      "semanticClass: 'validated-ledger'",
      'const payloadJson = canonicalJson(payload)',
      'const payloadDigest = await sha256Hex(payloadJson)',
    ]) {
      expect(edgeFunction).toContain(required)
    }
  })

  it('requires a complete remote scan, commit, finalize, watermark, row, and successor chain', () => {
    for (const required of [
      'const maximumAttempts = 36',
      'schemaVersion: 2',
      "phaseEpochId: 'supabase-r4c2b-v1'",
      "requiredPhases: ['scan', 'commit', 'finalize']",
      'committedOnlyVisibility: true',
      'successorContinuation: true',
      'watermark has not advanced beyond the immutable base',
      'watermark work is not committed',
      'committed row is not visible at the watermark',
      'scan, commit, finalize, and successor chain is not complete yet',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('documents the one-time cardless handoff and automated deployment boundary', () => {
    expect(config).toContain('[functions.xrpl-collector-tick]')
    expect(config).toContain('verify_jwt = false')
    for (const required of [
      'Free organization and Free project only',
      'Do not add a payment method',
      'SUPABASE_ACCESS_TOKEN',
      'SUPABASE_PROJECT_ID',
      'SUPABASE_DB_PASSWORD',
      'working directory: `.`',
      'deploy to production: enabled',
      'production branch: `main`',
      'automatic branching: disabled',
      'xrpl_project_url',
      'xrpl_secret_key',
      'No Supabase dashboard interaction should be needed',
    ]) {
      expect(setup).toContain(required)
    }
    expect(setup).not.toContain('Supabase directory: `supabase`')
  })
})
