import { describe, expect, it } from 'vitest'

import { computeDeploymentProfileIdentityDigest } from './deployment-profile-qualification'
import {
  evaluateSupabaseRevision3ResourceAccounting,
  SUPABASE_REVISION3_PROFILE,
  SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST,
  SUPABASE_REVISION3_RESOURCE_LIMITS,
  type SupabaseRevision3ResourceAccountingInput,
} from './supabase-revision3-resource-accounting'

function representativeInput(
  overrides: Partial<SupabaseRevision3ResourceAccountingInput> = {},
): SupabaseRevision3ResourceAccountingInput {
  return {
    ledgerCount: 24,
    networkRequestCount: 25,
    networkRequestBytes: 20_000,
    networkResponseBytes: 200_000,
    databaseRequestCount: 3,
    databaseRequestBytes: 300_000,
    databaseResponseBytes: 20_000,
    functionResponseBytes: 10_000,
    transactionCount: 20,
    metadataNodeCount: 100,
    normalizedRecordCount: 100,
    payloadChunkCount: 24,
    relationshipCount: 200,
    canonicalJsonBytes: 200_000,
    payloadBytes: 100_000,
    priorConservativeEgress31dBytes: 100 * 1024 * 1024,
    priorInvocations31d: 100_000,
    ...overrides,
  }
}

describe('Supabase revision-3 resource accounting', () => {
  it('binds the exact revision-3 profile identity', async () => {
    expect(await computeDeploymentProfileIdentityDigest(SUPABASE_REVISION3_PROFILE)).toBe(
      SUPABASE_REVISION3_PROFILE_IDENTITY_DIGEST,
    )
    expect(SUPABASE_REVISION3_PROFILE.revision).toBe(3)
    expect(SUPABASE_REVISION3_PROFILE.components.execution).toContain(
      'conservative application-owned resource accounting',
    )
  })

  it('allows a bounded representative tick without claiming provider counters', () => {
    const result = evaluateSupabaseRevision3ResourceAccounting(representativeInput())

    expect(result.allowed).toBe(true)
    expect(result.failures).toEqual([])
    expect(result.conservativeMemoryUpperBoundBytes).toBeLessThan(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectMemoryHaltBytes,
    )
    expect(result.conservativeTickEgressUpperBoundBytes).toBeLessThan(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectTickEgressHaltBytes,
    )
    expect(result.conservativeEgress31dUpperBoundBytes).toBeLessThan(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectEgressHalt31dBytes,
    )
    expect(result.checks).toEqual({
      unavailableProviderMemoryNotClaimed: true,
      unavailableProviderEgressNotClaimed: true,
      fixedRuntimeReserveApplied: true,
      serializedBytesAmplified: true,
      objectOverheadApplied: true,
      allNetworkDirectionsCounted: true,
      preMutationDecision: true,
    })
  })

  it('over-accounts serialized bytes, object overhead, and every network direction', () => {
    const input = representativeInput()
    const result = evaluateSupabaseRevision3ResourceAccounting(input)
    const exactWireBytes =
      input.networkRequestBytes
      + input.networkResponseBytes
      + input.databaseRequestBytes
      + input.databaseResponseBytes
      + input.functionResponseBytes

    expect(result.exactWireBytes).toBe(exactWireBytes)
    expect(result.serializedLiveBytes).toBe(
      input.networkResponseBytes
        + input.databaseRequestBytes
        + input.databaseResponseBytes
        + input.canonicalJsonBytes
        + input.payloadBytes,
    )
    expect(result.dynamicMemoryUpperBoundBytes).toBeGreaterThan(
      result.serializedLiveBytes,
    )
    expect(result.conservativeMemoryUpperBoundBytes).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.fixedRuntimeMemoryReserveBytes
        + result.dynamicMemoryUpperBoundBytes,
    )
    expect(result.conservativeTickEgressUpperBoundBytes).toBeGreaterThan(
      exactWireBytes,
    )
  })

  it('halts at the conservative memory upper bound before mutation', () => {
    const result = evaluateSupabaseRevision3ResourceAccounting(
      representativeInput({ networkResponseBytes: 5 * 1024 * 1024 }),
    )

    expect(result.allowed).toBe(false)
    expect(result.failures).toContain('memory_upper_bound_halt')
    expect(result.conservativeMemoryUpperBoundBytes).toBeGreaterThanOrEqual(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectMemoryHaltBytes,
    )
    expect(SUPABASE_REVISION3_RESOURCE_LIMITS.projectMemoryHaltBytes).toBeLessThan(
      SUPABASE_REVISION3_RESOURCE_LIMITS.providerMemoryHardBytes,
    )
  })

  it('halts when the conservative monthly egress bound reaches the project ceiling', () => {
    const result = evaluateSupabaseRevision3ResourceAccounting(
      representativeInput({
        priorConservativeEgress31dBytes:
          SUPABASE_REVISION3_RESOURCE_LIMITS.projectEgressHalt31dBytes - 1,
      }),
    )

    expect(result.allowed).toBe(false)
    expect(result.failures).toContain('monthly_egress_upper_bound_halt')
    expect(SUPABASE_REVISION3_RESOURCE_LIMITS.projectEgressHalt31dBytes).toBeLessThan(
      SUPABASE_REVISION3_RESOURCE_LIMITS.providerEgressHard31dBytes,
    )
  })

  it('halts before the monthly invocation ceiling', () => {
    const result = evaluateSupabaseRevision3ResourceAccounting(
      representativeInput({
        priorInvocations31d:
          SUPABASE_REVISION3_RESOURCE_LIMITS.projectInvocationHalt31d - 1,
      }),
    )

    expect(result.allowed).toBe(false)
    expect(result.failures).toContain('monthly_invocation_halt')
  })

  it('fails every bounded object-count class independently', () => {
    const cases: Array<
      [keyof SupabaseRevision3ResourceAccountingInput, number, string]
    > = [
      ['ledgerCount', 25, 'ledger_count_limit'],
      ['networkRequestCount', 65, 'network_request_count_limit'],
      ['databaseRequestCount', 17, 'database_request_count_limit'],
      ['transactionCount', 4_097, 'transaction_count_limit'],
      ['metadataNodeCount', 32_769, 'metadata_node_count_limit'],
      ['normalizedRecordCount', 16_385, 'normalized_record_count_limit'],
      ['payloadChunkCount', 1_025, 'payload_chunk_count_limit'],
      ['relationshipCount', 65_537, 'relationship_count_limit'],
    ]

    for (const [key, value, failure] of cases) {
      const result = evaluateSupabaseRevision3ResourceAccounting(
        representativeInput({ [key]: value }),
      )
      expect(result.allowed, key).toBe(false)
      expect(result.failures, key).toContain(failure)
    }
  })

  it('rejects negative, fractional, and unsafe inputs', () => {
    expect(() =>
      evaluateSupabaseRevision3ResourceAccounting(
        representativeInput({ networkResponseBytes: -1 }),
      ),
    ).toThrow('networkResponseBytes must be a non-negative safe integer')
    expect(() =>
      evaluateSupabaseRevision3ResourceAccounting(
        representativeInput({ transactionCount: 1.5 }),
      ),
    ).toThrow('transactionCount must be a non-negative safe integer')
    expect(() =>
      evaluateSupabaseRevision3ResourceAccounting(
        representativeInput({ payloadBytes: Number.MAX_SAFE_INTEGER }),
      ),
    ).toThrow('serializedLiveBytes exceeds the safe integer range')
  })
})
