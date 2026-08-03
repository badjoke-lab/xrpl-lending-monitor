import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803104500_xrpl_revision3_server_completion_timestamp.sql',
  ),
  'utf8',
)

describe('Supabase revision-3 server completion ordering', () => {
  it('uses one database statement timestamp for precommit and persisted completion', () => {
    for (const required of [
      'create or replace function xrpl_resource_guard_v2.enforce_completed_tick()',
      'v_completion_time timestamptz := statement_timestamp()',
      'v_accounting.recorded_at > v_completion_time',
      'v_accounting.created_at > v_completion_time',
      'new.completed_at := v_completion_time',
      "raise exception 'revision3_resource_accounting_precommit'",
    ]) expect(migration).toContain(required)
  })

  it('retains exact revision identity and every resource halt', () => {
    for (const required of [
      'v_accounting.profile_revision <> 3',
      "<> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      'v_accounting.conservative_memory_upper_bound_bytes >= 234881024',
      'v_accounting.conservative_tick_egress_upper_bound_bytes >= 33554432',
      'v_accounting.conservative_egress_31d_upper_bound_bytes >= 4294967296',
      'v_accounting.projected_invocations_31d >= 400000',
    ]) expect(migration).toContain(required)
  })

  it('does not trust the caller-provided completion timestamp for guarded ticks', () => {
    expect(migration).not.toContain(
      'v_accounting.recorded_at > coalesce(new.completed_at, clock_timestamp())',
    )
    expect(migration).not.toContain('new.completed_at := coalesce(new.completed_at')
  })
})
