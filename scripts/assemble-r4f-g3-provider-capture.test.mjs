import { describe, expect, it } from 'vitest'

import { assembleR4fG3ProviderCapture } from './assemble-r4f-g3-provider-capture.mjs'

const PROJECT = '81378864f4d6650a60a2c09a95629a18780d49fc23836e0f6a024b70f13f88a8'
const PROFILE = '39e8b620a20bb08fbe8306fe753d4d445c5191bcafddbf67721e0c17d5b6bcd5'
const COMMIT = 'a'.repeat(40)
const DIGEST = 'b'.repeat(64)

function valid(overrides = {}) {
  const dashboardBody = `/r4f-g3-dashboard-authorize scope=r4f_g3_dashboard_capture commit=${COMMIT} project=${PROJECT} job=290 command=${'c'.repeat(64)} prepare_run=123`
  return {
    afterSequence: {
      oneShotRun: 456,
      pauseRun: 124,
      resumeRun: 457,
      dashboardAuthorizationCommentId: 1001,
      beforeCommentId: 1002,
      afterCommentId: 1003,
      projectIdentityDigest: PROJECT,
      beforeCapturedAt: '2026-08-09T04:45:01Z',
      afterCapturedAt: '2026-08-09T05:45:01Z',
      beforeInvocations: 18921,
      afterInvocations: 18922,
      invocationDelta: 1,
      beforeArtifactDigest: '1'.repeat(64),
      afterArtifactDigest: '2'.repeat(64),
      usageFresh: true,
    },
    comments: [
      {
        id: 1001,
        user: { login: 'badjoke-lab' },
        created_at: '2026-08-09T04:30:00Z',
        body: dashboardBody,
      },
    ],
    oneShotSummary: {
      schemaVersion: 1,
      qualificationIssue: 1261,
      runId: 456,
      sourceCommit: COMMIT,
      projectIdentityDigest: PROJECT,
      profileIdentityDigest: PROFILE,
      accountingDigest: DIGEST,
      rollingBillableEgressUpperBoundBytes: 12474,
    },
    logWindow: {
      schemaVersion: 1,
      purpose: 'r4f-g3-concurrent-traffic-log-window',
      targetRun: 456,
      projectIdentityDigest: PROJECT,
      interval: {
        start: '2026-08-09T04:45:01Z',
        end: '2026-08-09T05:45:01Z',
      },
      classification: {
        noOtherFunctionRequestsObserved: true,
        otherFunctionRequestCount: 0,
        otherNetworkRequestCount: 0,
      },
    },
    billingPeriodStart: '2026-07-16T00:00:00Z',
    billingPeriodEnd: '2026-08-16T00:00:00Z',
    beforeEgress: '0.129',
    afterEgress: '0.130',
    unit: 'GB',
    decimalPlaces: 3,
    roundingRule: 'nearest_half_up',
    retainedReserveBytes: 0,
    ...overrides,
  }
}

describe('formal R4F G3 provider capture assembly', () => {
  it('binds the verified sequence, one-shot accounting, dashboard authorization, and log window', () => {
    const result = assembleR4fG3ProviderCapture(valid())
    expect(result.captureState).toBe('authorized_dashboard_capture')
    expect(result.captureId).toBe('r4f-g3-live-456')
    expect(result.providerUsageFreshness).toEqual({
      beforeEdgeFunctionInvocations: 18921,
      afterEdgeFunctionInvocations: 18922,
    })
    expect(result.application.rollingBillableEgressUpperBoundBytes).toBe(12474)
    expect(result.concurrentTraffic.excluded).toBe(true)
    expect(result.safety.publicReaderUnchanged).toBe(true)
    expect(result.safety.mainnetDisabled).toBe(true)
  })

  it('fails closed when the provider interval contains other traffic', () => {
    const input = valid()
    input.logWindow.classification.otherNetworkRequestCount = 1
    expect(() => assembleR4fG3ProviderCapture(input)).toThrow(/concurrent provider traffic/i)
  })

  it('fails closed when the dashboard authorization is not bound to the one-shot commit', () => {
    const input = valid()
    input.oneShotSummary.sourceCommit = 'd'.repeat(40)
    expect(() => assembleR4fG3ProviderCapture(input)).toThrow(/dashboard authorization/i)
  })

  it('fails closed when Usage freshness disappears', () => {
    const input = valid()
    input.afterSequence.afterInvocations = 18921
    input.afterSequence.invocationDelta = 0
    input.afterSequence.usageFresh = false
    expect(() => assembleR4fG3ProviderCapture(input)).toThrow(/freshness/i)
  })
})
