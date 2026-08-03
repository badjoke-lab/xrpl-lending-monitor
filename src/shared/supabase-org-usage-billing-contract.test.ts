import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), 'utf8')
}

const recorder = read('scripts/record-supabase-org-usage-billing-snapshot.mjs')
const verifier = read('scripts/verify-supabase-resource-headroom-guard.mjs')
const publisher = read('scripts/publish-supabase-resource-run-locator.mjs')

describe('Supabase Management plan evidence contract', () => {
  it('uses only PAT-compatible public Management API endpoints', () => {
    for (const required of [
      "const managementBase = 'https://api.supabase.com/v1'",
      'managementRequest(`/projects/${projectRef}`)',
      'managementRequest(`/organizations/${encodeURIComponent(organizationSlug)}`)',
      'authorization: `Bearer ${accessToken}`',
      'patCompatibleManagementApi: true',
      'unsupportedStudioJwtEndpointsNotUsed: true',
    ]) expect(recorder).toContain(required)
    expect(recorder).not.toContain('https://api.supabase.com/platform')
    expect(recorder).not.toContain('/usage/daily')
    expect(recorder).not.toContain('/billing/subscription')
    expect(recorder).not.toContain('usage_billing_enabled')
  })

  it('binds the exact project to its provider-returned organization', () => {
    for (const required of [
      "if (project.ref !== projectRef)",
      'project.organization_slug',
      'Management API project organization slug is unavailable',
      'exactProjectIdentity: true',
      'exactProjectOrganizationBinding: true',
    ]) expect(recorder).toContain(required)
  })

  it('requires the provider organization to remain on the Free plan', () => {
    for (const required of [
      "const planId = String(organization.plan ?? '').toLowerCase()",
      "if (planId !== 'free')",
      'freePlanConfirmed: true',
      'freePlanNoChargePolicyApplicable: true',
      "billingReference = 'https://supabase.com/docs/guides/platform/billing-on-supabase'",
      'g8Qualified: false',
      'profileSelected: false',
    ]) expect(recorder).toContain(required)
  })

  it('does not overstate unavailable usage, egress, or automatic-overage coverage', () => {
    for (const required of [
      'organizationUsage: false',
      'uncachedEgress: false',
      'cachedEgress: false',
      'usageBillingFlag: false',
      'automaticOverageApiState: false',
      'billingAndOverageQualified: false',
      'egressCoverageNotOverstated: true',
      'automaticOverageCoverageNotOverstated: true',
    ]) expect(recorder).toContain(required)
  })

  it('does not retain organization or billing identities', () => {
    for (const required of [
      'organizationSlugRetained: false',
      'organizationIdRetained: false',
      'billingIdentifiersRetained: false',
    ]) expect(recorder).toContain(required)

    const successEvidenceStart = recorder.indexOf('const evidence = {')
    const successEvidenceEnd = recorder.indexOf('await writeFile(', successEvidenceStart)
    const evidenceBlock = recorder.slice(successEvidenceStart, successEvidenceEnd)
    expect(evidenceBlock).not.toContain('organizationSlug,')
    expect(evidenceBlock).not.toContain('organizationId,')
    expect(evidenceBlock).not.toContain('subscription_id')
    expect(evidenceBlock).not.toContain('billing_email')
  })

  it('executes before resource qualification and publishes the unresolved boundaries', () => {
    expect(verifier).toContain(
      "await import('./record-supabase-org-usage-billing-snapshot.mjs')",
    )
    expect(verifier.indexOf('record-supabase-org-usage-billing-snapshot.mjs')).toBeLessThan(
      verifier.indexOf('record-supabase-external-resource-snapshot.mjs'),
    )

    for (const required of [
      'org-usage-billing-snapshot.json',
      'failed-org-usage-billing-snapshot.json',
      'Management plan snapshot',
      'organization plan',
      'PAT-compatible Management API',
      'Free no-charge policy applicable',
      'organization usage coverage',
      'uncached egress coverage',
      'cached egress coverage',
      'usage billing flag coverage',
      'automatic overage API coverage',
      'billing and overage qualified',
    ]) expect(publisher).toContain(required)
  })
})