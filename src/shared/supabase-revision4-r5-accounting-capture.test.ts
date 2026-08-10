import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  PROFILE_ID,
  PROFILE_IDENTITY_DIGEST,
  qualifyRevision4AccountingEvidence,
} from '../../scripts/qualify-supabase-revision4-r5-accounting.mjs'
import { buildQualificationInputFromEvidence } from '../../scripts/capture-supabase-revision4-r5-accounting-qualification.mjs'

const BATCH_ID = 'r5-batch-v1-r5-recovery-selected-revision4-entry-00000001'

function accountingFixture(rollingBillableEgressUpperBoundBytes = 48_000) {
  const observations = [
    {
      schemaVersion: 1,
      sequence: 0,
      operationId: 'r5.edge.xrpl.requests',
      boundaryId: 'edge_to_xrpl_request',
      bodyBytes: rollingBillableEgressUpperBoundBytes,
      framingReserveBytes: 0,
    },
  ]
  const accounting = {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    observationId: `r5.rev4.${BATCH_ID}`,
    attemptId: `r5.rev4.${BATCH_ID}.attempt.1`,
    observedAt: '2026-08-10T13:00:00.000Z',
    disposition: 'runtime_precommit_completed',
    observations,
    directionalSummary: {
      rollingBillableEgressUpperBoundBytes,
      memoryTransportBytes: rollingBillableEgressUpperBoundBytes,
      byBoundary: [
        {
          boundaryId: 'edge_to_xrpl_request',
          totalBytes: rollingBillableEgressUpperBoundBytes,
          rollingBillableEgressBytes: rollingBillableEgressUpperBoundBytes,
          memoryTransportBytes: rollingBillableEgressUpperBoundBytes,
        },
      ],
    },
    memorySupplemental: {
      canonicalJsonBytes: 1,
      payloadBytes: 1,
      normalizedObjectOverheadBytes: 1,
      allocatorReserveBytes: 1,
    },
    unexplainedDirectionalDeltaReserveBytes: 0,
    rollingBillableEgressUpperBoundBytes,
    memoryTransportUpperBoundBytes: rollingBillableEgressUpperBoundBytes + 4,
    checks: {
      exactProfileIdentityBound: true,
      everyObservationDirectionBoundByContract: true,
      inboundBytesRemainInMemoryTransport: true,
      blanketAllDirectionMultiplierUsed: false,
      accountingPreparedBeforeAtomicCompletion: true,
      accountingMustCommitAtomicallyWithWork: true,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
  const accountingJson = JSON.stringify(accounting)
  const accountingDigest = createHash('sha256').update(accountingJson, 'utf8').digest('hex')
  return { accountingJson, accountingDigest, rollingBillableEgressUpperBoundBytes }
}

function evidenceFixture() {
  const accounting = accountingFixture()
  return {
    schemaVersion: 1,
    purpose: 'r4f-revision4-r5-accounting-qualification-evidence',
    found: true,
    qualificationKey: 'r4f-revision4-r5-12-ledger-accounting-v1',
    runId: 'r5-recovery-selected-revision4-entry',
    batchId: BATCH_ID,
    batchSequence: 1,
    startLedgerIndex: 4_400_000,
    endLedgerIndex: 4_400_011,
    ledgerCount: 12,
    profileId: PROFILE_ID,
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    selectionDigest: '1'.repeat(64),
    accountingJson: accounting.accountingJson,
    accountingJsonBytes: Buffer.byteLength(accounting.accountingJson, 'utf8'),
    accountingDigest: accounting.accountingDigest,
    finalizedEgressUpperBoundBytes: accounting.rollingBillableEgressUpperBoundBytes,
    completedAt: '2026-08-10T13:00:00.000Z',
    capturedAt: '2026-08-10T13:00:00.010Z',
    boundedSingletonStorage: true,
    completionRequestBodyUnchanged: true,
    completionResponseBodyUnchanged: true,
    publicReaderUnchanged: true,
    mainnetDisabled: true,
  }
}

function expectedFixture(evidence = evidenceFixture()) {
  return {
    expectedBatchId: BATCH_ID,
    expectedAccountingDigest: evidence.accountingDigest,
    expectedFinalizedEgressUpperBoundBytes: evidence.finalizedEgressUpperBoundBytes,
    workflowRunId: 123,
    workflowRunAttempt: 1,
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  }
}

describe('revision-4 bounded accounting capture', () => {
  it('binds one database singleton to the executor response and exact qualifier', () => {
    const evidence = evidenceFixture()
    const input = buildQualificationInputFromEvidence(evidence, expectedFixture(evidence))
    const qualification = qualifyRevision4AccountingEvidence(input)

    expect(input.tickId).toBe(BATCH_ID)
    expect(input.ledgerCount).toBe(12)
    expect(input.accountingDigest).toBe(evidence.accountingDigest)
    expect(qualification.pass).toBe(true)
    expect(qualification.rollingBillableEgressUpperBoundBytes).toBe(48_000)
    expect(qualification.perLedgerBillableEgressUpperBoundBytes).toBe(4_000)
  })

  it('rejects stale singleton evidence and executor parity drift', () => {
    const evidence = evidenceFixture()
    expect(() => buildQualificationInputFromEvidence(
      { ...evidence, batchId: evidence.batchId.replace('00000001', '00000002') },
      expectedFixture(evidence),
    )).toThrow(/identity or safety boundary changed/u)

    expect(() => buildQualificationInputFromEvidence(
      evidence,
      { ...expectedFixture(evidence), expectedAccountingDigest: 'f'.repeat(64) },
    )).toThrow(/does not match executor response/u)

    expect(() => buildQualificationInputFromEvidence(
      evidence,
      { ...expectedFixture(evidence), expectedFinalizedEgressUpperBoundBytes: 47_999 },
    )).toThrow(/finalized egress does not match executor response/u)
  })

  it('rejects tampered bytes, unsafe boundaries, and impossible timestamps', () => {
    const evidence = evidenceFixture()
    expect(() => buildQualificationInputFromEvidence(
      { ...evidence, accountingJsonBytes: evidence.accountingJsonBytes + 1 },
      expectedFixture(evidence),
    )).toThrow(/byte count mismatch/u)

    expect(() => buildQualificationInputFromEvidence(
      { ...evidence, completionResponseBodyUnchanged: false },
      expectedFixture(evidence),
    )).toThrow(/identity or safety boundary changed/u)

    expect(() => buildQualificationInputFromEvidence(
      { ...evidence, capturedAt: '2026-08-10T12:59:59.999Z' },
      expectedFixture(evidence),
    )).toThrow(/captured before completion/u)
  })

  it('keeps qualification storage bounded and the live response contract unchanged', () => {
    const migration = readFileSync(
      'supabase/migrations/20260810133000_xrpl_r5_revision4_accounting_qualification_evidence.sql',
      'utf8',
    )

    expect(migration).toContain("qualification_key = 'r4f-revision4-r5-12-ledger-accounting-v1'")
    expect(migration).toContain('if v_batch.ledger_count = 12 then')
    expect(migration).toContain('on conflict (qualification_key) do update')
    expect(migration).toContain('return v_result;')
    expect(migration).toContain('completionRequestBodyUnchanged')
    expect(migration).toContain('completionResponseBodyUnchanged')
    expect(migration.toLowerCase()).not.toContain('truncate table')
    expect(migration.toLowerCase()).not.toContain('delete from')
  })
})
