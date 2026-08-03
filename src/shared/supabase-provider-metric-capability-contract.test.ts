import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const probe = read('scripts/record-supabase-provider-metric-capability.mjs')
const externalSnapshot = read('scripts/record-supabase-external-resource-snapshot.mjs')
const operatorPublisher = read('scripts/publish-supabase-operator-run-locator.mjs')
const publisher = read('scripts/publish-supabase-provider-metric-capability.mjs')

describe('Supabase provider metric capability contract', () => {
  it('probes every relevant PAT and Dashboard metric surface', () => {
    for (const required of [
      '/analytics/endpoints/usage.api-counts',
      '/analytics/endpoints/usage.api-requests-count',
      '/analytics/endpoints/functions.combined-stats',
      '/analytics/endpoints/metrics',
      '/platform',
      '/usage/daily',
      "apiCountsUrl.searchParams.set('interval', interval)",
      "combinedStatsUrl.searchParams.set('function_id', functionId)",
      "orgDailyUrl.searchParams.set('project_ref', projectRef)",
    ]) expect(probe).toContain(required)
  })

  it('retains field names and statuses instead of provider values or identities', () => {
    for (const required of [
      'function collectFieldNames',
      'function sanitizedEndpoint',
      'fieldNames,',
      'metricNames,',
      'organizationSlugRetained: false',
      'projectRefRetained: false',
      'functionIdRetained: false',
      'rawResponseValuesRetained: false',
      'fieldNamesOnlyRetained: true',
      'providerCoverageNotOverstated: true',
    ]) expect(probe).toContain(required)

    expect(probe).not.toContain('organizationSlug,\n    sourceRunId')
    expect(probe).not.toContain('projectRef,\n    endpoints')
    expect(probe).not.toContain('functionId,\n    endpoints')
  })

  it('separates request counts and average memory from egress bytes and peak memory', () => {
    for (const required of [
      'requestCountsAvailable: requestCountFields.length > 0',
      'averageMemoryAvailable: averageMemoryFields.length > 0',
      'providerEgressBytesAvailable: egressFields.length > 0',
      'exactPeakEdgeMemoryAvailable: peakMemoryFields.length > 0',
      'providerEgressUnavailableWhenNoFieldExists: egressFields.length === 0',
      'exactPeakMemoryUnavailableWhenNoFieldExists: peakMemoryFields.length === 0',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(probe).toContain(required)

    expect(probe).toContain('avg|average')
    expect(probe).toContain('max|peak|high_water|rss')
    expect(probe).toContain('egress')
    expect(probe).toContain('bandwidth')
  })

  it('runs after official combined statistics and before the external snapshot is finalized', () => {
    const runtimeImport = "await import('./record-supabase-runtime-resource-log-snapshot.mjs')"
    const capabilityImport = "await import('./record-supabase-provider-metric-capability.mjs')"
    expect(externalSnapshot).toContain(runtimeImport)
    expect(externalSnapshot).toContain(capabilityImport)
    expect(externalSnapshot.indexOf(runtimeImport)).toBeLessThan(
      externalSnapshot.indexOf(capabilityImport),
    )
    expect(externalSnapshot.indexOf(capabilityImport)).toBeLessThan(
      externalSnapshot.indexOf("const projectRef = process.env.SUPABASE_PROJECT_ID"),
    )
  })

  it('publishes success, failure, endpoint status, and unresolved G8 boundaries', () => {
    expect(operatorPublisher).toContain(
      "await import('./publish-supabase-provider-metric-capability.mjs')",
    )
    for (const required of [
      'provider-metric-capability.json',
      'failed-provider-metric-capability.json',
      'R4C2d provider metric capability',
      'usage.api-counts status',
      'usage.api-requests-count status',
      'functions.combined-stats status',
      'organization usage daily with PAT status',
      'provider egress bytes available',
      'exact peak Edge memory available',
      'raw response values retained',
      'provider coverage not overstated',
      'G8 qualified',
      'profile selected',
    ]) expect(publisher).toContain(required)
  })
})