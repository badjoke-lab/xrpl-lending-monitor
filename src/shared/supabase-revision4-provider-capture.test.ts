import { describe, expect, it } from 'vitest'

import {
  buildSupabaseRevision4ProviderCaptureEvidence,
  providerDisplayReadingToByteInterval,
  type SupabaseRevision4ProviderCaptureInput,
} from './supabase-revision4-provider-capture'

function baseInput(): SupabaseRevision4ProviderCaptureInput {
  return {
    schemaVersion: 1,
    profileId: 'supabase_free_postgres_pgcron_edge',
    profileRevision: 4,
    profileIdentityDigest:
      '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5',
    captureState: 'synthetic_test',
    captureId: 'r4f-g3-capture-test-001',
    authorization: {
      issueNumber: 1261,
      commentId: null,
      actor: 'badjoke-lab',
      scope: 'r4f_g3_dashboard_capture',
      sourceCommit: 'c'.repeat(40),
      evidenceArtifact: 'synthetic-authorization.json',
      evidenceDigest: 'd'.repeat(64),
    },
    projectIdentityDigest: 'a'.repeat(64),
    providerSurface: {
      source: 'organization_usage_page',
      metric: 'total_egress',
      projectFilterApplied: true,
      selectedProjectIdentityDigest: 'a'.repeat(64),
      billingPeriodFilterApplied: true,
      cachedEgressIncluded: true,
    },
    billingPeriodStart: '2026-08-01T00:00:00.000Z',
    billingPeriodEnd: '2026-09-01T00:00:00.000Z',
    before: {
      displayedValue: '1000000',
      unit: 'bytes',
      decimalPlaces: 0,
      roundingRule: 'exact',
      capturedAt: '2026-08-06T06:00:00.000Z',
      sourceArtifact: 'synthetic-before.json',
      sourceArtifactDigest: '1'.repeat(64),
    },
    after: {
      displayedValue: '1015000',
      unit: 'bytes',
      decimalPlaces: 0,
      roundingRule: 'exact',
      capturedAt: '2026-08-06T06:05:00.000Z',
      sourceArtifact: 'synthetic-after.json',
      sourceArtifactDigest: '2'.repeat(64),
    },
    application: {
      rollingBillableEgressUpperBoundBytes: 12_474,
      retainedUnexplainedDeltaReserveBytes: 2_526,
      accountingDigest: 'b'.repeat(64),
      sourceCommit: 'c'.repeat(40),
      sourceRunId: 1,
    },
    concurrentTraffic: {
      excluded: true,
      evidenceArtifacts: ['synthetic-traffic-window.json'],
      evidenceArtifactDigests: ['3'.repeat(64)],
    },
    providerCapabilities: {
      managementApiEgressBytesAvailable: false,
      dashboardPatAuthorized: false,
      dashboardExactByteExportAvailable: false,
      logsResponseBytesAvailable: false,
    },
    safety: {
      providerMutationPerformed: false,
      productionMigrationPerformed: false,
      recoveryMutationCommitted: false,
      publicReaderUnchanged: true,
      mainnetDisabled: true,
      stabilizationAuthorized: false,
      soakAuthorized: false,
    },
  }
}

