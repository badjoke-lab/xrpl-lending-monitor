import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260802235000_xrpl_restore_continuation_reference_time_fix.sql',
  ),
  'utf8',
)

describe('Supabase restored continuation reference timestamp correction', () => {
  it('preserves exact durable source-row timestamps on future restored inserts', () => {
    for (const required of [
      'create or replace function xrpl_restore_continuation_v1.preserve_source_reference_created_at()',
      'from public.xrpl_phase_reference_rows as rows',
      'rows.work_id = new.work_id',
      'rows.semantic_class = new.semantic_class',
      'rows.canonical_key = new.canonical_key',
      'new.created_at := v_source_created_at',
      'before insert or update of work_id, semantic_class, canonical_key',
      'execute function xrpl_restore_continuation_v1.preserve_source_reference_created_at()',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('repairs the already committed isolated qualification rows and fails closed on mismatch', () => {
    for (const required of [
      "fixture_id = 'r4c2c-post-restore-continuation-v1'",
      'update xrpl_restore_continuation_v1.xrpl_phase_reference_rows as target',
      'set created_at = source.created_at',
      'target.created_at is distinct from source.created_at',
      'left join public.xrpl_phase_reference_rows as source',
      'source.work_id is null',
      "raise exception 'restore continuation reference timestamp parity remains incomplete: %'",
    ]) {
      expect(migration).toContain(required)
    }
    expect(migration).not.toContain('update public.xrpl_phase_reference_rows')
    expect(migration).not.toContain('delete from public.xrpl_phase_reference_rows')
  })
})
