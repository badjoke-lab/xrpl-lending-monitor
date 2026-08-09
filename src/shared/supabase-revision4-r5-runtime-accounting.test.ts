import { describe, expect, it } from 'vitest'

import {
  buildSupabaseRevision4R5RuntimeAccounting,
  evaluateSupabaseRevision4R5Cadence,
} from './supabase-revision4-r5-runtime-accounting'

describe('revision-4 R5 runtime accounting', () => {
  it('keeps the 12-ledger claim cap while proving 24/min steady and 36/min catch-up capacity', () => {
    expect(evaluateSupabaseRevision4R5Cadence()).toEqual({
      steadyLedgersPerMinute: 24,
      catchupLedgersPerMinute: 36,
      steadyInvocations31d: 89_280,
      catchupInvocations31d: 133_920,
      steadyQualified: true,
      catchupQualified: true,
      steadyInvocationGuardQualified: true,
      catchupInvocationGuardQualified: true,
      maximumAverageBillableEgressBytesPerLedgerAtRequiredSteadyDemand: 4_581,
    })
  })

  it('excludes inbound XRPL responses from rolling billable egress while retaining them in memory transport', async () => {
    const evidence = await buildSupabaseRevision4R5RuntimeAccounting({
      observationId: 'r5.rev4.runtime.0001',
      attemptId: 'r5.rev4.runtime.attempt.0001',
      observedAt: '2026-08-09T12:00:00.000Z',
      invokerRequestBytes: 64,
      invokerRequestCount: 1,
      xrplRequestBytes: 617,
      xrplRequestCount: 2,
      xrplResponseBytes: 17_672,
      xrplResponseCount: 2,
      databaseRequestBytes: 900,
      databaseRequestCount: 2,
      databaseResponseBytes: 700,
      databaseResponseCount: 2,
      invokerResponseBytes: 256,
      invokerResponseCount: 1,
      canonicalJsonBytes: 2_000,
      payloadBytes: 1_000,
      normalizedObjectOverheadBytes: 512,
      allocatorReserveBytes: 8_388_608,
      unexplainedDirectionalDeltaReserveBytes: 0,
    })

    const xrplInbound = evidence.accounting.directionalSummary.byBoundary.find(
      (row) => row.boundaryId === 'xrpl_to_edge_response',
    )
    expect(xrplInbound?.rollingBillableEgressBytes).toBe(0)
    expect(xrplInbound?.memoryTransportBytes).toBe(19_720)
    expect(evidence.accounting.checks.blanketAllDirectionMultiplierUsed).toBe(false)
  })

  it('counts only measured caller-response bytes plus framing instead of the revision-3 128 KiB response reservation', async () => {
    const evidence = await buildSupabaseRevision4R5RuntimeAccounting({
      observationId: 'r5.rev4.runtime.0002',
      attemptId: 'r5.rev4.runtime.attempt.0002',
      observedAt: '2026-08-09T12:01:00.000Z',
      invokerRequestBytes: 32,
      invokerRequestCount: 1,
      xrplRequestBytes: 0,
      xrplRequestCount: 0,
      xrplResponseBytes: 0,
      xrplResponseCount: 0,
      databaseRequestBytes: 0,
      databaseRequestCount: 0,
      databaseResponseBytes: 0,
      databaseResponseCount: 0,
      invokerResponseBytes: 256,
      invokerResponseCount: 1,
      canonicalJsonBytes: 0,
      payloadBytes: 0,
      normalizedObjectOverheadBytes: 0,
      allocatorReserveBytes: 0,
      unexplainedDirectionalDeltaReserveBytes: 0,
    })

    const callerResponse = evidence.accounting.directionalSummary.byBoundary.find(
      (row) => row.boundaryId === 'edge_to_invoker_response',
    )
    expect(callerResponse?.rollingBillableEgressBytes).toBe(1_280)
    expect(callerResponse?.rollingBillableEgressBytes).toBeLessThan(128 * 1024)
  })
})
