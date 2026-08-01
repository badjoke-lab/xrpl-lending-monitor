import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

describe('R4C2 Supabase remote probe contract', () => {
  const migration = read(
    'supabase/migrations/20260802002000_xrpl_remote_collector_probe.sql',
  )
  const edgeFunction = read('supabase/functions/xrpl-collector-tick/index.ts')
  const config = read('supabase/config.toml')
  const setup = read('docs/ops/supabase-one-time-setup-2026-08-02.md')

  it('keeps the remote probe Devnet-only and fail-closed', () => {
    expect(edgeFunction).toContain('https://s.devnet.rippletest.net:51234/')
    expect(edgeFunction).toContain("request.headers.get('apikey') !== secretKey")
    expect(edgeFunction).toContain("request.method === 'GET'")
    expect(edgeFunction).toContain("request.method !== 'POST'")
    expect(edgeFunction).toContain('AbortSignal.timeout(8_000)')
    expect(edgeFunction).not.toContain('xrplcluster.com')
    expect(edgeFunction).not.toContain('MAINNET')
  })

  it('binds cron, vault, leases, RLS, and transactional RPC functions', () => {
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
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('YOUR_PROJECT_SECRET_KEY')
    expect(migration).not.toContain('service_role key')
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
