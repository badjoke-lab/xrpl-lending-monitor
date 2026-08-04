import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const repairPath =
  'supabase/migrations/20260803123150_xrpl_r5_recovery_retained_head_claim_repair.sql'
const canonicalPath =
  'supabase/migrations/20260803123200_xrpl_r5_recovery_retained_head_claim.sql'
const repair = read(repairPath)
const canonical = read(canonicalPath)

describe('R5 retained-head claim migration repair', () => {
  it('runs immediately before the canonical retained-head migration', () => {
    const repairTimestamp = Number(repairPath.match(/migrations\/(\d{14})_/u)?.[1])
    const canonicalTimestamp = Number(canonicalPath.match(/migrations\/(\d{14})_/u)?.[1])
    expect(Number.isSafeInteger(repairTimestamp)).toBe(true)
    expect(Number.isSafeInteger(canonicalTimestamp)).toBe(true)
    expect(repairTimestamp).toBeLessThan(canonicalTimestamp)
    expect(canonicalTimestamp - repairTimestamp).toBe(50)
  })

  it('drops only the orphanable exact function signature', () => {
    expect(repair).toContain(
      'drop function if exists public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    )
    for (const argument of ['text,', 'timestamptz,', 'integer']) {
      expect(repair).toContain(argument)
    }
    expect(repair.match(/drop function/giu)).toHaveLength(1)
    expect(repair).not.toContain('cascade')
    expect(repair).not.toContain('drop table')
    expect(repair).not.toContain('delete from')
  })

  it('lets the canonical migration restore implementation and grants', () => {
    for (const required of [
      'create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      'security definer',
      'reservationBeforeAnyNetworkRead',
      'freshHeadMustCoverReservedEndBeforeFetch',
      'revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      "rolname = 'supabase_admin'",
    ]) {
      expect(canonical).toContain(required)
    }
  })
})
