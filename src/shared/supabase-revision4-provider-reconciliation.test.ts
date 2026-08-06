import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  reconcileSupabaseRevision4ProviderInterval,
  type SupabaseRevision4ProviderReconciliationInput,
} from './supabase-revision4-provider-reconciliation'

function fixture(): {
  expected: Record<string, unknown>
  input: SupabaseRevision4ProviderReconciliationInput
} {
  const parsed = JSON.parse(
    readFileSync(
      resolve(
        process.cwd(),
        'ops/r4f/revision4-provider-reconciliation-fixture.json',
      ),
      'utf8',
    ),
  )
  const { expected, purpose: _purpose, evidenceClass: _evidenceClass, ...input } = parsed
  return {
    expected,
    input: input as SupabaseRevision4ProviderReconciliationInput,
  }
}

describe('Supabase revision-4 provider interval reconciliation', () => {
  it('derives the conservative provider delta and reserve from interval bounds', () => {
    const { input, expected } = fixture()
    const result = reconcileSupabaseRevision4ProviderInterval(input)

    expect(result.providerDeltaInterval).toEqual(expected.providerDeltaInterval)
    expect(result.providerDeltaIntervalWidthBytes).toBe(
      expected.providerDeltaIntervalWidthBytes,
    )
    expect(result.newlyRequiredUnexplainedDeltaReserveBytes).toBe(
      expected.newlyRequiredUnexplainedDeltaReserveBytes,
    )
    expect(result.selectedUnexplainedDeltaReserveBytes).toBe(
      expected.selectedUnexplainedDeltaReserveBytes,
    )
    expect(result.applicationCoveredUpperBoundBytes).toBe(
      expected.applicationCoveredUpperBoundBytes,
    )
    expect(result.intervalUpperBoundCovered).toBe(true)
  })

  it('never accepts the synthetic planning fixture as provider evidence', () => {
    const { input } = fixture()
    const result = reconcileSupabaseRevision4ProviderInterval(input)

    expect(result.exactAutomatedProviderReconciliationAvailable).toBe(false)
    expect(result.exactProviderReconciliationClaimed).toBe(false)
    expect(result.intervalReconciliationReady).toBe(false)
    expect(result.g3Qualified).toBe(false)
    expect(result.profileSelected).toBe(false)
    expect(result.r5Authorized).toBe(false)
    expect(result.checks.syntheticInputNotAcceptedAsProviderEvidence).toBe(false)
  })

  it('accepts an authorized bounded dashboard interval only when scope and safety reconcile', () => {
    const { input } = fixture()
    const result = reconcileSupabaseRevision4ProviderInterval({
      ...input,
      captureKind: 'dashboard_bounded_experiment',
      experimentAuthorized: true,
    })

    expect(result.intervalReconciliationReady).toBe(true)
    expect(result.intervalUpperBoundCovered).toBe(true)
    expect(result.g3Qualified).toBe(true)
    expect(result.exactProviderReconciliationClaimed).toBe(false)
    expect(result.profileSelected).toBe(false)
    expect(result.r5Authorized).toBe(false)
  })

  it('retains a larger prior unexplained-delta reserve', () => {
    const { input } = fixture()
    const result = reconcileSupabaseRevision4ProviderInterval({
      ...input,
      retainedUnexplainedDeltaReserveBytes: 10_000,
    })

    expect(result.newlyRequiredUnexplainedDeltaReserveBytes).toBe(3_525)
    expect(result.selectedUnexplainedDeltaReserveBytes).toBe(10_000)
    expect(result.applicationCoveredUpperBoundBytes).toBe(22_474)
  })

  it('fails closed when the provider counter resets or the scope changes', () => {
    const { input } = fixture()
    const result = reconcileSupabaseRevision4ProviderInterval({
      ...input,
      captureKind: 'dashboard_bounded_experiment',
      experimentAuthorized: true,
      providerAfter: {
        lowerBoundBytes: 900_000,
        upperBoundBytes: 900_999,
      },
    })

    expect(result.counterResetOrScopeChangeDetected).toBe(true)
    expect(result.providerDeltaInterval).toEqual({
      lowerBoundBytes: 0,
      upperBoundBytes: 0,
    })
    expect(result.intervalReconciliationReady).toBe(false)
    expect(result.g3Qualified).toBe(false)
  })

  it('rejects invalid intervals and profile identities', () => {
    const { input } = fixture()

    expect(() =>
      reconcileSupabaseRevision4ProviderInterval({
        ...input,
        providerBefore: { lowerBoundBytes: 2, upperBoundBytes: 1 },
      }),
    ).toThrow('providerBefore lower bound must not exceed its upper bound')

    expect(() =>
      reconcileSupabaseRevision4ProviderInterval({
        ...input,
        profileIdentityDigest: '0'.repeat(64) as typeof input.profileIdentityDigest,
      }),
    ).toThrow('revision4 provider reconciliation identity mismatch')
  })

  it('does not qualify concurrent or cross-period traffic', () => {
    const { input } = fixture()
    for (const override of [
      { concurrentProviderTrafficExcluded: false },
      { sameBillingPeriod: false },
      { sameProjectIdentity: false },
      { projectFilterApplied: false },
    ]) {
      const result = reconcileSupabaseRevision4ProviderInterval({
        ...input,
        captureKind: 'dashboard_bounded_experiment',
        experimentAuthorized: true,
        ...override,
      })
      expect(result.g3Qualified).toBe(false)
    }
  })
})
