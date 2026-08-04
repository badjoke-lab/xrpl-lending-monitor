import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260803123900_xrpl_r5_completion_preserve_scan_retry.sql',
)

describe('R5 completion pending-scan retry preservation contract', () => {
  it('targets only the exact atomic completion signature', () => {
    for (const required of [
      'public.xrpl_complete_r5_active_recovery_batch(text,text,text,timestamp with time zone,text,text,text,text,bigint,numeric,numeric,numeric)',
      'to_regprocedure(v_signature)',
      'pg_get_functiondef(v_function)',
      'r5_completion_preserve_scan_retry_function_missing',
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('removes exactly one obsolete zero-attempt clause', () => {
    for (const required of [
      "v_forbidden constant text := E'    or v_pending_scan.attempt_count <> 0\\n'",
      "length(v_definition) - length(replace(v_definition, v_forbidden, ''))",
      'v_removed_bytes <> length(v_forbidden)',
      'r5_completion_preserve_scan_retry_exact_clause_missing',
      "v_updated := replace(v_definition, v_forbidden, '')",
      'execute v_updated',
      "position('v_pending_scan.attempt_count <> 0' in v_definition) <> 0",
    ]) {
      expect(migration).toContain(required)
    }
  })

  it('retains every actual pending-scan identity and boundary check', () => {
    for (const required of [
      'r5_recovery_batch_completion_pending_scan_invalid',
      "(v_pending_scan.payload->>''expectedPreviousLedgerIndex'')::bigint",
      "upper(v_pending_scan.payload->>''expectedPreviousLedgerHash'')",
      "v_pending_scan.payload->>''epochId'' <> v_run.epoch_id",
      "v_pending_scan.payload->>''baseIdentity'' <> v_run.base_identity",
      'r5_completion_preserve_scan_retry_boundary_contract_changed',
      'r5_completion_preserve_scan_retry_replacement_invalid',
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
    ]) {
      expect(migration.toLowerCase()).not.toContain(forbidden.toLowerCase())
    }
  })
})