describe('Supabase revision-4 bounded provider capture contract', () => {
  it('converts exact byte displays without inventing a range', () => {
    expect(
      providerDisplayReadingToByteInterval({
        displayedValue: '1234',
        unit: 'bytes',
        decimalPlaces: 0,
        roundingRule: 'exact',
        capturedAt: '2026-08-06T06:00:00.000Z',
        sourceArtifact: 'exact.json',
        sourceArtifactDigest: 'a'.repeat(64),
      }),
    ).toEqual({ lowerBoundBytes: 1234, upperBoundBytes: 1234 })
  })

  it('converts a decimal MB display using nearest-half-up bounds', () => {
    expect(
      providerDisplayReadingToByteInterval({
        displayedValue: '1.50',
        unit: 'MB',
        decimalPlaces: 2,
        roundingRule: 'nearest_half_up',
        capturedAt: '2026-08-06T06:00:00.000Z',
        sourceArtifact: 'rounded.json',
        sourceArtifactDigest: 'a'.repeat(64),
      }),
    ).toEqual({
      lowerBoundBytes: 1_495_000,
      upperBoundBytes: 1_504_999,
    })
  })

  it('converts a truncated binary-unit display conservatively', () => {
    expect(
      providerDisplayReadingToByteInterval({
        displayedValue: '2.0',
        unit: 'MiB',
        decimalPlaces: 1,
        roundingRule: 'truncate_down',
        capturedAt: '2026-08-06T06:00:00.000Z',
        sourceArtifact: 'truncated.json',
        sourceArtifactDigest: 'a'.repeat(64),
      }),
    ).toEqual({
      lowerBoundBytes: 2_097_152,
      upperBoundBytes: 2_202_009,
    })
  })

  it('never accepts a synthetic capture as G3 evidence', () => {
    const evidence = buildSupabaseRevision4ProviderCaptureEvidence(baseInput())

    expect(evidence.authorizationVerified).toBe(false)
    expect(evidence.providerSurfaceVerified).toBe(true)
    expect(evidence.reconciliation.providerDeltaInterval).toEqual({
      lowerBoundBytes: 15_000,
      upperBoundBytes: 15_000,
    })
    expect(evidence.reconciliation.intervalUpperBoundCovered).toBe(true)
    expect(evidence.g3Qualified).toBe(false)
    expect(evidence.profileSelected).toBe(false)
    expect(evidence.r5Authorized).toBe(false)
  })

  it('accepts only a separately authorized capture on the project-filtered Total Egress surface', () => {
    const input = baseInput()
    const evidence = buildSupabaseRevision4ProviderCaptureEvidence({
      ...input,
      captureState: 'authorized_dashboard_capture',
      authorization: { ...input.authorization, commentId: 123456 },
    })

    expect(evidence.authorizationVerified).toBe(true)
    expect(evidence.providerSurfaceVerified).toBe(true)
    expect(evidence.reconciliation.intervalReconciliationReady).toBe(true)
    expect(evidence.reconciliation.intervalUpperBoundCovered).toBe(true)
    expect(evidence.g3Qualified).toBe(true)
    expect(evidence.profileSelected).toBe(false)
    expect(evidence.r5Authorized).toBe(false)
  })

  it('rejects an authorization that is not bound to the application source commit', () => {
    const input = baseInput()
    const evidence = buildSupabaseRevision4ProviderCaptureEvidence({
      ...input,
      captureState: 'authorized_dashboard_capture',
      authorization: {
        ...input.authorization,
        commentId: 123456,
        sourceCommit: 'e'.repeat(40),
      },
    })

    expect(evidence.authorizationVerified).toBe(false)
    expect(evidence.g3Qualified).toBe(false)
  })

  it('rejects an arbitrary Dashboard metric or missing project filter', () => {
    const input = baseInput()
    const wrongProject = buildSupabaseRevision4ProviderCaptureEvidence({
      ...input,
      captureState: 'authorized_dashboard_capture',
      authorization: { ...input.authorization, commentId: 123456 },
      providerSurface: {
        ...input.providerSurface,
        projectFilterApplied: false,
      },
    })
    expect(wrongProject.providerSurfaceVerified).toBe(false)
    expect(wrongProject.g3Qualified).toBe(false)

    const wrongIdentity = buildSupabaseRevision4ProviderCaptureEvidence({
      ...input,
      captureState: 'authorized_dashboard_capture',
      authorization: { ...input.authorization, commentId: 123456 },
      providerSurface: {
        ...input.providerSurface,
        selectedProjectIdentityDigest: 'f'.repeat(64),
      },
    })
    expect(wrongIdentity.providerSurfaceVerified).toBe(false)
    expect(wrongIdentity.g3Qualified).toBe(false)
  })

  it('fails closed without concurrent-traffic exclusion', () => {
    const input = baseInput()
    const concurrentTraffic = buildSupabaseRevision4ProviderCaptureEvidence({
      ...input,
      captureState: 'authorized_dashboard_capture',
      authorization: { ...input.authorization, commentId: 123456 },
      concurrentTraffic: {
        ...input.concurrentTraffic,
        excluded: false,
      },
    })
    expect(concurrentTraffic.g3Qualified).toBe(false)
  })

  it('rejects missing artifact digests and secret-bearing capture input', () => {
    const input = baseInput()
    expect(() =>
      buildSupabaseRevision4ProviderCaptureEvidence({
        ...input,
        before: { ...input.before, sourceArtifactDigest: '0'.repeat(64) },
      }),
    ).toThrow('before source artifact digest is invalid')

    expect(() =>
      buildSupabaseRevision4ProviderCaptureEvidence({
        ...input,
        authorization: {
          ...input.authorization,
          evidenceArtifact: 'Bearer abcdefghijklmnopqrstuvwxyz',
        },
      }),
    ).toThrow('provider capture input contains secret material')
  })

  it('rejects malformed display precision and non-integral exact displays', () => {
    expect(() =>
      providerDisplayReadingToByteInterval({
        displayedValue: '1.5',
        unit: 'MB',
        decimalPlaces: 2,
        roundingRule: 'nearest_half_up',
        capturedAt: '2026-08-06T06:00:00.000Z',
        sourceArtifact: 'invalid.json',
        sourceArtifactDigest: 'a'.repeat(64),
      }),
    ).toThrow('displayedValue does not match decimalPlaces')

    expect(() =>
      providerDisplayReadingToByteInterval({
        displayedValue: '0.1',
        unit: 'bytes',
        decimalPlaces: 1,
        roundingRule: 'exact',
        capturedAt: '2026-08-06T06:00:00.000Z',
        sourceArtifact: 'invalid.json',
        sourceArtifactDigest: 'a'.repeat(64),
      }),
    ).toThrow('exact display value does not resolve to whole bytes')
  })

  it('rejects placeholder project identity and cross-period timestamps', () => {
    const input = baseInput()
    expect(() =>
      buildSupabaseRevision4ProviderCaptureEvidence({
        ...input,
        projectIdentityDigest: '0'.repeat(64),
      }),
    ).toThrow('projectIdentityDigest is invalid')

    expect(() =>
      buildSupabaseRevision4ProviderCaptureEvidence({
        ...input,
        after: {
          ...input.after,
          capturedAt: '2026-09-01T00:00:00.001Z',
        },
      }),
    ).toThrow('capture timestamps must be ordered inside one billing period')
  })
})
