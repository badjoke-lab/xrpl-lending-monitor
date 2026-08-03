import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const recorder = read('scripts/record-supabase-org-usage-billing-snapshot.mjs')
const verifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const publisher = read('scripts/publish-supabase-resource-run-locator.mjs')

describe('Supabase organization usage and billing evidence contract', () => {
  it('binds the exact project to exactly one authorized organization', () => {
    for (const required of [
      "const platformBase = 'https://api.supabase.com/platform'",
      "platformRequest('/projects'",
      "headers: { Version: '2' }",
      "object(candidate, 'project').ref === projectRef",
      "platformRequest('/organizations')",
      "integer(project.organization_id, 'project.organization_id')",
      'exact project organization match count changed',
      'exactProjectOrganizationBinding: true',
    ]) expect(recorder).toContain(required)
  })

  it('uses the official project-scoped daily usage and subscription endpoints', () => {
    for (const required of [
      '/usage/daily',
      'project_ref: projectRef',
      '/billing/subscription',
      "officialDailyUsageEndpoint: true",
      "officialSubscriptionEndpoint: true",
      "EGRESS: 0",
      "CACHED_EGRESS: 0",
      "FUNCTION_INVOCATIONS: 0",
      'usage.usage_original',
    ]) expect(recorder).toContain(required)
  })

  it('halts before the Free egress and invocation ceilings', () => {
    for (const required of [
      'const uncachedEgressHardBytes = 5 * 1024 * 1024 * 1024',
      'const uncachedEgressHaltBytes = 4 * 1024 * 1024 * 1024',
      'const cachedEgressHardBytes = 5 * 1024 * 1024 * 1024',
      'const cachedEgressHaltBytes = 4 * 1024 * 1024 * 1024',
      'const invocationHardCount = 500_000',
      'const invocationHaltCount = 400_000',
      'uncachedEgressBytes31d < uncachedEgressHaltBytes',
      'cachedEgressBytes31d < cachedEgressHaltBytes',
      'functionInvocations31d < invocationHaltCount',
      'organization usage or billing guard failed',
    ]) expect(recorder).toContain(required)
  })

  it('requires the Free no-charge and automatic-overage-disabled state', () => {
    for (const required of [
      "subscription.planId === 'free'",
      'subscription.usageBillingEnabled === false',
      'freePlanConfirmed:',
      'automaticOverageDisabled:',
      'providerNoChargeStateConfirmed:',
      'usage_billing_enabled is unavailable',
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(recorder).toContain(required)
  })

  it('does not retain organization or billing identities', () => {
    for (const required of [
      'rawUsageRowsRetained: false',
      'organizationSlugRetained: false',
      'organizationIdRetained: false',
      'billingIdentifiersRetained: false',
    ]) expect(recorder).toContain(required)

    const successEvidenceStart = recorder.indexOf('const evidence = {')
    const successEvidenceEnd = recorder.indexOf('for (const [key, value]', successEvidenceStart)
    const evidenceBlock = recorder.slice(successEvidenceStart, successEvidenceEnd)
    expect(evidenceBlock).not.toContain('slug,')
    expect(evidenceBlock).not.toContain('organizationId,')
    expect(evidenceBlock).not.toContain('subscription_id')
    expect(evidenceBlock).not.toContain('billing_email')
  })

  it('executes before resource qualification and publishes only sanitized aggregates', () => {
    expect(verifier).toContain(
      "await import('./record-supabase-org-usage-billing-snapshot.mjs')",
    )
    expect(verifier.indexOf('record-supabase-org-usage-billing-snapshot.mjs')).toBeLessThan(
      verifier.indexOf('record-supabase-external-resource-snapshot.mjs'),
    )

    for (const required of [
      'org-usage-billing-snapshot.json',
      'failed-org-usage-billing-snapshot.json',
      'organization usage and billing snapshot',
      'organization plan',
      'automatic overage enabled',
      'uncached egress bytes 31d',
      'cached egress bytes 31d',
      'function invocations 31d',
      'provider no-charge state confirmed',
      'organization slug retained',
      'billing identifiers retained',
    ]) expect(publisher).toContain(required)
  })
})