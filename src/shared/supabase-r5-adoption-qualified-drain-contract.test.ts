import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803124000_xrpl_r5_adoption_allow_qualified_drain.sql',
)

describe('R5 adoption qualified boundary drain contract', () => {
  it('targets only the exact active descendant adoption signature', () => {
    for (const required of [
      'public.xrpl_adopt_r5_committed_active_descendants(text,timestamp with time zone)',
      'to_regprocedure(v_signature)',
      'pg_get_functiondef(v_function)',
      'r5_adoption_qualified_drain_function_missing',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('replaces exactly one obsolete zero-step restriction', () => {
    for (const required of [
      "v_old constant text := E'    or (v_boundary->>''drainedStepCount'')::integer <> 0\\n'",
      "length(v_definition) - length(replace(v_definition, v_old, ''))",
      'v_removed_bytes <> length(v_old)',
      'r5_adoption_qualified_drain_exact_clause_missing',
      'v_updated := replace(v_definition, v_old, v_new)',
      'execute v_updated',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('permits only a bounded qualified commit or finalize drain', () => {
    for (const required of [
      "(v_boundary->>''drainedStepCount'')::integer < 0",
      "(v_boundary->>''drainedStepCount'')::integer > 256",
      "onlyExistingCommitOrFinalizeDrained",
      "position('(v_boundary ->> ''drainedStepCount''::text)::integer < 0' in v_definition) = 0",
      "position('(v_boundary ->> ''drainedStepCount''::text)::integer > 256' in v_definition) = 0",
      'r5_adoption_qualified_drain_replacement_invalid',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains the canonical no-scan quiescent boundary checks', () => {
    for (const required of [
      'public.xrpl_drain_r5_checkpoint_boundary',
      'noScanExecuted',
      'onePendingScan',
      'pendingScanBoundToWatermark',
      'noInflightWork',
      'r5_recovery_adoption_boundary_invalid',
      'r5_adoption_qualified_drain_boundary_contract_changed',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('restores only the existing trusted execution grants', () => {
    for (const required of [
      'from public, anon, authenticated',
      'to service_role',
      "rolname = 'supabase_admin'",
      'to supabase_admin',
    ]) {
      expect(migration).toContain(required)
    }
    for (const forbidden of [
      'grant execute to anon',
      'grant execute to authenticated',
      'drop function',
      'drop table',
      'delete from',
      'truncate ',
      'cascade',
      'mainnet',
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
