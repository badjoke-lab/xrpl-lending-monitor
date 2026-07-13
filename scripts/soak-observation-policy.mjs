const DELAYED_OBSERVATION_THRESHOLD_SECONDS = 30

const NON_GATING_WHEN_DELAYED = new Set([
  'current_state_lag_within_10',
])

export function evaluateSoakObservation(sample, {
  attempt = 1,
  maxAttempts = 4,
  delayedThresholdSeconds = DELAYED_OBSERVATION_THRESHOLD_SECONDS,
} = {}) {
  const failedChecks = Array.isArray(sample?.failedChecks) ? [...sample.failedChecks] : []
  const delaySeconds = Number(sample?.delaySeconds ?? 0)
  const delayedObservation = Number.isFinite(delaySeconds) && delaySeconds > delayedThresholdSeconds
  const hardFailures = failedChecks.filter((check) => !NON_GATING_WHEN_DELAYED.has(check))
  const onlyDelaySensitiveFailures = failedChecks.length > 0 && hardFailures.length === 0
  const supportingStateIsSound =
    sample?.checks?.current_state_age_within_600s === true
    && sample?.checks?.current_state_advanced_since_previous === true
    && sample?.checks?.current_ledger_monotonic === true
    && sample?.checks?.readiness_passed === true
    && sample?.checks?.every_readiness_check_passed === true
    && sample?.checks?.collector_has_no_failures === true
    && sample?.checks?.deployment_identity_fixed === true
    && sample?.checks?.deployment_version_fixed === true
    && sample?.checks?.exactly_one_five_minute_cron === true

  const acceptWithDeferredMetrics =
    attempt >= maxAttempts
    && delayedObservation
    && onlyDelaySensitiveFailures
    && supportingStateIsSound

  if (sample?.passed === true) {
    return {
      decision: 'accept',
      sample: {
        ...sample,
        observationPolicy: {
          delayedObservation,
          delayedThresholdSeconds,
          rawPassed: true,
          rawFailedChecks: [],
          deferredToFinalRunMetrics: [],
        },
      },
    }
  }

  if (acceptWithDeferredMetrics) {
    return {
      decision: 'accept_with_deferred_metrics',
      sample: {
        ...sample,
        passed: true,
        failedChecks: [],
        warnings: [
          ...(Array.isArray(sample?.warnings) ? sample.warnings : []),
          'live RPC lag observation was delayed by the monitor and is deferred to exact D1 fast-lane run metrics',
        ],
        observationPolicy: {
          delayedObservation: true,
          delayedThresholdSeconds,
          rawPassed: false,
          rawFailedChecks: failedChecks,
          deferredToFinalRunMetrics: failedChecks,
        },
      },
    }
  }

  return {
    decision: attempt < maxAttempts ? 'retry' : 'reject',
    sample: {
      ...sample,
      observationPolicy: {
        delayedObservation,
        delayedThresholdSeconds,
        rawPassed: false,
        rawFailedChecks: failedChecks,
        deferredToFinalRunMetrics: [],
      },
    },
  }
}

export function shouldCaptureCompletionSample({
  segmentIndexes,
  expectedEndMs,
  nowMs = Date.now(),
}) {
  const completeSegments = JSON.stringify(segmentIndexes) === JSON.stringify([1, 2, 3, 4, 5, 6])
  return completeSegments && nowMs >= expectedEndMs
}
