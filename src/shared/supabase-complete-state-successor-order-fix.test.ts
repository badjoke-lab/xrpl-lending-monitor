import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260802223000_xrpl_complete_state_successor_order_fix.sql',
  ),
  'utf8',
)

describe('Supabase complete-state successor ordering correction', () => {
  it('redefines both canonical state builders against the real successor schema', () => {
    expect(migration).toContain(
      'create or replace function public.xrpl_build_source_complete_state()',
    )
    expect(migration).toContain(
      'create or replace function public.xrpl_build_restored_complete_state()',
    )
    expect(migration.match(/rows\.successor_message_id/g)).toHaveLength(2)
    expect(migration).not.toContain('rows.next_message_id')
  })

  it('preserves the isolated source and typed restore namespaces', () => {
    expect(migration).toContain(
      "v_profile_id constant text := 'supabase-devnet-multichunk-witness'",
    )
    expect(migration).toContain('from public.xrpl_phase_successors as rows')
    expect(migration).toContain(
      'from xrpl_restore_v1.xrpl_phase_successors as rows',
    )
    expect(migration).toContain(
      "where target_id = 'supabase-devnet-transfer-restore-v1'",
    )
  })
})
