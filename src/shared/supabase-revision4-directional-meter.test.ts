import { describe, expect, it } from 'vitest'

import {
  buildSupabaseRevision4DirectionalAccountingEvidence,
  SupabaseRevision4DirectionalMeter,
  utf8ByteLength,
} from './supabase-revision4-directional-meter'
import { SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST } from './supabase-revision4-directional-egress-contract'

function baseInput(
  meter: SupabaseRevision4DirectionalMeter,
  disposition: 'shadow_completed' | 'shadow_failed' = 'shadow_completed',
) {
  return {
    schemaVersion: 1 as const,
    observationId: 'r4f.g2.fixture.0001',
    attemptId: 'r4f.g2.attempt.0001',
    observedAt: '2026-08-06T04:00:00.000Z',
    disposition,
    observations: meter.snapshot(),
    memorySupplemental: {
      canonicalJsonBytes: 1_000,
      payloadBytes: 2_000,
      normalizedObjectOverheadBytes: 3_000,
      allocatorReserveBytes: 4_000,
    },
    unexplainedDirectionalDeltaReserveBytes: 500,
    recoveryMutationCommitted: false as const,
    publicReaderUnchanged: true as const,
    mainnetDisabled: true as const,
    stabilizationAuthorized: false as const,
    soakAuthorized: false as const,
  }
}

