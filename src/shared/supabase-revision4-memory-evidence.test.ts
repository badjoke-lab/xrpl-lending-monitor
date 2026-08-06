import { describe, expect, it } from 'vitest'

import {
  SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
  SUPABASE_REVISION4_MEMORY_HALT_BYTES,
  SUPABASE_REVISION4_PROFILE_ID,
  SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
  SUPABASE_REVISION4_PROFILE_REVISION,
  type SupabaseRevision4MemoryEvidenceInput,
  verifySupabaseRevision4MemoryEvidence,
} from './supabase-revision4-memory-evidence'

function createReplayEvidence(): SupabaseRevision4MemoryEvidenceInput {
  return {
    schemaVersion: 1,
    evidenceClass: 'bounded_offline_replay',
    profileId: SUPABASE_REVISION4_PROFILE_ID,
    profileRevision: SUPABASE_REVISION4_PROFILE_REVISION,
    profileIdentityDigest: SUPABASE_REVISION4_PROFILE_IDENTITY_DIGEST,
    evidenceId: 'r4f-g4-memory-replay-test-001',
    capturedAt: '2026-08-06T08:00:00.000Z',
    authorization: {
      issueNumber: 1261,
      commentId: 1,
      actor: 'badjoke-lab',
      scope: 'r4f_g4_memory_replay',
    },
    policy: {
      memoryMetric: 'process_rss_bytes',
      memoryHaltBytes: SUPABASE_REVISION4_MEMORY_HALT_BYTES,
      claimCapLedgers: SUPABASE_REVISION4_CLAIM_CAP_LEDGERS,
    },
    samples: [
      {
        sampleId: 'exact-shape',
        shape: 'exact_12_ledger_halt_shape',
        backgroundRecovery: true,
        ledgersClaimed: 12,
        retainedLedgerCount: 12,
        baselineMemoryBytes: 100_000_000,
        peakMemoryBytes: 180_000_000,
        completedWithoutMemoryHalt: true,
        claimCapOverrideUsed: false,
        traceSha256: 'a'.repeat(64),
        diagnosticsSha256: 'b'.repeat(64),
      },
      {
        sampleId: 'heavier-retained',
        shape: 'heavier_retained_sample',
        backgroundRecovery: true,
        ledgersClaimed: 12,
        retainedLedgerCount: 24,
        baselineMemoryBytes: 105_000_000,
        peakMemoryBytes: 200_000_000,
        completedWithoutMemoryHalt: true,
        claimCapOverrideUsed: false,
        traceSha256: 'c'.repeat(64),
        diagnosticsSha256: 'd'.repeat(64),
      },
    ],
    artifacts: {
      harnessSha256: 'e'.repeat(64),
      environmentSha256: 'f'.repeat(64),
      outputSha256: '1'.repeat(64),
      sourceCommit: '2'.repeat(40),
    },
    safety: {
      productionCredentialsUsed: false,
      productionMutationPerformed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
}

describe('supabase revision-4 memory evidence', () => {
  it('locks the existing memory halt and claim cap', () => {
    expect(SUPABASE_REVISION4_MEMORY_HALT_BYTES).toBe(234_881_024)
    expect(SUPABASE_REVISION4_CLAIM_CAP_LEDGERS).toBe(12)
  })

  it('accepts both required bounded replay shapes with strict headroom', () => {
    const result = verifySupabaseRevision4MemoryEvidence(createReplayEvidence())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.requiredShapesPresent).toBe(true)
    expect(result.machineSummary.minimumHeadroomBytes).toBe(34_881_024)
  })

  it('never qualifies synthetic evidence', () => {
    const input = createReplayEvidence()
    input.evidenceClass = 'synthetic_test_only'
    input.authorization.commentId = null

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('synthetic_or_unbounded_evidence_not_qualifying')
  })

  it('fails if the memory guard is reduced or changed', () => {
    const input = createReplayEvidence()
    input.policy.memoryHaltBytes -= 1

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('memory_halt_guard_changed')
  })

  it('fails if the claim cap is changed or bypassed', () => {
    const changed = createReplayEvidence()
    changed.policy.claimCapLedgers = 13
    expect(verifySupabaseRevision4MemoryEvidence(changed).blockingReasons).toContain(
      'claim_cap_changed',
    )

    const bypassed = createReplayEvidence()
    bypassed.samples[1].claimCapOverrideUsed = true
    expect(verifySupabaseRevision4MemoryEvidence(bypassed).blockingReasons).toContain(
      'sample_claim_cap_override_used:heavier-retained',
    )
  })

  it('requires both samples to remain strictly below the halt', () => {
    const input = createReplayEvidence()
    input.samples[1].peakMemoryBytes = SUPABASE_REVISION4_MEMORY_HALT_BYTES

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'sample_not_strictly_below_memory_halt:heavier-retained',
    )
  })

  it('requires exactly one of each replay shape', () => {
    const input = createReplayEvidence()
    input.samples.pop()

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('heavier_retained_sample_count_invalid')
  })

  it('requires the heavier sample to retain more ledgers', () => {
    const input = createReplayEvidence()
    input.samples[1].retainedLedgerCount = 12

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('heavier_sample_not_more_retained')
  })

  it('requires the exact halt-shape replay to claim 12 ledgers', () => {
    const input = createReplayEvidence()
    input.samples[0].ledgersClaimed = 11

    const result = verifySupabaseRevision4MemoryEvidence(input)

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('exact_halt_shape_not_12_ledgers')
  })

  it('fails closed on identity mismatch and secret material', () => {
    const identityMismatch = createReplayEvidence()
    identityMismatch.profileIdentityDigest = '3'.repeat(64)
    expect(
      verifySupabaseRevision4MemoryEvidence(identityMismatch).blockingReasons,
    ).toContain('profile_identity_digest_mismatch')

    const withSecret = createReplayEvidence() as SupabaseRevision4MemoryEvidenceInput & {
      accessToken?: string
    }
    withSecret.accessToken = 'not-allowed'
    expect(verifySupabaseRevision4MemoryEvidence(withSecret).blockingReasons).toContain(
      'secret_material_present',
    )
  })
})
