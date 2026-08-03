import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260803110000_xrpl_revision3_transfer_read_barrier.sql',
  ),
  'utf8',
)

describe('Supabase revision-3 transfer read barrier contract', () => {
  it('wraps the existing accounting read without changing its public RPC name', () => {
    for (const required of [
      'alter function public.xrpl_read_revision3_session_accounting(text)',
      'rename to xrpl_read_revision3_session_accounting_unbarriered',
      'create or replace function public.xrpl_read_revision3_session_accounting(',
      'v_result := public.xrpl_read_revision3_session_accounting_unbarriered(p_session_id)',
      'grant execute on function public.xrpl_read_revision3_session_accounting(text)',
    ]) expect(migration).toContain(required)
  })

  it('waits only for a guarded completed session whose transfer is still unqualified', () => {
    for (const required of [
      'for v_attempt in 1..40',
      "coalesce((v_result->>'resourceGuardEnabled')::boolean, false) is not true",
      "coalesce(v_result->>'sessionStatus', '') <> 'completed'",
      "v_result #>> '{checks,resourceAccountingStateTransferQualified}'",
      'perform pg_sleep(0.25)',
    ]) expect(migration).toContain(required)
  })

  it('keeps the barrier bounded and returns the unqualified result fail-closed', () => {
    expect(migration).toContain('return v_result;')
    expect(migration.match(/return v_result;/g)).toHaveLength(2)
    expect(migration).toContain('for v_attempt in 1..40')
    expect(migration).toContain('perform pg_sleep(0.25)')
    expect(migration).not.toContain('while true')
  })
})
