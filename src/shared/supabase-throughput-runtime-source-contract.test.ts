import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803011000_xrpl_throughput_runtime_source.sql',
)

describe('Supabase throughput baseline runtime source correction', () => {
  it('projects the real collector runtime into the read-only baseline shape', () => {
    for (const required of [
      'create or replace view public.xrpl_probe_runtime as',
      'from public.xrpl_collector_runtime as runtime',
      "where runtime.profile_id = 'supabase-devnet'",
      'runtime.last_started_at as last_tick_at',
      'runtime.last_completed_at as last_success_at',
      'runtime.tick_count',
      'runtime.consecutive_failures',
      'runtime.last_error',
      'runtime.updated_at',
      'revoke all on public.xrpl_probe_runtime from public, anon, authenticated',
      'grant select on public.xrpl_probe_runtime to service_role',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('remains a read-only compatibility projection', () => {
    expect(migration).not.toContain('insert into public.xrpl_collector_runtime')
    expect(migration).not.toContain('update public.xrpl_collector_runtime')
    expect(migration).not.toContain('delete from public.xrpl_collector_runtime')
  })
})
