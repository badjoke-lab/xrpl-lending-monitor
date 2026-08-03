import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803104000_xrpl_revision3_attempt_backfill_and_wrapper_reserve.sql',
  ),
  'utf8',
)

describe('Supabase revision-3 attempt seam accounting', () => {
  it('adds a fixed wrapper reserve to successful downstream accounting', () => {
    for (const required of [
      'create or replace function xrpl_resource_guard_v2.apply_wrapper_success_reserve()',
      'v_wrapper_reserve constant bigint := 4194304',
      "old.status = 'open' and new.status = 'succeeded'",
      'new.finalized_egress_upper_bound_bytes + v_wrapper_reserve',
      'new.finalized_egress_upper_bound_bytes >= 33554432',
      "raise exception 'revision3_wrapper_egress_halt'",
      'before update on xrpl_resource_guard_v2.attempts',
    ]) expect(migration).toContain(required)
  })

  it('backfills pre-attempt accounting with the full crash reservation', () => {
    for (const required of [
      'insert into xrpl_resource_guard_v2.attempts',
      "'r4c3-backfill:'",
      "'failed'",
      '134217728',
      "'legacy_tick_accounting_conservative_backfill'",
      'from xrpl_resource_guard_v2.tick_accounting accounting',
      'join xrpl_steady_v1.ticks tick',
      'left join xrpl_resource_guard_v2.attempts existing',
      'where existing.session_id is null',
      'on conflict (session_id, scheduled_minute) do nothing',
    ]) expect(migration).toContain(required)
  })
})
