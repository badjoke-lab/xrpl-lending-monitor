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

  it('requires a positive RSS counter for total-memory qualification', () => {
    for (const required of [
      'const allRssCountersZero = samples.every((sample) => sample.rssBytes === 0)',
      'const allHeapTotalCountersZero = samples.every((sample) => sample.heapTotalBytes === 0)',
      'const partialHeapCountersAvailable = !allHeapTotalCountersZero',
      'const usableTotalMemoryCounter = !allRssCountersZero',
      'rssCounterRequiredForTotalMemoryQualification: true',
      'runtimeMemoryMeasurementAvailable: usableTotalMemoryCounter',
      'partialHeapCountersNotSubstitutedForRss: true',
      'zeroRssNotInterpretedAsZeroUsage: true',
      'memoryHeadroomQualified: usableTotalMemoryCounter',
      'memoryCoverageNotOverstated: true',
    ]) expect(reconciler).toContain(required)
  })

  it('retains all-zero detection without accepting partial heap counters as RSS', () => {
    for (const required of [
      'const allRuntimeCountersZero = samples.every',
      'sample.rssBytes === 0',
      'sample.heapTotalBytes === 0',
      'sample.heapUsedBytes === 0',
      'sample.externalBytes === 0',
      'allRuntimeCountersZero,',
      'allRssCountersZero,',
      'allHeapTotalCountersZero,',
      'partialHeapCountersAvailable,',
      'usableTotalMemoryCounter,',
    ]) expect(reconciler).toContain(required)
  })

  it('removes fake high-water and headroom values when RSS is unavailable', () => {
    for (const required of [
      'minimumMemoryHighWaterBytes: null',
      'p50MemoryHighWaterBytes: null',
      'p95MemoryHighWaterBytes: null',
      'maximumMemoryHighWaterBytes: null',
      'memoryHeadroomBytes: null',
      'allSixTicksBelowHalt: null',
      'memoryHeadroomQualified: false',
      'sixCompletedTicksMemoryMeasured: usableTotalMemoryCounter',
      'requiredMemoryPhasesMeasured: usableTotalMemoryCounter',
      'memoryHighWaterRecalculated: usableTotalMemoryCounter',
      'memoryFailClosedBelowHardLimit: usableTotalMemoryCounter',
      'memoryQualified: usableTotalMemoryCounter',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(reconciler).toContain(required)
  })

  it('runs before final publication and exposes the RSS capability boundary', () => {
    expect(planRecorder).toContain(
      "await import('./reconcile-supabase-steady-memory-capability.mjs')",
    )
    for (const required of [
      'steady-memory-capability.json',
      'failed-steady-memory-capability.json',
      'steady total-memory RSS counter available',
      'steady partial heap counters available',
      'all RSS counters zero',
      'all heap-total counters zero',
      'partial heap counters substituted for RSS',
      'zero RSS interpreted as zero usage',
      'steady memory high water qualified',
      "'unavailable'",
      'memory coverage not overstated',
    ]) expect(publisher).toContain(required)
  })
})