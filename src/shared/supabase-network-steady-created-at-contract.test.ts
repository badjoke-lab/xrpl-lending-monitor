import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803031000_xrpl_network_steady_created_at_fallback.sql',
)

describe('Supabase network steady reference-row timestamp fallback', () => {
  it('fills only missing isolated qualification timestamps before insert', () => {
    for (const required of [
      'create or replace function xrpl_steady_v1.fill_reference_row_created_at()',
      'if new.created_at is null then',
      'new.created_at := clock_timestamp()',
      'before insert on xrpl_steady_v1.reference_rows',
      'execute function xrpl_steady_v1.fill_reference_row_created_at()',
      'Qualification-only fallback',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('does not mutate active phase or public reader state', () => {
    expect(migration).not.toContain('public.xrpl_phase_reference_rows')
    expect(migration).not.toContain('update public.xrpl_phase_')
    expect(migration).not.toContain('delete from public.xrpl_phase_')
    expect(migration).not.toContain('MAINNET')
  })
})
