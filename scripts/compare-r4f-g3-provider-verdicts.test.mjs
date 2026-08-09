import { describe, expect, it } from 'vitest'

import { compareR4fG3ProviderVerdicts } from './compare-r4f-g3-provider-verdicts.mjs'

const PROFILE_ID = 'supabase_free_postgres_pgcron_edge'
const PROFILE_DIGEST = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'

function production(overrides = {}) {
  return {
    profileId: PROFILE_ID,
    profileRevision: 4,
    profileIdentityDigest: PROFILE_DIGEST,
    captureId: 'capture-001',
    g3Qualified: true,
    reconciliation: {
      providerDeltaInterval: { lowerBoundBytes: 14001, upperBoundBytes: 15999 },
      selectedUnexplainedDeltaReserveBytes: 3525,
    },
    ...overrides,
  }
}

function independent(overrides = {}) {
  return {
    expectedProfileId: PROFILE_ID,
    expectedProfileRevision: 4,
    expectedProfileIdentityDigest: PROFILE_DIGEST,
    captureId: 'capture-001',
    auditQualified: true,
    reconciliation: {
      providerDeltaLowerBoundBytes: 14001,
      providerDeltaUpperBoundBytes: 15999,
      selectedUnexplainedDeltaReserveBytes: 3525,
    },
    ...overrides,
  }
}

describe('R4F G3 dual provider verdict gate', () => {
  it('qualifies only when both verifiers independently agree', () => {
    const result = compareR4fG3ProviderVerdicts(production(), independent())
    expect(result.agreement).toBe(true)
    expect(result.dualQualified).toBe(true)
    expect(result.profileSelected).toBe(false)
    expect(result.r5Authorized).toBe(false)
  })

  it.each([
    ['production rejection', production({ g3Qualified: false }), independent()],
    ['independent rejection', production(), independent({ auditQualified: false })],
    ['capture mismatch', production(), independent({ captureId: 'capture-002' })],
    [
      'provider interval mismatch',
      production(),
      independent({
        reconciliation: {
          providerDeltaLowerBoundBytes: 14001,
          providerDeltaUpperBoundBytes: 16000,
          selectedUnexplainedDeltaReserveBytes: 3525,
        },
      }),
    ],
    [
      'reserve mismatch',
      production(),
      independent({
        reconciliation: {
          providerDeltaLowerBoundBytes: 14001,
          providerDeltaUpperBoundBytes: 15999,
          selectedUnexplainedDeltaReserveBytes: 3526,
        },
      }),
    ],
  ])('fails closed on %s', (_name, productionEvidence, independentEvidence) => {
    const result = compareR4fG3ProviderVerdicts(productionEvidence, independentEvidence)
    expect(result.dualQualified).toBe(false)
  })
})
