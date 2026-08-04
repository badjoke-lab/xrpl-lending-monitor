import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const tombstonePath =
  'supabase/migrations/20260803123150_xrpl_r5_recovery_retained_head_claim_repair.sql'
const canonicalPath =
  'supabase/migrations/20260803123200_xrpl_r5_recovery_retained_head_claim.sql'
const repairPath =
  'supabase/migrations/20260803123300_xrpl_r5_recovery_retained_head_claim_forward_repair.sql'
const tombstone = read(tombstonePath)
const canonical = read(canonicalPath)
const repair = read(repairPath)

describe('R5 retained-head claim migration-history repair', () => {
  it('retains the exact remote-recorded version as a no-op tombstone', () => {
    expect(tombstonePath).toContain('20260803123150')
    expect(tombstone).toContain('Migration-history tombstone')
    expect(tombstone).toContain('forward-only functional repair is migration 20260803123300')
    expect(tombstone).toContain('null;')
    for (const forbidden of [
      'create ',
      'drop ',
      'alter ',
      'grant ',
      'revoke ',
      'insert ',
      'update ',
      'delete ',
      'truncate ',
    ]) {
      expect(tombstone.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('orders tombstone, canonical record, and forward repair exactly', () => {
    const tombstoneTimestamp = Number(tombstonePath.match(/migrations\/(\d{14})_/u)?.[1])
    const canonicalTimestamp = Number(canonicalPath.match(/migrations\/(\d{14})_/u)?.[1])
    const repairTimestamp = Number(repairPath.match(/migrations\/(\d{14})_/u)?.[1])
    expect(Number.isSafeInteger(tombstoneTimestamp)).toBe(true)
    expect(Number.isSafeInteger(canonicalTimestamp)).toBe(true)
    expect(Number.isSafeInteger(repairTimestamp)).toBe(true)
    expect(canonicalTimestamp - tombstoneTimestamp).toBe(50)
    expect(repairTimestamp - canonicalTimestamp).toBe(100)
  })

  it('drops only the exact orphaned signature without destructive propagation', () => {
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
    expect(repair).not.toContain('truncate ')
  })

  it('recreates the exact canonical implementation and grants', () => {
    const canonicalStart = canonical.indexOf(
      'create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    )
    const repairStart = repair.indexOf(
      'create or replace function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
    )
    expect(canonicalStart).toBeGreaterThanOrEqual(0)
    expect(repairStart).toBeGreaterThanOrEqual(0)
    expect(repair.slice(repairStart)).toBe(canonical.slice(canonicalStart))
    for (const required of [
      'security definer',
      'reservationBeforeAnyNetworkRead',
      'freshHeadMustCoverReservedEndBeforeFetch',
      'revoke all on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      'grant execute on function public.xrpl_claim_r5_active_recovery_batch_from_prepared_head(',
      "rolname = 'supabase_admin'",
    ]) {
      expect(repair).toContain(required)
    }
  })
})
