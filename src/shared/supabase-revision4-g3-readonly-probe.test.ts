import { describe, expect, it } from 'vitest'

import { utf8ByteLength } from './supabase-revision4-directional-meter'
import {
  buildSupabaseRevision4G3ReadonlyProbeResponse,
  sha256HexBytes,
} from './supabase-revision4-g3-readonly-probe'

function probeInput() {
  const xrplRequestBody = JSON.stringify({
    method: 'ledger',
    params: [{ ledger_index: 4_200_000, transactions: true, expand: true }],
  })
  const xrplResponseBody = JSON.stringify({
    result: {
      validated: true,
      ledger_index: 4_200_000,
      ledger: {
        ledger_index: '4200000',
        transactions: [{ blob: 'x'.repeat(256_000) }],
      },
    },
  })
  return {
    observationId: 'r4f.g3.probe.0001',
    attemptId: 'r4f.g3.probe.attempt.0001',
    observedAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: 'a'.repeat(40),
    sourceRunId: 1,
    ledgerIndex: 4_200_000,
    invokerRequestBody: JSON.stringify({ ledgerIndex: 4_200_000 }),
    xrplRequestBody,
    xrplResponseBody,
    xrplResponseDigest: '',
  }
}

describe('Supabase revision-4 G3 read-only directional probe', () => {
  it('keeps the large XRPL inbound body in memory while excluding it from rolling egress', async () => {
    const input = probeInput()
    input.xrplResponseDigest = await sha256HexBytes(input.xrplResponseBody)

    const result = await buildSupabaseRevision4G3ReadonlyProbeResponse(input)
    const accounting = result.response.accountingEvidence.accounting
    const summary = accounting.directionalSummary
    const inbound = summary.byBoundary.find(
      (entry) => entry.boundaryId === 'xrpl_to_edge_response',
    )

    expect(result.response.responseBodyBytes).toBe(utf8ByteLength(result.responseBody))
    expect(result.response.xrplResponseBytes).toBeGreaterThan(250_000)
    expect(inbound?.rollingBillableEgressBytes).toBe(0)
    expect(inbound?.memoryTransportBytes).toBeGreaterThan(250_000)
    expect(summary.memoryTransportBytes).toBeGreaterThan(
      summary.rollingBillableEgressUpperBoundBytes,
    )
    expect(accounting.rollingBillableEgressUpperBoundBytes).toBe(
      summary.rollingBillableEgressUpperBoundBytes,
    )
    expect(accounting.checks.inboundBytesRemainInMemoryTransport).toBe(true)
    expect(result.response.checks.databaseRequestIssued).toBe(false)
    expect(result.response.checks.recoveryMutationCommitted).toBe(false)
  })

  it('retains a fixed-point compact response and exact revision-4 identity', async () => {
    const input = probeInput()
    input.xrplResponseDigest = await sha256HexBytes(input.xrplResponseBody)

    const { response, responseBody } =
      await buildSupabaseRevision4G3ReadonlyProbeResponse(input)

    expect(response.profileRevision).toBe(4)
    expect(response.profileIdentityDigest).toBe(
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
    )
    expect(response.fixedPointIterations).toBeGreaterThan(0)
    expect(response.fixedPointIterations).toBeLessThanOrEqual(32)
    expect(response.responseBodyBytes).toBe(utf8ByteLength(responseBody))
    expect(response.accountingEvidence.accounting.disposition).toBe(
      'shadow_completed',
    )
    expect(response.accountingEvidence.accounting.unexplainedDirectionalDeltaReserveBytes).toBe(0)
  })

  it('rejects placeholder, mismatched, and unbound source evidence', async () => {
    const input = probeInput()
    input.xrplResponseDigest = '0'.repeat(64)

    await expect(
      buildSupabaseRevision4G3ReadonlyProbeResponse(input),
    ).rejects.toThrow('xrplResponseDigest must be a non-placeholder SHA-256')

    input.xrplResponseDigest = 'f'.repeat(64)
    await expect(
      buildSupabaseRevision4G3ReadonlyProbeResponse(input),
    ).rejects.toThrow(
      'xrplResponseDigest does not match the retained XRPL response body',
    )

    input.xrplResponseDigest = await sha256HexBytes(input.xrplResponseBody)
    input.sourceCommit = 'not-a-commit'
    await expect(
      buildSupabaseRevision4G3ReadonlyProbeResponse(input),
    ).rejects.toThrow('sourceCommit must be a 40-character lowercase SHA')
  })
})
