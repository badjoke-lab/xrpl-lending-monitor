import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  MAXIMUM_BILLABLE_EGRESS_BYTES,
  MAXIMUM_BILLABLE_EGRESS_BYTES_PER_LEDGER,
  PROFILE_ID,
  PROFILE_IDENTITY_DIGEST,
  qualifyRevision4AccountingEvidence,
} from '../../scripts/qualify-supabase-revision4-r5-accounting.mjs'

function accountingFixture(rollingBillableEgressUpperBoundBytes: number) {
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
  const directionalSummary = {
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
  }
  const accounting = {
    schemaVersion: 1,
    profileId: PROFILE_ID,
    profileRevision: 4,
    profileIdentityDigest: PROFILE_IDENTITY_DIGEST,
    observationId: 'r4f-rev4-test-observation',
    attemptId: 'r4f-rev4-test-attempt',
    observedAt: '2026-08-10T12:00:00.000Z',
    disposition: 'runtime_precommit_completed',
    observations,
    directionalSummary,
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

function rewriteAccounting(
  fixture: ReturnType<typeof accountingFixture>,
  mutate: (accounting: Record<string, any>) => void,
) {
  const accounting = JSON.parse(fixture.accountingJson)
  mutate(accounting)
  fixture.accountingJson = JSON.stringify(accounting)
  fixture.accountingDigest = createHash('sha256').update(fixture.accountingJson, 'utf8').digest('hex')
  return fixture
}

describe('revision-4 exact 12-ledger accounting qualifier', () => {
  it('passes exactly at 4,581 bytes per ledger and emits a deterministic digest', () => {
    const first = qualifyRevision4AccountingEvidence(accountingFixture(MAXIMUM_BILLABLE_EGRESS_BYTES))
    const second = qualifyRevision4AccountingEvidence(accountingFixture(MAXIMUM_BILLABLE_EGRESS_BYTES))

    expect(PROFILE_ID).toBe('supabase_free_postgres_pgcron_edge')
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

    const profileIdMismatch = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.profileId = 'unexpected-profile'
    })
    expect(() => qualifyRevision4AccountingEvidence(profileIdMismatch)).toThrow(/accounting.profileId mismatch/u)

    const accountingProfileMismatch = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.profileIdentityDigest = '0'.repeat(64)
    })
    expect(() => qualifyRevision4AccountingEvidence(accountingProfileMismatch)).toThrow(
      /accounting profileIdentityDigest mismatch/u,
    )

    expect(() => qualifyRevision4AccountingEvidence({
      ...accountingFixture(54_000),
      finalizedEgressUpperBoundBytes: 53_999,
    })).toThrow(/finalizedEgressUpperBoundBytes does not match/u)
  })

  it('recomputes directional and memory totals from observations instead of trusting persisted summaries', () => {
    const summaryMismatch = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.directionalSummary.rollingBillableEgressUpperBoundBytes = 53_999
    })
    expect(() => qualifyRevision4AccountingEvidence(summaryMismatch)).toThrow(
      /directionalSummary does not match observations/u,
    )

    const rollingMismatch = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.rollingBillableEgressUpperBoundBytes = 53_999
    })
    expect(() => qualifyRevision4AccountingEvidence(rollingMismatch)).toThrow(
      /rolling upper bound does not match observations plus unexplained reserve/u,
    )

    const memoryMismatch = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.memoryTransportUpperBoundBytes -= 1
    })
    expect(() => qualifyRevision4AccountingEvidence(memoryMismatch)).toThrow(
      /memory transport upper bound does not match observations plus supplements/u,
    )
  })

  it('rejects observation schema drift, unsupported boundaries, duplicate operations, and noncanonical timestamps', () => {
    const unsupportedBoundary = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.observations[0].boundaryId = 'unknown_boundary'
    })
    expect(() => qualifyRevision4AccountingEvidence(unsupportedBoundary)).toThrow(/boundaryId is unsupported/u)

    const sequenceDrift = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.observations[0].sequence = 1
    })
    expect(() => qualifyRevision4AccountingEvidence(sequenceDrift)).toThrow(/sequence must be contiguous/u)

    const badTimestamp = rewriteAccounting(accountingFixture(54_000), (accounting) => {
      accounting.observedAt = '2026-08-10 12:00:00'
    })
    expect(() => qualifyRevision4AccountingEvidence(badTimestamp)).toThrow(/observedAt must be canonical UTC/u)
  })
})
