import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803121500_xrpl_r5_management_api_execute.sql',
)

describe('R5 Supabase Management API execute grants', () => {
  it('grants mutating R5 RPCs only to the Supabase administrative query role', () => {
    for (const required of [
      "exists (select 1 from pg_roles where rolname = 'supabase_admin')",
      'grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz) to supabase_admin',
      'grant execute on function public.xrpl_prepare_r5_active_recovery(text, text, text, bigint, text, timestamptz) to supabase_admin',
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain(
      'grant execute on function public.xrpl_create_r5_active_checkpoint(text, timestamptz) to supabase_read_only_user',
    )
    expect(migration).not.toContain(
      'grant execute on function public.xrpl_prepare_r5_active_recovery(text, text, text, bigint, text, timestamptz) to supabase_read_only_user',
    )
  })

  it('allows both Management API roles to read only sanitized checkpoint and recovery summaries', () => {
    for (const required of [
      'grant execute on function public.xrpl_read_r5_active_checkpoint(text) to supabase_admin',
      'grant execute on function public.xrpl_read_r5_active_recovery(text) to supabase_admin',
      "exists (select 1 from pg_roles where rolname = 'supabase_read_only_user')",
      'grant execute on function public.xrpl_read_r5_active_checkpoint(text) to supabase_read_only_user',
      'grant execute on function public.xrpl_read_r5_active_recovery(text) to supabase_read_only_user',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('keeps every R5 RPC unavailable to public application roles', () => {
    for (const signature of [
      'public.xrpl_create_r5_active_checkpoint(text, timestamptz)',
      'public.xrpl_read_r5_active_checkpoint(text)',
      'public.xrpl_prepare_r5_active_recovery(\n  text, text, text, bigint, text, timestamptz\n)',
      'public.xrpl_read_r5_active_recovery(text)',
    ]) {
      expect(migration).toContain(signature)
    }
    expect(migration.match(/from public, anon, authenticated/g)).toHaveLength(4)
    expect(migration).not.toContain(' to anon')
    expect(migration).not.toContain(' to authenticated')
    expect(migration).not.toContain(' to public')
  })

  it('does not expose private tables, checkpoint state, or later-phase authorization', () => {
    expect(migration).not.toContain('grant select on')
    expect(migration).not.toContain('active_checkpoints to')
    expect(migration).not.toContain('recovery_runs to')
    expect(migration).not.toContain('stabilizationAuthorized')
    expect(migration).not.toContain('soakAuthorized')
    expect(migration).not.toContain("network = 'mainnet'")
  })
})
