import { describe, expect, it } from 'vitest'

import { computeDeploymentProfileIdentityDigest } from './deployment-profile-qualification'
import {
  summarizeSupabaseRevision4DirectionalBytes,
  SUPABASE_REVISION4_BYTE_BOUNDARIES,
  SUPABASE_REVISION4_FIXED_GUARDS,
  SUPABASE_REVISION4_G1_CONTRACT,
  SUPABASE_REVISION4_PROFILE,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
} from './supabase-revision4-directional-egress-contract'
import { SUPABASE_REVISION3_RESOURCE_LIMITS } from './supabase-revision3-resource-accounting'

describe('Supabase revision-4 directional egress G1 contract', () => {
  it('binds a new exact profile identity without selecting it', async () => {
    expect(await computeDeploymentProfileIdentityDigest(SUPABASE_REVISION4_PROFILE)).toBe(
      SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    )
    expect(SUPABASE_REVISION4_PROFILE.revision).toBe(4)
    expect(SUPABASE_REVISION4_G1_CONTRACT.selection).toBe('not_selected')
    expect(SUPABASE_REVISION4_G1_CONTRACT.recoveryMutationAuthorized).toBe(false)
    expect(SUPABASE_REVISION4_G1_CONTRACT.qualificationIssue).toBe(1261)
  })

  it('preserves the selected revision-3 hard guards', () => {
    expect(SUPABASE_REVISION4_FIXED_GUARDS.projectMemoryHaltBytes).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectMemoryHaltBytes,
    )
    expect(SUPABASE_REVISION4_FIXED_GUARDS.providerMemoryHardBytes).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.providerMemoryHardBytes,
    )
    expect(SUPABASE_REVISION4_FIXED_GUARDS.projectEgressHalt31dBytes).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectEgressHalt31dBytes,
    )
    expect(SUPABASE_REVISION4_FIXED_GUARDS.providerEgressHard31dBytes).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.providerEgressHard31dBytes,
    )
    expect(SUPABASE_REVISION4_FIXED_GUARDS.projectInvocationHalt31d).toBe(
      SUPABASE_REVISION3_RESOURCE_LIMITS.projectInvocationHalt31d,
    )
    expect(SUPABASE_REVISION4_FIXED_GUARDS.selectedMaximumLedgersPerClaim).toBe(12)
  })

  it('keeps inbound XRPL bytes out of billable egress while retaining memory accounting', () => {
    const boundary = SUPABASE_REVISION4_BYTE_BOUNDARIES.xrpl_to_edge_response
    expect(boundary.platformDirection).toBe('inbound_to_supabase')
    expect(boundary.rollingEgressTreatment).toBe('exclude_inbound')
    expect(boundary.countsTowardRollingBillableEgressUpperBound).toBe(false)
    expect(boundary.countsTowardMemoryTransport).toBe(true)

    const result = summarizeSupabaseRevision4DirectionalBytes([
      {
        boundaryId: 'xrpl_to_edge_response',
        bodyBytes: 10_000_000,
        framingReserveBytes: 10_000,
      },
    ])
    expect(result.rollingBillableEgressUpperBoundBytes).toBe(0)
    expect(result.memoryTransportBytes).toBe(10_010_000)
  })

  it('counts documented Edge responses in both contracts', () => {
    const result = summarizeSupabaseRevision4DirectionalBytes([
      {
        boundaryId: 'edge_to_invoker_response',
        bodyBytes: 20_000,
        framingReserveBytes: 1_000,
      },
    ])
    expect(result.rollingBillableEgressUpperBoundBytes).toBe(21_000)
    expect(result.memoryTransportBytes).toBe(21_000)
  })

  it('conservatively includes unresolved internal and outbound classes until G3', () => {
    for (const boundaryId of [
      'edge_to_xrpl_request',
      'edge_to_database_request',
      'database_to_edge_response',
      'edge_to_edge_request',
      'edge_to_edge_response',
    ] as const) {
      const boundary = SUPABASE_REVISION4_BYTE_BOUNDARIES[boundaryId]
      expect(boundary.rollingEgressTreatment).toBe(
        'include_conservative_until_g3',
      )
      expect(boundary.countsTowardRollingBillableEgressUpperBound).toBe(true)
      expect(boundary.qualificationState).toBe('requires_g3_reconciliation')
    }
  })

  it('never permits the revision-3 blanket all-direction wire multiplier', () => {
    expect(
      SUPABASE_REVISION4_G1_CONTRACT.accountingModel
        .blanketAllDirectionWireMultiplierAllowed,
    ).toBe(false)
    expect(
      SUPABASE_REVISION4_G1_CONTRACT.accountingModel
        .providerCountersClaimedAsAvailable,
    ).toBe(false)
    expect(
      SUPABASE_REVISION4_G1_CONTRACT.accountingModel
        .unexplainedDeltaReserveRequired,
    ).toBe(true)
  })

  it('sums each boundary by direction without dropping memory bytes', () => {
    const result = summarizeSupabaseRevision4DirectionalBytes([
      {
        boundaryId: 'invoker_to_edge_request',
        bodyBytes: 100,
        framingReserveBytes: 10,
      },
      {
        boundaryId: 'edge_to_xrpl_request',
        bodyBytes: 200,
        framingReserveBytes: 20,
      },
      {
        boundaryId: 'xrpl_to_edge_response',
        bodyBytes: 300,
        framingReserveBytes: 30,
      },
      {
        boundaryId: 'edge_to_invoker_response',
        bodyBytes: 400,
        framingReserveBytes: 40,
      },
    ])

    expect(result.rollingBillableEgressUpperBoundBytes).toBe(660)
    expect(result.memoryTransportBytes).toBe(1_100)
    expect(result.byBoundary).toHaveLength(4)
  })

  it('rejects invalid byte observations', () => {
    expect(() =>
      summarizeSupabaseRevision4DirectionalBytes([
        {
          boundaryId: 'xrpl_to_edge_response',
          bodyBytes: -1,
          framingReserveBytes: 0,
        },
      ]),
    ).toThrow('bodyBytes must be a non-negative safe integer')
    expect(() =>
      summarizeSupabaseRevision4DirectionalBytes([
        {
          boundaryId: 'edge_to_invoker_response',
          bodyBytes: Number.MAX_SAFE_INTEGER,
          framingReserveBytes: 1,
        },
      ]),
    ).toThrow('boundary total bytes exceeds the safe integer range')
  })
})
