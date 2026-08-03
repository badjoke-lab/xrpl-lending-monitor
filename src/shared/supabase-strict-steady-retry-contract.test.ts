import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const retry = read('scripts/verify-supabase-steady-throughput-with-retry.mjs')
const workflow = read('.github/workflows/supabase-remote-probe.yml')

describe('Supabase strict steady qualification retry', () => {
  it('retries only the exact missing-minute cadence failure', () => {
    for (const required of [
      "const retryableReason = 'steady completed ticks are not six consecutive minute buckets'",
      'if (first.code === 0) process.exit(0)',
      'if (!first.output.includes(retryableReason)) process.exit(first.code)',
      'const second = await runVerifier(2)',
      'maximumAttempts: 2',
      'retryLimitedToExactCadenceGap: true',
      'strictSixConsecutiveMinutesStillRequired: true',
      'noThresholdRelaxation: true',
    ]) expect(retry).toContain(required)
  })

  it('preserves the first cadence failure and leaves the second result authoritative', () => {
    for (const required of [
      'retryable-steady-cadence-gap-attempt-1.json',
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
