import { readFile } from 'node:fs/promises'

import { describe, expect, it } from 'vitest'

import { auditR4fG3ProviderCaptureIndependent } from './verify-r4f-g3-provider-capture-independent.mjs'

const EXPECTED_PROJECT_DIGEST =
  '81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8'

async function validCapture() {
  const fixture = JSON.parse(
    await readFile(new URL('../ops/r4f/revision4-provider-capture-synthetic.json', import.meta.url), 'utf8'),
  )
  fixture.captureState = 'authorized_dashboard_capture'
  fixture.authorization.commentId = 123456789
  fixture.projectIdentityDigest = EXPECTED_PROJECT_DIGEST
  fixture.providerSurface.selectedProjectIdentityDigest = EXPECTED_PROJECT_DIGEST
  return fixture
}

function failedNames(result) {
  return result.failedChecks.map((check) => check.name)
}

describe('independent R4F G3 provider capture audit', () => {
  it('qualifies a fully bound authorized fixture without production reconciliation imports', async () => {
    const result = auditR4fG3ProviderCaptureIndependent(await validCapture())

    expect(result.auditQualified).toBe(true)
    expect(result.implementationDependency).toBe('none_on_production_reconciliation_code')
    expect(result.reconciliation).toMatchObject({
      providerDeltaLowerBoundBytes: 14001,
      providerDeltaUpperBoundBytes: 15999,
      selectedUnexplainedDeltaReserveBytes: 3525,
      applicationCoveredUpperBoundBytes: 15999,
      intervalUpperBoundCovered: true,
    })
    expect(result.profileSelected).toBe(false)
    expect(result.r5Authorized).toBe(false)
  })

  it('rejects synthetic evidence even when its arithmetic is internally consistent', async () => {
    const fixture = await validCapture()
    fixture.captureState = 'synthetic_test'

    const result = auditR4fG3ProviderCaptureIndependent(fixture)
    expect(result.auditQualified).toBe(false)
    expect(failedNames(result)).toContain('authorized_capture')
  })

  it.each([
    ['wrong project identity', (fixture) => {
      fixture.projectIdentityDigest = 'a'.repeat(64)
    }, 'provider_surface'],
    ['wrong selected project', (fixture) => {
      fixture.providerSurface.selectedProjectIdentityDigest = 'b'.repeat(64)
    }, 'provider_surface'],
    ['stale invocation count', (fixture) => {
      fixture.providerUsageFreshness.afterEdgeFunctionInvocations =
        fixture.providerUsageFreshness.beforeEdgeFunctionInvocations
    }, 'provider_usage_fresh'],
    ['AFTER outside billing period', (fixture) => {
      fixture.after.capturedAt = '2026-09-01T00:00:01.000Z'
    }, 'capture_timing'],
    ['authorization after BEFORE', (fixture) => {
      fixture.authorization.createdAt = '2026-08-06T06:00:01.000Z'
    }, 'capture_timing'],
    ['source commit mismatch', (fixture) => {
      fixture.authorization.sourceCommit = 'e'.repeat(40)
    }, 'authorized_capture'],
    ['invalid AFTER artifact digest', (fixture) => {
      fixture.after.sourceArtifactDigest = '0'.repeat(64)
    }, 'after_artifact_bound'],
    ['concurrent traffic not excluded', (fixture) => {
      fixture.concurrentTraffic.excluded = false
    }, 'concurrent_traffic_excluded'],
    ['missing concurrent traffic digest', (fixture) => {
      fixture.concurrentTraffic.evidenceArtifactDigests = []
    }, 'concurrent_traffic_artifacts_bound'],
    ['unsupported display rounding', (fixture) => {
      fixture.after.roundingRule = 'bankers_rounding'
    }, 'display_intervals'],
    ['provider mutation crossed boundary', (fixture) => {
      fixture.safety.providerMutationPerformed = true
    }, 'safety_boundary'],
    ['counter reset or scope change', (fixture) => {
      fixture.after.displayedValue = '0.900'
    }, 'no_counter_reset_or_scope_change'],
  ])('fails closed on mutation: %s', async (_name, mutate, expectedFailure) => {
    const fixture = await validCapture()
    mutate(fixture)

    const result = auditR4fG3ProviderCaptureIndependent(fixture)
    expect(result.auditQualified).toBe(false)
    expect(failedNames(result)).toContain(expectedFailure)
  })
})
