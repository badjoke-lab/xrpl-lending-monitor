import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  MAXIMUM_BILLABLE_EGRESS_BYTES,
  MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER,
  PROFILE_IDENTITY_DIGEST,
  qualifyRevision4AccountingEvidence,
} from '../../scripts/qualify-supabase-revision4-r5-accounting.mjs'

function accountingFixture(rollingBillableEgressUpperBoundBytes: number) {
  const accounting = {
    schemaVersion: 1,
    profileId: 'supabase_free_postgres_pgcron_edge',
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    observationId: 'r4f-rev4-test-observation',
    attemptId: 'r4f-rev4-test-attempt',
    observedAt: '2026-08-10T12:00:00.000Z',
    disposition: 'runtime_precommit_completed',
    observations: [
      {
        operationId: 'r5.edge.xrpl.requests',
        boundaryId: 'edge_to_xrpl_request',
        bodyBytes: 1_000,
        framingReserveBytes: 6_656,
      },
    ],
    directionalSummary: {
      rollingBillableEgressUpperBoundBytes,
    },
    memorySupplemental: {
      canonicalJsonBytes: 1,
      payloadBytes: 1,
      normalizedObjectOverheadBytes: 1,
      allocatorReserveBytes: 1,
    },
    unexplainedDirectionalDeltaReserveBytes: 0,
    rollingBillableEgressUpperBoundBytes,
    memoryTransportUpperBoundBytes: 4,
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
  return {
    sessionId: 'r4f-rev4-test-session',
    tickId: 'r4f-rev4-test-tick',
    ledgerCount: 12,
    status: 'completed',
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    finalizedEgressUpperBoundBytes: rollingBillableEgressUpperBoundBytes,
    accountingJson,
    accountingDigest,
    workflowRunId: 1,
    workflowRunAttempt: 1,
    sourceCommit: '0123456789abcdef0123456789abcdef01234567',
  }
}

describe('revision-4 exact 12-ledger accounting qualifier', () => {
  it('passes exactly at 4,581 bytes per ledger and emits a deterministic digest', () => {
    const first = qualifyRevision4AccountingEvidence(accountingFixture(MAXIMUM_BILLABLE_EGRESS_BYTES))
    const second = qualifyRevision4AccountingEvidence(accountingFixture(MAXIMUM_BILLABLE_EGRESS_BYTES))

    expect(MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER).toBe(4_581)
    expect(MAXIMUM_BILLABLE_EGRESS_BYTES).toBe(54_972)
    expect(first.pass).toBe(true)
    expect(first.perLedgerBillableEgressUpperBoundBytes).toBe(4_581)
    expect(first.remainingBillableEgressBytes).toBe(0)
    expect(first.qualificationDigest).toBe(second.qualificationDigest)
    expect(first.qualificationDigest).toMatch(/^[a-f0-9]{64}$/u)
  })

  it('returns FAIL one byte above the 12-ledger ceiling instead of throwing away the evidence', () => {
    const result = qualifyRevision4AccountingEvidence(accountingFixture(54_973))

    expect(result.pass).toBe(false)
    expect(result.remainingBillableEgressBytes).toBe(-1)
    expect(result.perLedgerBillableEgressUpperBoundBytes).toBe(54_973 / 12)
  })

  it('rejects anything other than one completed 12-ledger revision-4 observation', () => {
    expect(() => qualifyRevision4AccountingEvidence({
      ...accountingFixture(54_000),
      ledgerCount: 11,
    })).toThrow(/ledgerCount must be exactly 12/u)

    expect(() => qualifyRevision4AccountingEvidence({
      ...accountingFixture(54_000),
      status: 'leased',
    })).toThrow(/status must be completed/u)

    expect(() => qualifyRevision4AccountingEvidence({
      ...accountingFixture(54_000),
      profileRevision: 3,
    })).toThrow(/profileRevision must be 4/u)
  })

  it('rejects altered accounting bytes, profile drift, and mismatched finalized totals', () => {
    const digestMismatch = accountingFixture(54_000)
    digestMismatch.accountingJson = `${digestMismatch.accountingJson} `
    expect(() => qualifyRevision4AccountingEvidence(digestMismatch)).toThrow(/accountingDigest does not match/u)

    const accountingProfileMismatch = accountingFixture(54_000)
    const accounting = JSON.parse(accountingProfileMismatch.accountingJson)
    accounting.profileIdentityDigest = '0'.repeat(64)
    accountingProfileMismatch.accountingJson = JSON.stringify(accounting)
    accountingProfileMismatch.accountingDigest = createHash('sha256')
      .update(accountingProfileMismatch.accountingJson, 'utf8')
      .digest('hex')
    expect(() => qualifyRevision4AccountingEvidence(accountingProfileMismatch)).toThrow(
      /accounting profileIdentityDigest mismatch/u,
    )

    expect(() => qualifyRevision4AccountingEvidence({
      ...accountingFixture(54_000),
      finalizedEgressUpperBoundBytes: 53_999,
    })).toThrow(/finalizedEgressUpperBoundBytes does not match/u)
  })
})
