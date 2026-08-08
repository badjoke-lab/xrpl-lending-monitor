import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803030000_xrpl_network_steady_batch.sql',
)
const pendingScan = read(
  'supabase/migrations/20260803030500_xrpl_network_steady_pending_scan.sql',
)
const tick = read('supabase/functions/xrpl-steady-batch-tick/index.ts')
const control = read('supabase/functions/xrpl-steady-throughput-qualification/index.ts')
const verifier = read('scripts/verify-supabase-steady-throughput.mjs')
const publisher = read('scripts/publish-supabase-steady-run-locator.mjs')
const workflow = read(
  'ops/retired/supabase-remote-probe-r4c-r5-workflow.snapshot.yml',
)
const config = read('supabase/config.toml')

describe('Supabase R4C2d network steady throughput contract', () => {
  it('creates an isolated six-minute 24-ledger-per-minute state boundary', () => {
    for (const required of [
      'create schema if not exists xrpl_steady_v1',
      'create table if not exists xrpl_steady_v1.sessions',
      'create table if not exists xrpl_steady_v1.ticks',
      'create table if not exists xrpl_steady_v1.works',
      'create table if not exists xrpl_steady_v1.messages',
      'create table if not exists xrpl_steady_v1.successors',
      'create table if not exists xrpl_steady_v1.payload_chunks',
      'create table if not exists xrpl_steady_v1.reference_rows',
      'create table if not exists xrpl_steady_v1.commit_chunks',
      "target_ticks integer not null check (target_ticks = 6)",
      "batch_size integer not null check (batch_size = 24)",
      "target_profile_id = 'supabase-devnet-steady-qualification'",
      "source_profile_id = 'supabase-devnet'",
      "network = 'devnet'",
      "epoch_id = 'supabase-r4c2c-v1'",
      'create unique index if not exists xrpl_steady_one_running_session_idx',
      'revoke all on schema xrpl_steady_v1 from public, anon, authenticated',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('claims one exact minute and atomically completes 24 full-phase works', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_network_steady_tick',
      "v_minute := date_trunc('minute', p_scheduled_at)",
      'v_start := v_session.watermark_ledger_index + 1',
      'v_end := v_start + v_session.batch_size - 1',
      'create or replace function public.xrpl_complete_network_steady_tick',
      'jsonb_array_length(v_works) <> 24',
      "raise exception 'steady work identity or continuity mismatch at ordinal %'",
      "raise exception 'steady payload chunk mismatch at work % chunk %'",
      "raise exception 'steady reference-row digest mismatch at work % chunk %'",
      "'scan'",
      "'commit'",
      "'finalize'",
      'insert into xrpl_steady_v1.successors',
      "work_count = 24",
      'watermark_ledger_index = v_last_index',
      "status = case when v_session_completed_ticks = target_ticks then 'completed' else 'running' end",
      'create or replace function public.xrpl_fail_network_steady_tick',
      "status = 'halted'",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('runs from internal pg_cron with Vault service-role authentication', () => {
    for (const required of [
      "'xrpl-lending-monitor-steady-qualification-minute'",
      "'* * * * *'",
      "'/functions/v1/xrpl-steady-batch-tick'",
      "where name = 'xrpl_project_url'",
      "where name = 'xrpl_secret_key'",
      "'apikey'",
      "'source', 'pg_cron'",
      'timeout_milliseconds := 50000',
      'cron.unschedule',
    ]) {
      expect(migration).toContain(required)
    }
    expect(workflow).not.toContain('  schedule:')
  })

  it('fetches and normalizes 24 bounded real Devnet ledgers before one DB commit', () => {
    for (const required of [
      "const DEFAULT_XRPL_DEVNET_RPC_URL = 'https://s.devnet.rippletest.net:51234/'",
      'const BATCH_SIZE = 24',
      'const FETCH_CONCURRENCY = 2',
      'const MAX_SERVER_INFO_RESPONSE_BYTES = 256 * 1024',
      'const MAX_LEDGER_RESPONSE_BYTES = 1024 * 1024',
      'boundedResponseText',
      'readValidatedHead(endpoint, meter)',
      'readExactLedger(endpoint, ledgerIndex, meter)',
      "'server_info'",
      "'ledger'",
      'transactions: true',
      'expand: true',
      'parseValidatedLedgerResult',
      'isLendingTransactionType',
      'buildPortableCollectorWorkId',
      'buildPortableXrplNormalizedWork',
      'portableReferenceRowsFromChunk',
      'ledger.parentHash !== expectedParentHash',
      "'xrpl_complete_network_steady_tick'",
      "body.source !== 'pg_cron'",
      "request.headers.get('apikey') !== secretKey",
    ]) {
      expect(tick).toContain(required)
    }
    expect(tick).not.toContain('MAINNET')
    expect(tick).not.toContain("method: 'submit'")
  })

  it('converges the next-minute pending scan reservation', () => {
    for (const required of [
      'create or replace function xrpl_steady_v1.replace_pending_scan_before_insert()',
      "new.phase = 'scan' and new.status = 'completed'",
      "status = 'pending'",
      'attempt_count = 0',
      'before insert on xrpl_steady_v1.messages',
    ]) {
      expect(pendingScan).toContain(required)
    }
  })

  it('uses a token-gated prepare/read control surface', () => {
    for (const required of [
      "const PURPOSE = 'r4c2d-network-steady-throughput'",
      "action === 'prepare'",
      "'xrpl_prepare_network_steady_session'",
      "action === 'read'",
      "'xrpl_read_network_steady_session'",
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
      "request.headers.get(PURPOSE_HEADER) !== PURPOSE",
    ]) {
      expect(control).toContain(required)
    }
  })

  it('requires six consecutive 24-ledger buckets and binds the retained catch-up pass', () => {
    for (const required of [
      'const steadyThreshold = 21',
      'const catchUpThreshold = 30',
      'workflowRunId: 30755497115',
      "artifactDigest: 'sha256:05ab7a8199a13fb5577bd8d1d1f135363974c73501661409c9daa0eb516f2c07'",
      'p95CommittedLedgersPerMinute: 14178.400673920027',
      "session.status !== 'completed'",
      'session.completedTicks !== 6',
      'session.committedLedgers !== 144',
      'scheduled - previous !== 60_000',
      'tick.workCount !== 24',
      'tick.edgeWallMilliseconds',
      '>= 50_000',
      'steadyObservedPass && catchUpObservedPass',
      'sixConsecutiveMinuteBuckets: true',
      'networkFetchAndNormalizationMeasured: true',
      'fullPhaseAtomicBatchMeasured: true',
      'g7Qualified: true',
      'g8Qualified: false',
      'profileSelected: false',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
    ]) {
      expect(verifier).toContain(required)
    }
  })

  it('retains functions 12 and 13 in the historical guarded workflow contract', () => {
    expect(config).toContain('[functions.xrpl-steady-batch-tick]')
    expect(config).toContain('[functions.xrpl-steady-throughput-qualification]')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(9)
    expect(config.match(/verify_jwt=false/g)).toHaveLength(4)
    for (const required of [
      "'supabase/functions/xrpl-steady-batch-tick/index.ts'",
      'steady-batch-tick-bundle.json',
      "'supabase/functions/xrpl-steady-throughput-qualification/index.ts'",
      'steady-throughput-qualification-bundle.json',
      'supabase functions deploy xrpl-steady-batch-tick',
      'supabase functions deploy xrpl-steady-throughput-qualification',
      'node scripts/verify-supabase-steady-throughput-with-retry.mjs',
      'verified-steady-throughput.json',
      'failed-steady-throughput-verification.json',
      'steady throughput verifier: `success`',
      'node scripts/publish-supabase-run-locator.mjs',
      'gh issue comment 1109',
      'cancel-in-progress: false',
    ]) {
      expect(workflow).toContain(required)
    }
    expect(workflow.match(/supabase secrets set XRPL_READER_VERIFY_TOKEN/g)).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1109/g)).toHaveLength(1)
  })

  it('retains a sanitized steady result formatter', () => {
    for (const required of [
      'verified-steady-throughput.json',
      'failed-steady-throughput-verification.json',
      'steady throughput verifier',
      'steady minute rates',
      'G7 qualified',
      'G8 qualified',
      'active profile read only',
    ]) {
      expect(publisher).toContain(required)
    }
  })
})
