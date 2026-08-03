import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const reconciler = read('scripts/reconcile-supabase-steady-memory-capability.mjs')
const planRecorder = read('scripts/record-supabase-org-usage-billing-snapshot.mjs')
const publisher = read('scripts/publish-supabase-steady-run-locator.mjs')

describe('Supabase steady memory capability reconciliation', () => {
  it('inspects every retained RSS, heap, and external counter', () => {
    for (const required of [
      'completedTicks.length !== 6',
      'tick.memorySamples.length < 6',
      'rssBytes: nonNegativeInteger(sample.rssBytes',
      'heapTotalBytes: nonNegativeInteger(sample.heapTotalBytes',
      'heapUsedBytes: nonNegativeInteger(sample.heapUsedBytes',
      'externalBytes: nonNegativeInteger(sample.externalBytes',
      'samples.length >= 36',
    ]) expect(reconciler).toContain(required)
  })

  it('treats all-zero runtime counters as unavailable rather than zero usage', () => {
    for (const required of [
      'const allRuntimeCountersZero = samples.every',
      'sample.rssBytes === 0',
      'sample.heapTotalBytes === 0',
      'sample.heapUsedBytes === 0',
      'sample.externalBytes === 0',
      'const usableRuntimeCounters = !allRuntimeCountersZero',
      'zeroCountersNotInterpretedAsZeroUsage: true',
      'runtimeMemoryMeasurementAvailable: usableRuntimeCounters',
      'memoryHeadroomQualified: usableRuntimeCounters',
      'memoryCoverageNotOverstated: true',
    ]) expect(reconciler).toContain(required)
  })

  it('removes fake high-water and headroom values when counters are unavailable', () => {
    for (const required of [
      'minimumMemoryHighWaterBytes: null',
      'p50MemoryHighWaterBytes: null',
      'p95MemoryHighWaterBytes: null',
      'maximumMemoryHighWaterBytes: null',
      'memoryHeadroomBytes: null',
      'allSixTicksBelowHalt: null',
      'memoryHeadroomQualified: false',
      'sixCompletedTicksMemoryMeasured: usableRuntimeCounters',
      'requiredMemoryPhasesMeasured: usableRuntimeCounters',
      'memoryHighWaterRecalculated: usableRuntimeCounters',
      'memoryFailClosedBelowHardLimit: usableRuntimeCounters',
      'memoryQualified: usableRuntimeCounters',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(reconciler).toContain(required)
  })

  it('runs before the final resource evidence is published', () => {
    expect(planRecorder).toContain(
      "await import('./reconcile-supabase-steady-memory-capability.mjs')",
    )
    for (const required of [
      'steady-memory-capability.json',
      'failed-steady-memory-capability.json',
      'steady memory runtime counters available',
      'all runtime memory counters zero',
      'zero counters interpreted as zero usage',
      'steady memory high water qualified',
      "'unavailable'",
      'memory coverage not overstated',
    ]) expect(publisher).toContain(required)
  })
})