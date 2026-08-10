import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateSupabaseRevision4R5Cadence } from './supabase-revision4-r5-runtime-accounting'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const migration = read(
  'supabase/migrations/20260810123000_xrpl_r5_revision4_per_ledger_egress_gate.sql',
)
const executor = read('supabase/functions/xrpl-r5-recovery-batch/index.ts')

describe('revision-4 R5 per-ledger billable-egress gate', () => {
  it('binds the database reservation to the cadence-derived 4,581 byte per-ledger ceiling', () => {
    const cadence = evaluateSupabaseRevision4R5Cadence()

    expect(cadence.maximumAverageBillableEgressBytesPerLedgerAtRequiredSteadyDemand).toBe(4_581)
    expect(cadence.steadyLedgersPerMinute).toBe(24)

    expect(migration).toContain('maximum_billable_egress_bytes_per_ledger = 4581')
    expect(migration).toContain('maximum_claim_billable_egress_bytes = 54972')
    expect(migration).toContain('maximum_claim_exclusive_reservation_bytes = 54973')
    expect(migration).toContain('select p_ledger_count::bigint * 4581')
  })

  it('uses a one-byte-exclusive reservation because the executor halts on equality', () => {
    expect(migration).toContain(
      'select xrpl_r5_v1.revision4_billable_egress_budget_bytes(p_ledger_count) + 1',
    )
    expect(executor).toContain(
      'accounting.rollingBillableEgressUpperBoundBytes\n          >= claim.reservedEgressUpperBoundBytes',
    )

    for (let ledgerCount = 1; ledgerCount <= 12; ledgerCount += 1) {
      const inclusiveBudget = ledgerCount * 4_581
      const exclusiveReservation = inclusiveBudget + 1
      expect(exclusiveReservation - 1).toBe(inclusiveBudget)
    }
    expect(12 * 4_581).toBe(54_972)
    expect(12 * 4_581 + 1).toBe(54_973)
  })

  it('moves the dynamic reservation before the monthly egress halt and removes the old 16 MiB claim reserve', () => {
    expect(migration).toContain("v_old_declaration constant text := 'v_reserved constant bigint := 16777216;'")
    expect(migration).toContain("v_new_declaration constant text := 'v_reserved bigint := 0;'")
    expect(migration).toContain(
      "'v_reserved := xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(v_count);'",
    )
    expect(migration).toContain('v_budget_preamble || v_monthly_guard')
    expect(migration).toContain('r5_revision4_egress_gate_active_batch_present')
    expect(migration).toContain('r5_revision4_egress_gate_source_definition_drift')
    expect(migration).toContain('r5_revision4_egress_gate_patch_verification_failed')
  })

  it('retains historical revision-4 rows while enforcing the exact budget on future writes', () => {
    expect(migration).toContain('xrpl_r5_revision4_future_egress_budget_check')
    expect(migration).toContain('ledger_count between 1 and 12')
    expect(migration).toContain(') not valid;')
    expect(migration).toContain(
      'reserved_egress_upper_bound_bytes =\n        xrpl_r5_v1.revision4_egress_exclusive_reservation_bytes(ledger_count)',
    )
    expect(migration).not.toContain('delete from xrpl_r5_v1.recovery_batches')
    expect(migration).not.toContain('truncate table xrpl_r5_v1.recovery_batches')
  })
})
