import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const retry = read('scripts/verify-supabase-steady-throughput-with-retry.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')

describe('Supabase strict steady qualification retry', () => {
  it('retries only the exact cadence gap or bounded transient provider failures', () => {
    for (const required of [
      "const cadenceRetryReason = 'steady completed ticks are not six consecutive minute buckets'",
      'const transientReadStatuses = [429, 500, 502, 503, 504, 520, 522, 524]',
      '`steady session read failed (${status}):`',
      '`steady session preparation failed (${status}):`',
      'if (first.code === 0) process.exit(0)',
      'const firstRetryReason = retryReason(first.output)',
      'if (firstRetryReason === null) process.exit(first.code)',
      'const second = await runVerifier(2)',
      'maximumAttempts: 2',
      'retryLimitedToExactCadenceGapOrTransientProviderFailure: true',
      'strictSixConsecutiveMinutesStillRequired: true',
      'noThresholdRelaxation: true',
    ]) expect(retry).toContain(required)

    expect(retry).not.toContain('runVerifier(3)')
    expect(retry).not.toContain('400, 401, 403, 404')
  })

  it('preserves the first retryable failure and leaves the second result authoritative', () => {
    for (const required of [
      'retryable-steady-cadence-gap-attempt-1.json',
      'retryable-steady-provider-failure-attempt-1.json',
      "retryClass: reason === cadenceRetryReason ? 'cadence_gap' : 'transient_provider_failure'",
      "await rm(source, { force: true })",
      'verified-steady-throughput.json',
      'steady-throughput-strict-retry-summary.json',
      'strictConsecutiveQualificationPassed: second.code === 0',
      'process.exit(second.code)',
    ]) expect(retry).toContain(required)
  })

  it('runs through the existing single Supabase workflow', () => {
    expect(workflow).toContain(
      "'scripts/verify-supabase-steady-throughput-with-retry.mjs'",
    )
    expect(workflow).toContain(
      'run: node scripts/verify-supabase-steady-throughput-with-retry.mjs',
    )
    expect(workflow).not.toContain(
      'run: node scripts/verify-supabase-steady-throughput.mjs\n',
    )
    expect(workflow).toContain('timeout-minutes: 35')
    expect(workflow).toContain('cancel-in-progress: false')
  })
})
