import { mkdir, writeFile } from 'node:fs/promises'

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const runIdText = process.env.GITHUB_RUN_ID ?? ''
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
if (!/^[1-9][0-9]*$/u.test(runIdText)) throw new Error('GITHUB_RUN_ID must be a positive integer')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')

const sourceRunId = Number(runIdText)
if (!Number.isSafeInteger(sourceRunId)) throw new Error('GITHUB_RUN_ID exceeds the safe integer range')

const evidenceDirectory = 'supabase-remote-probe-evidence'
const managementBase = 'https://api.supabase.com/v1'
const managementReference = 'https://supabase.com/docs/reference/api/introduction'
const billingReference = 'https://supabase.com/docs/guides/platform/billing-on-supabase'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

async function managementRequest(path) {
  const response = await fetch(`${managementBase}${path}`, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`Supabase Management API ${path} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
    throw new Error(`Supabase Management API ${path} returned error: ${parsed.error}`)
  }
  return parsed
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAt = new Date().toISOString()
  const project = object(
    await managementRequest(`/projects/${projectRef}`),
    'Management API project',
  )
  if (project.ref !== projectRef) throw new Error('Management API project reference changed')

  const organizationSlug = String(project.organization_slug ?? '')
  if (!/^[a-zA-Z0-9_-]{1,200}$/u.test(organizationSlug)) {
    throw new Error('Management API project organization slug is unavailable')
  }
  const organization = object(
    await managementRequest(`/organizations/${encodeURIComponent(organizationSlug)}`),
    'Management API organization',
  )
  const planId = String(organization.plan ?? '').toLowerCase()
  if (!/^[a-z0-9_-]{1,100}$/u.test(planId)) throw new Error('Management API organization plan is invalid')
  if (planId !== 'free') throw new Error(`organization plan is not Free:${planId}`)

  const evidence = {
    schemaVersion: 2,
    purpose: 'r4c2d-management-plan-snapshot',
    sourceRunId,
    sourceCommit,
    observedAt,
    planId,
    policyReferences: {
      managementApi: managementReference,
      billing: billingReference,
    },
    coverage: {
      exactProjectIdentity: true,
      exactProjectOrganizationBinding: true,
      providerPlan: true,
      freePlanNoChargePolicyApplicable: true,
      organizationUsage: false,
      uncachedEgress: false,
      cachedEgress: false,
      usageBillingFlag: false,
      automaticOverageApiState: false,
      billingAndOverageQualified: false,
    },
    checks: {
      patCompatibleManagementApi: true,
      exactProjectIdentity: true,
      exactProjectOrganizationBinding: true,
      freePlanConfirmed: true,
      unsupportedStudioJwtEndpointsNotUsed: true,
      egressCoverageNotOverstated: true,
      automaticOverageCoverageNotOverstated: true,
      organizationSlugRetained: false,
      organizationIdRetained: false,
      billingIdentifiersRetained: false,
      profileSelected: false,
      g8Qualified: false,
    },
  }

  await writeFile(
    `${evidenceDirectory}/org-usage-billing-snapshot.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
  console.log(JSON.stringify(evidence))
}

try {
  await run()
} catch (error) {
  await mkdir(evidenceDirectory, { recursive: true })
  const failure = {
    schemaVersion: 2,
    purpose: 'r4c2d-management-plan-snapshot',
    sourceRunId,
    sourceCommit,
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-org-usage-billing-snapshot.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}