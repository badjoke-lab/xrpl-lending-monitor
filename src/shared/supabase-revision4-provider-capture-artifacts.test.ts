import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildSupabaseRevision4ProviderCaptureEvidence } from './supabase-revision4-provider-capture'

describe('Supabase revision-4 provider capture artifacts', () => {
  it('keeps the committed synthetic fixture permanently ineligible for G3', () => {
    const fixture = JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'ops/r4f/revision4-provider-capture-synthetic.json',
        ),
        'utf8',
      ),
    )
    const { evidenceClass, ...input } = fixture
    expect(evidenceClass).toBe('synthetic_test_only')

    const evidence = buildSupabaseRevision4ProviderCaptureEvidence(input)
    expect(evidence.captureState).toBe('synthetic_test')
    expect(evidence.authorizationVerified).toBe(false)
    expect(evidence.authorizationPrecedesBefore).toBe(true)
    expect(evidence.providerUsageFreshness.verified).toBe(true)
    expect(evidence.providerSurfaceVerified).toBe(true)
    expect(evidence.g3Qualified).toBe(false)
    expect(evidence.profileSelected).toBe(false)
    expect(evidence.r5Authorized).toBe(false)
  })

  it('keeps the operator template unexecuted, surface-bound, freshness-bound, and free of provider secrets', () => {
    const path = resolve(
      process.cwd(),
      'ops/r4f/revision4-provider-capture-template.json',
    )
    const text = readFileSync(path, 'utf8')
    const template = JSON.parse(text)

    expect(template).toMatchObject({
      templateState: 'unexecuted',
      qualificationIssue: 1261,
      authorizationScope: 'r4f_g3_dashboard_capture',
      requiredAuthorization: {
        separateIssueComment: true,
        owner: 'badjoke-lab',
        exactScopeRequired: true,
        exactSourceCommitRequired: true,
        createdBeforeBeforeCaptureRequired: true,
        sanitizedAuthorizationArtifactDigestRequired: true,
      },
      requiredProviderSurface: {
        source: 'organization_usage_page',
        metric: 'total_egress',
        projectFilterApplied: true,
        billingPeriodFilterApplied: true,
        cachedEgressIncluded: true,
        freshnessProof:
          'after_edge_function_invocations_at_least_before_plus_one',
      },
      executionAuthorized: false,
      providerRequestAuthorized: false,
      providerMutationAuthorized: false,
      r5Authorized: false,
      profileSelected: false,
    })
    for (const field of [
      'authorization.commentId',
      'authorization.sourceCommit',
      'authorization.createdAt',
      'authorization.evidenceDigest',
      'projectIdentityDigest',
      'providerSurface.selectedProjectIdentityDigest',
      'before.sourceArtifactDigest',
      'after.sourceArtifactDigest',
      'providerUsageFreshness.beforeEdgeFunctionInvocations',
      'providerUsageFreshness.afterEdgeFunctionInvocations',
      'concurrentTraffic.evidenceArtifacts',
      'concurrentTraffic.evidenceArtifactDigests',
    ]) {
      expect(template.requiredCaptureFields).toContain(field)
    }

    for (const forbiddenValue of [
      'eyJ',
      'postgresql://',
      'https://api.supabase.com/v1/projects/',
      'Bearer ',
      'service_role=',
      'password=',
    ]) {
      expect(text).not.toContain(forbiddenValue)
    }
  })
})
