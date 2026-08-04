import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/supabase-remote-probe.yml'),
  'utf8',
)

function position(text: string): number {
  const index = workflow.indexOf(text)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

describe('R5 first batch workflow priority', () => {
  it('runs only after active execution and its committed reader', () => {
    expect(position('Verify repeated remote portable phase execution')).toBeLessThan(
      position('Freeze exact R5 active checkpoint'),
    )
    expect(position('Verify remote immutable committed reader')).toBeLessThan(
      position('Freeze exact R5 active checkpoint'),
    )
  })

  it('keeps checkpoint, readiness, and first batch contiguous and ordered', () => {
    const checkpoint = position('Freeze exact R5 active checkpoint')
    const ready = position('Prepare or verify exact R5 active recovery')
    const firstBatch = position('Execute and verify exactly one first R5 recovery batch')
    expect(checkpoint).toBeLessThan(ready)
    expect(ready).toBeLessThan(firstBatch)
    expect(workflow.slice(checkpoint, firstBatch)).not.toContain(
      'Verify isolated historical witness persistence and reader',
    )
  })

  it('executes the first batch before all isolated and long qualification steps', () => {
    const firstBatch = position('Execute and verify exactly one first R5 recovery batch')
    for (const laterStep of [
      'Verify isolated historical witness persistence and reader',
      'Verify isolated standard-phase multi-chunk execution and reader',
      'Verify isolated complete-state export and typed restore',
      'Verify isolated post-restore continuation',
      'Verify isolated remote fault qualification',
      'Verify throughput and resource baseline',
      'Verify isolated catch-up throughput',
      'Verify network steady throughput',
      'Verify resource headroom fail-closed guards',
    ]) {
      expect(firstBatch).toBeLessThan(position(laterStep))
    }
  })

  it('retains one execution and one R5 publication path', () => {
    expect(
      workflow.match(/node scripts\/verify-supabase-r5-first-recovery-batch\.mjs/gu),
    ).toHaveLength(1)
    expect(
      workflow.match(/node scripts\/publish-supabase-r5-first-recovery-batch-run-locator\.mjs/gu),
    ).toHaveLength(1)
    expect(workflow.match(/gh issue comment 1175/gu)).toHaveLength(1)
  })
})