describe('Supabase revision-4 directional meter', () => {
  it('records exact UTF-8 body bytes instead of string length', () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    const body = JSON.stringify({ message: '台帳🚧' })
    const observation = meter.recordUtf8({
      operationId: 'xrpl.ledger.4139119.response',
      boundaryId: 'xrpl_to_edge_response',
      body,
      framingReserveBytes: 128,
    })

    expect(observation.bodyBytes).toBe(utf8ByteLength(body))
    expect(observation.bodyBytes).toBeGreaterThan(body.length)
    expect(observation.sequence).toBe(0)
  })

  it('retains inbound XRPL bytes in memory without adding them to rolling egress', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    meter.recordBytes({
      operationId: 'xrpl.server_info.response',
      boundaryId: 'xrpl_to_edge_response',
      bodyBytes: 250_000,
      framingReserveBytes: 1_000,
    })
    meter.recordBytes({
      operationId: 'edge.caller.response',
      boundaryId: 'edge_to_invoker_response',
      bodyBytes: 2_000,
      framingReserveBytes: 100,
    })

    const evidence = await buildSupabaseRevision4DirectionalAccountingEvidence(
      baseInput(meter),
    )

    expect(evidence.accounting.directionalSummary.memoryTransportBytes).toBe(253_100)
    expect(
      evidence.accounting.directionalSummary.rollingBillableEgressUpperBoundBytes,
    ).toBe(2_100)
    expect(evidence.accounting.rollingBillableEgressUpperBoundBytes).toBe(2_600)
    expect(evidence.accounting.memoryTransportUpperBoundBytes).toBe(263_100)
    expect(evidence.accounting.checks.inboundBytesRemainInMemoryTransport).toBe(true)
  })

  it('retains canonical accounting JSON and a stable digest', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    meter.recordUtf8({
      operationId: 'edge.xrpl.request.4139119',
      boundaryId: 'edge_to_xrpl_request',
      body: '{"method":"ledger"}',
      framingReserveBytes: 256,
    })
    meter.recordUtf8({
      operationId: 'xrpl.edge.response.4139119',
      boundaryId: 'xrpl_to_edge_response',
      body: '{"result":{"ledger_index":4139119}}',
      framingReserveBytes: 512,
    })

    const first = await buildSupabaseRevision4DirectionalAccountingEvidence(
      baseInput(meter),
    )
    const second = await buildSupabaseRevision4DirectionalAccountingEvidence(
      baseInput(meter),
    )

    expect(first.accountingJson).toBe(second.accountingJson)
    expect(first.accountingDigest).toBe(second.accountingDigest)
    expect(first.accountingDigest).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.parse(first.accountingJson)).toEqual(first.accounting)
    expect(first.accounting.profileIdentityDigest).toBe(
      SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    )
    expect(first.accounting.checks.canonicalAccountingJsonRetained).toBe(true)
    expect(first.accounting.checks.blanketAllDirectionMultiplierUsed).toBe(false)
  })

  it('retains failed disposition without claiming a recovery mutation', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    meter.recordBytes({
      operationId: 'database.claim.response',
      boundaryId: 'database_to_edge_response',
      bodyBytes: 10_000,
      framingReserveBytes: 1_000,
    })

    const evidence = await buildSupabaseRevision4DirectionalAccountingEvidence(
      baseInput(meter, 'shadow_failed'),
    )

    expect(evidence.accounting.disposition).toBe('shadow_failed')
    expect(evidence.accounting.checks.recoveryMutationCommitted).toBe(false)
    expect(evidence.accounting.checks.publicReaderUnchanged).toBe(true)
    expect(evidence.accounting.checks.mainnetDisabled).toBe(true)
  })

  it('keeps framing reserves explicit per operation', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    meter.recordBytes({
      operationId: 'edge.database.request',
      boundaryId: 'edge_to_database_request',
      bodyBytes: 1_000,
      framingReserveBytes: 100,
    })
    meter.recordBytes({
      operationId: 'database.edge.response',
      boundaryId: 'database_to_edge_response',
      bodyBytes: 2_000,
      framingReserveBytes: 200,
    })

    const evidence = await buildSupabaseRevision4DirectionalAccountingEvidence(
      baseInput(meter),
    )

    expect(evidence.accounting.observations).toEqual([
      {
        schemaVersion: 1,
        sequence: 0,
        operationId: 'edge.database.request',
        boundaryId: 'edge_to_database_request',
        bodyBytes: 1_000,
        framingReserveBytes: 100,
      },
      {
        schemaVersion: 1,
        sequence: 1,
        operationId: 'database.edge.response',
        boundaryId: 'database_to_edge_response',
        bodyBytes: 2_000,
        framingReserveBytes: 200,
      },
    ])
    expect(evidence.accounting.rollingBillableEgressUpperBoundBytes).toBe(3_800)
  })

  it('rejects duplicate operation identifiers and noncontiguous retained sequences', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    meter.recordBytes({
      operationId: 'duplicate.operation',
      boundaryId: 'edge_to_xrpl_request',
      bodyBytes: 1,
      framingReserveBytes: 1,
    })
    expect(() =>
      meter.recordBytes({
        operationId: 'duplicate.operation',
        boundaryId: 'xrpl_to_edge_response',
        bodyBytes: 1,
        framingReserveBytes: 1,
      }),
    ).toThrow('operationId is duplicated')

    const input = baseInput(meter)
    input.observations = [{ ...input.observations[0]!, sequence: 2 }]
    await expect(
      buildSupabaseRevision4DirectionalAccountingEvidence(input),
    ).rejects.toThrow('observation sequence must be contiguous from zero')
  })

  it('rejects any G2 accounting that claims recovery or release-state mutation', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    const input = baseInput(meter)

    await expect(
      buildSupabaseRevision4DirectionalAccountingEvidence({
        ...input,
        recoveryMutationCommitted: true as unknown as false,
      }),
    ).rejects.toThrow('must not commit recovery mutation')
    await expect(
      buildSupabaseRevision4DirectionalAccountingEvidence({
        ...input,
        mainnetDisabled: false as unknown as true,
      }),
    ).rejects.toThrow('G2 safety boundary changed')
  })

  it('rejects unsafe totals and invalid stable identifiers', async () => {
    const meter = new SupabaseRevision4DirectionalMeter()
    expect(() =>
      meter.recordBytes({
        operationId: 'contains secret whitespace',
        boundaryId: 'edge_to_invoker_response',
        bodyBytes: 1,
        framingReserveBytes: 1,
      }),
    ).toThrow('stable non-secret identifier')

    meter.recordBytes({
      operationId: 'safe.operation',
      boundaryId: 'edge_to_invoker_response',
      bodyBytes: Number.MAX_SAFE_INTEGER,
      framingReserveBytes: 0,
    })
    await expect(
      buildSupabaseRevision4DirectionalAccountingEvidence({
        ...baseInput(meter),
        unexplainedDirectionalDeltaReserveBytes: 1,
      }),
    ).rejects.toThrow('rollingBillableEgressUpperBoundBytes exceeds')
  })
})
