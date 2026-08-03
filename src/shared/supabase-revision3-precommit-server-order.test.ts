import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803103500_xrpl_revision3_precommit_server_order.sql',
  ),
  'utf8',
)

describe('Supabase revision-3 precommit server ordering', () => {
  it('proves accounting committed before completion with database time', () => {
    for (const required of [
      'create or replace function xrpl_resource_guard_v2.enforce_completed_tick()',
      'where session_id = new.session_id and tick_id = new.tick_id',
      'v_accounting.recorded_at > statement_timestamp()',
      'v_accounting.created_at > statement_timestamp()',
      "raise exception 'revision3_resource_accounting_precommit'",
    ]) expect(migration).toContain(required)

    expect(migration).not.toContain(
      'v_accounting.recorded_at > coalesce(new.completed_at, clock_timestamp())',
    )
  })

  it('retains identity and all conservative resource halts', () => {
    for (const required of [
      'v_accounting.profile_revision <> 3',
      "<> '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'",
      'v_accounting.conservative_memory_upper_bound_bytes >= 234881024',
      'v_accounting.conservative_tick_egress_upper_bound_bytes >= 33554432',
      'v_accounting.conservative_egress_31d_upper_bound_bytes >= 4294967296',
      'v_accounting.projected_invocations_31d >= 400000',
    ]) expect(migration).toContain(required)
  })
})
