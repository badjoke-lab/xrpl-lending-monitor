import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803010000_xrpl_throughput_resource_baseline.sql',
)
const edge = read('supabase/functions/xrpl-throughput-resource-baseline/index.ts')
const verifier = read('scripts/verify-supabase-throughput-resource-baseline.mjs')
const publisher = read('scripts/publish-supabase-run-locator.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')
const config = read('supabase/config.toml')

describe('Supabase R4C2d throughput and resource baseline contract', () => {
  it('measures fixed 60m, 6h, and 24h committed-throughput windows with zero buckets', () => {
    for (const required of [
      'create or replace function public.xrpl_read_throughput_resource_baseline',
      'p_window_minutes not in (60, 360, 1440)',
      'generate_series(',
      "date_trunc('minute', v_window_start)",
      "date_trunc('minute', p_observed_at) - interval '1 minute'",
      'coalesce(committed.ledgers, 0)',
      'averageLedgersPerMinute',
      'p50LedgersPerMinute',
      'p95LedgersPerMinute',
      'maxLedgersPerMinute',
      "'steadyThreshold', 21",
      "'catchUpThreshold', 30",
      "'steadyP95Passed', p95_ledgers_per_minute > 21",
      "'catchUpAveragePassed', average_ledgers_per_minute > 30",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('measures latency, attempts, storage, rows, payloads, scheduler, and connections', () => {
    for (const required of [
      "'p50Milliseconds'",
      "'p95Milliseconds'",
      "'maxMilliseconds'",
      "'p50Attempts'",
      "'p95Attempts'",
      "'maxAttempts'",
      'pg_database_size(current_database())',
      "pg_total_relation_size('public.xrpl_phase_messages'::regclass)",
      "'phaseMessages'",
      "'payloadChunks'",
      "'referenceRows'",
      "'configuredCeilingBytes', 512000",
      "'configuredCeilingBytes', 16000",
      "from pg_stat_activity",
      "current_setting('max_connections')::integer",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('does not overstate unmeasured G8 surfaces or mutate the active profile', () => {
    for (const required of [
      "'edgeCpu', false",
      "'edgeMemory', false",
      "'edgeInvocationCount', false",
      "'bandwidth', false",
      "'billingAndOverage', false",
      "v_profile_id constant text := 'supabase-devnet'",
      "v_stream.status <> 'active'",
      "v_stream.network <> 'devnet'",
      "v_stream.epoch_id <> 'supabase-r4c2c-v1'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('update public.xrpl_phase_')
    expect(migration).not.toContain('delete from public.xrpl_phase_')
  })

  it('uses a token-gated read-only Edge verifier and leaves G7/G8 unqualified', () => {
    for (const required of [
      "const PURPOSE = 'r4c2d-throughput-resource-baseline'",
      'const WINDOWS = [60, 360, 1440] as const',
      "'xrpl_read_throughput_resource_baseline'",
      'verifyActiveIsolation(activeBefore, activeAfter)',
      'catchUpModeMeasured: false',
      'g7Qualified: false',
      'g8Qualified: false',
      "request.headers.get(VERIFY_TOKEN_HEADER) !== env('XRPL_READER_VERIFY_TOKEN')",
    ]) {
      expect(edge).toContain(required)
    }
    expect(edge).not.toContain('MAINNET')
    expect(edge).not.toContain("method: 'submit'")
  })

  it('retains sanitized baseline and credential evidence', () => {
    for (const required of [
      'verified-throughput-resource-baseline.json',
      'failed-throughput-resource-baseline-verification.json',
      'missingTokenRejected: true',
      'wrongPurposeRejected: true',
      'threeWindowsMeasured',
      'zeroMinuteBucketsIncluded',
      'coverageNotOverstated',
      'activeWatermarkBefore',
      'activeWatermarkAfter',
    ]) {
      expect(verifier).toContain(required)
    }
    expect(verifier).not.toContain('verifierToken: verifierToken')
    expect(publisher).toContain('throughput resource baseline verifier')
    expect(publisher).toContain('verified-throughput-resource-baseline.json')
    expect(publisher).toContain('failed-throughput-resource-baseline-verification.json')
  })

  it('deploys the tenth function through the existing single guarded workflow', () => {
    expect(config).toContain('[functions.xrpl-throughput-resource-baseline]')
    expect(config).toContain('verify_jwt=false')
    expect(config.match(/verify_jwt = false/g)).toHaveLength(9)
    for (const required of [
      "'supabase/functions/xrpl-throughput-resource-baseline/index.ts'",
      'throughput-resource-baseline-bundle.json',
      'supabase functions deploy xrpl-throughput-resource-baseline',
      'node scripts/verify-supabase-throughput-resource-baseline.mjs',
      'verified-throughput-resource-baseline.json',
      'failed-throughput-resource-baseline-verification.json',
      'throughput resource baseline verifier: `success`',
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
