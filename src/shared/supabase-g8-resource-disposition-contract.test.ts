import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const providerProbe = read('scripts/record-supabase-provider-metric-capability.mjs')
const reconciler = read('scripts/reconcile-supabase-g8-resource-disposition.mjs')
const publisher = read('scripts/publish-supabase-provider-metric-capability.mjs')

describe('Supabase final G8 resource disposition contract', () => {
  it('runs immediately after sanitized provider capability evidence is written', () => {
    expect(providerProbe).toContain(
      "await import('./reconcile-supabase-g8-resource-disposition.mjs')",
    )
    expect(providerProbe.indexOf('provider-metric-capability.json')).toBeLessThan(
      providerProbe.indexOf('reconcile-supabase-g8-resource-disposition.mjs'),
    )
  })

  it('binds the exact Supabase revision-2 identity', () => {
    for (const required of [
      "const profileId = 'supabase_free_postgres_pgcron_edge'",
      'const profileRevision = 2',
      "const profileIdentityDigest = 'c42edf0a1708fd2b7ea9f2e72dab32b87c1d66b260752efe38fec321253d3998'",
      "gateId: 'G8'",
    ]) expect(reconciler).toContain(required)
  })

  it('requires same-run provider, runtime, plan, and memory evidence', () => {
    for (const required of [
      'provider-metric-capability.json',
      'steady-memory-capability.json',
      'runtime-resource-log-snapshot.json',
      'org-usage-billing-snapshot.json',
      "requireRunIdentity(provider, 'provider metric capability')",
      "requireRunIdentity(runtime, 'runtime resource snapshot')",
      "requireRunIdentity(plan, 'Management plan snapshot')",
      "provider.purpose !== 'r4c2d-provider-metric-capability'",
      "memory.purpose !== 'r4c2d-steady-memory-capability'",
      "runtime.purpose !== 'r4c2d-function-combined-stats-snapshot'",
      "plan.purpose !== 'r4c2d-management-plan-snapshot'",
    ]) expect(reconciler).toContain(required)
  })

  it('turns unavailable peak memory and egress evidence into hard-gate failure', () => {
    for (const required of [
      "failureReasons.push('provider_exact_peak_memory_unavailable')",
      "failureReasons.push('provider_egress_bytes_unavailable')",
      "failureReasons.push('runtime_total_memory_counter_unavailable')",
      "failureReasons.push('memory_headroom_not_qualified')",
      "const status = failureReasons.length > 0 ? 'fail' : 'unresolved'",
      "? 'reject_profile'",
      'unavailableHardGateEvidenceCausesFailure: failureReasons.length > 0',
      'profileRejectedWhenG8Fails: failureReasons.length > 0',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(reconciler).toContain(required)
  })

  it('never substitutes weaker signals for required provider evidence', () => {
    for (const required of [
      'requestCountsNotSubstitutedForEgressBytes: true',
      'averageMemoryNotSubstitutedForPeakMemory: true',
      'partialHeapNotSubstitutedForTotalMemory: true',
      'zeroRssNotSubstitutedForZeroUsage: true',
      'theoreticalProjectionNotSubstitutedForProviderEvidence: true',
      'hardGateFailureIndependentOfOtherPassingResources: true',
    ]) expect(reconciler).toContain(required)
  })

  it('retains explicit non-secret capability and failure evidence', () => {
    for (const required of [
      'patUsageApiCounts:',
      'patUsageApiRequestsCount:',
      'patFunctionsCombinedStats:',
      'patMetricsEndpoint:',
      'dashboardOrgDailyUsageWithPat:',
      'providerEgressBytesAvailable:',
      'exactPeakEdgeMemoryAvailable:',
      'allRssCountersZero:',
      'partialHeapCountersAvailable:',
      'usableTotalMemoryCounter:',
      'memoryHeadroomQualified:',
      'evidenceDigest: digest(core)',
      'g8-resource-disposition.json',
      'failed-g8-resource-disposition.json',
    ]) expect(reconciler).toContain(required)
  })

  it('publishes the final G8 disposition and rejection boundary', () => {
    for (const required of [
      'g8-resource-disposition.json',
      'failed-g8-resource-disposition.json',
      'R4C2d G8 final resource disposition',
      'G8 status',
      'disposition',
      'failure reasons',
      'request counts substituted for egress',
      'average memory substituted for peak memory',
      'partial heap substituted for total memory',
      'zero RSS substituted for zero usage',
      'unavailable hard-gate evidence causes failure',
      'profile rejected when G8 fails',
      'G8 qualified',
      'profile selected',
    ]) expect(publisher).toContain(required)
  })
})