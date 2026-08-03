import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const script = readFileSync(
  resolve(process.cwd(), 'scripts/verify-supabase-steady-throughput-with-retry.mjs'),
  'utf8',
)

describe('Supabase strict steady retry contract', () => {
  it('retries only the exact cadence gap, request timeout, or bounded provider statuses', () => {
    for (const required of [
      "const cadenceRetryReason = 'steady completed ticks are not six consecutive minute buckets'",
      'const transientReadStatuses = [429, 500, 502, 503, 504, 520, 522, 524]',
      "const transientTimeoutReason = 'The operation was aborted due to timeout'",
      '`steady session read failed (${status}):`',
      '`steady session preparation failed (${status}):`',
      'retryableReasons.find((reason) => output.includes(reason)) ?? null',
      'if (firstRetryReason === null) process.exit(first.code)',
      'exactRequestTimeoutRetryReason: transientTimeoutReason',
    ]) {
      expect(script).toContain(required)
    }
    expect(script).not.toContain('400, 401, 403, 404')
    expect(script).not.toContain("'fetch failed'")
  })

  it('uses at most one fresh session retry and preserves the first failure', () => {
    for (const required of [
      'const first = await runVerifier(1)',
      'const second = await runVerifier(2)',
      'maximumAttempts: 2',
      'retryable-steady-cadence-gap-attempt-1.json',
      'retryable-steady-provider-failure-attempt-1.json',
      "retryClass: reason === cadenceRetryReason ? 'cadence_gap' : 'transient_provider_failure'",
      'secondSessionFresh: true',
    ]) {
      expect(script).toContain(required)
    }
    expect(script).not.toContain('runVerifier(3)')
  })

  it('does not relax the six-minute performance contract', () => {
    for (const required of [
      'strictSixConsecutiveMinutesStillRequired: true',
      'noThresholdRelaxation: true',
      'strictConsecutiveQualificationPassed: second.code === 0',
      'process.exit(second.code)',
    ]) {
      expect(script).toContain(required)
    }
  })
})