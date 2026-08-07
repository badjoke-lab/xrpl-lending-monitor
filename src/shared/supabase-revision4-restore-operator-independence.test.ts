import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  type SupabaseRevision4RestoreOperatorInput,
  verifySupabaseRevision4RestoreOperatorIndependence,
} from './supabase-revision4-restore-operator-independence'

function fixture(): SupabaseRevision4RestoreOperatorInput {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), 'ops/r4f/revision4-restore-operator-synthetic.json'),
      'utf8',
    ),
  ) as SupabaseRevision4RestoreOperatorInput
}

function proofShape(): SupabaseRevision4RestoreOperatorInput {
  const input = fixture()
  input.evidenceClass = 'bounded_restore_operator_reproof'
  input.evidenceId = 'r4f-g8-proof-shape'
  input.prerequisites.g3ProviderReconciliationPassed = true
  input.prerequisites.g4MemoryRequalificationPassed = true
  input.prerequisites.g5SteadyConvergencePassed = true
  input.prerequisites.g6CatchupConvergencePassed = true
  input.prerequisites.g7FailureAccountingPassed = true
  return input
}

describe('Supabase revision-4 G8 restore and operator independence', () => {
  it('keeps the retained synthetic fixture non-qualifying at the unresolved gates', () => {
    const result = verifySupabaseRevision4RestoreOperatorIndependence(fixture())

    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain(
      'synthetic_or_unbounded_evidence_not_qualifying',
    )
    expect(result.blockingReasons).toContain('g3_provider_reconciliation_not_passed')
    expect(result.blockingReasons).toContain('g5_steady_convergence_not_passed')
    expect(result.blockingReasons).toContain('g6_catchup_convergence_not_passed')
    expect(result.blockingReasons).toContain('g7_failure_accounting_not_passed')
    expect(result.blockingReasons).not.toContain('g4_memory_requalification_not_passed')
  })

  it('accepts a complete revision-4-bound reproof shape when all preceding gates pass', () => {
    const result = verifySupabaseRevision4RestoreOperatorIndependence(proofShape())

    expect(result.proofReady).toBe(true)
    expect(result.blockingReasons).toEqual([])
    expect(result.machineSummary.boundProofCount).toBe(7)
    expect(result.machineSummary.allProofsBoundToRevision4Identity).toBe(true)
    expect(result.machineSummary.completeStateTransferProved).toBe(true)
    expect(result.machineSummary.postRestoreContinuationProved).toBe(true)
    expect(result.machineSummary.credentialRotationProved).toBe(true)
    expect(result.machineSummary.rollbackProved).toBe(true)
    expect(result.machineSummary.terminalHaltProved).toBe(true)
    expect(result.machineSummary.evidencePublicationProved).toBe(true)
    expect(result.machineSummary.operatorIndependenceProved).toBe(true)
    expect(result.machineSummary.releaseBoundaryClosed).toBe(true)
  })

  it('rejects a rev3 or otherwise mismatched proof identity even if every boolean is true', () => {
    const input = proofShape()
    input.exportRestore.profileRevision = 3
    input.exportRestore.profileIdentityDigest =
      '3a5c4ff2c43a48d3e5b7ceded60027173d215d6f083fb33c22375758520bbe67'

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('export_restore_profile_revision_mismatch')
    expect(result.blockingReasons).toContain(
      'export_restore_profile_identity_digest_mismatch',
    )
    expect(result.machineSummary.allProofsBoundToRevision4Identity).toBe(false)
  })

  it('requires complete-state parity and post-restore continuation, not restore alone', () => {
    const input = proofShape()
    input.exportRestore.digestParity = false
    input.continuation.committedRowsOnly = false

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('complete_state_transfer_not_proved')
    expect(result.blockingReasons).toContain('post_restore_continuation_not_proved')
  })

  it('rejects token rotation that retains credentials or fails to invalidate the old token', () => {
    const input = proofShape()
    input.credentialRotation.credentialMaterialRetained = true
    input.credentialRotation.oldTokensRejectedAfterRotation = false

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('credential_rotation_not_proved')
    expect(result.machineSummary.credentialRotationProved).toBe(false)
  })

  it('requires rollback and terminal halt to retain the failed-attempt accounting', () => {
    const input = proofShape()
    input.rollback.failedAttemptAccountingRetained = false
    input.halt.failedAttemptAccountingRetained = false

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('rollback_not_proved')
    expect(result.blockingReasons).toContain('terminal_halt_not_proved')
  })

  it('requires automatic sanitized publication and a dashboard-independent scripted path', () => {
    const input = proofShape()
    input.evidencePublication.failurePathPublished = false
    input.operatorIndependence.noRoutineDashboardStep = false

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('evidence_publication_not_proved')
    expect(result.blockingReasons).toContain('operator_independence_not_proved')
  })

  it('keeps the release boundary and fixed revision-4 guards closed', () => {
    const input = proofShape()
    input.safety.publicReaderUnchanged = false
    input.safety.stabilizationAuthorized = true
    input.policy.claimCapLedgers = 24

    const result = verifySupabaseRevision4RestoreOperatorIndependence(input)
    expect(result.proofReady).toBe(false)
    expect(result.blockingReasons).toContain('public_reader_changed')
    expect(result.blockingReasons).toContain('stabilization_authorized')
    expect(result.blockingReasons).toContain('policy_changed:claimCapLedgers')
    expect(result.machineSummary.releaseBoundaryClosed).toBe(false)
  })
})
