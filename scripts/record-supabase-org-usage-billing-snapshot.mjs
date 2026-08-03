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
const platformBase = 'https://api.supabase.com/platform'
const uncachedEgressHardBytes = 5 * 1024 * 1024 * 1024
const uncachedEgressHaltBytes = 4 * 1024 * 1024 * 1024
const cachedEgressHardBytes = 5 * 1024 * 1024 * 1024
const cachedEgressHaltBytes = 4 * 1024 * 1024 * 1024
const invocationHardCount = 500_000
const invocationHaltCount = 400_000

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function array(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`)
  return value
}

function nonNegativeNumber(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function integer(value, name) {
  const parsed = nonNegativeNumber(value, name)
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`)
  return parsed
}

async function platformRequest(path, options = {}) {
  const url = new URL(`${platformBase}${path}`)
  for (const [key, value] of Object.entries(options.searchParams ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
      ...(options.headers ?? {}),
    },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`Supabase Platform API ${path} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
    throw new Error(`Supabase Platform API ${path} returned error: ${parsed.error}`)
  }
  return parsed
}

async function findProject() {
  const limit = 100
  for (let page = 0; page < 20; page += 1) {
    const raw = object(await platformRequest('/projects', {
      headers: { Version: '2' },
      searchParams: { limit, offset: page * limit, sort: 'name_asc' },
    }), `projects page ${page}`)
    const projects = array(raw.projects, `projects page ${page}.projects`)
    const match = projects.find((candidate) => object(candidate, 'project').ref === projectRef)
    if (match) return object(match, 'matched project')
    const count = integer(raw.pagination?.count ?? projects.length, `projects page ${page}.pagination.count`)
    if ((page + 1) * limit >= count || projects.length < limit) break
  }
  throw new Error('exact Supabase project was not found in the authorized project list')
}

function findOrganization(rawOrganizations, organizationId) {
  const organizations = array(rawOrganizations, 'organizations')
  const matches = organizations
    .map((candidate, index) => object(candidate, `organization[${index}]`))
    .filter((candidate) => integer(candidate.id, 'organization.id') === organizationId)
  if (matches.length !== 1) {
    throw new Error(`exact project organization match count changed: ${matches.length}`)
  }
  const organization = matches[0]
  const slug = String(organization.slug ?? '')
  if (!/^[a-zA-Z0-9_-]{1,200}$/u.test(slug)) throw new Error('organization slug is invalid')
  return { organization, slug }
}

function aggregateUsage(raw) {
  const response = object(raw, 'daily usage response')
  const usages = array(response.usages, 'daily usage response.usages')
  const totals = {
    EGRESS: 0,
    CACHED_EGRESS: 0,
    FUNCTION_INVOCATIONS: 0,
  }
  let ignoredMetricRows = 0
  for (const [index, candidate] of usages.entries()) {
    const usage = object(candidate, `usage[${index}]`)
    const metric = String(usage.metric ?? '')
    const amount = nonNegativeNumber(usage.usage_original, `usage[${index}].usage_original`)
    if (Object.hasOwn(totals, metric)) totals[metric] += amount
    else ignoredMetricRows += 1
  }
  for (const [metric, total] of Object.entries(totals)) {
    if (!Number.isSafeInteger(total) || total < 0) throw new Error(`${metric} total is not a safe integer`)
  }
  return { usages, totals, ignoredMetricRows }
}

function readSubscription(raw) {
  const subscription = object(raw, 'organization subscription')
  const plan = object(subscription.plan, 'organization subscription.plan')
  const planId = String(plan.id ?? '')
  const usageBillingEnabled = subscription.usage_billing_enabled
  if (!/^[a-z0-9_-]{1,100}$/u.test(planId)) throw new Error('subscription plan id is invalid')
  if (typeof usageBillingEnabled !== 'boolean') throw new Error('usage_billing_enabled is unavailable')
  return { planId, usageBillingEnabled }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAt = new Date()
  const windowEnd = observedAt.toISOString().slice(0, 10)
  const windowStartDate = new Date(observedAt)
  windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 31)
  const windowStart = windowStartDate.toISOString().slice(0, 10)

  const [project, rawOrganizations] = await Promise.all([
    findProject(),
    platformRequest('/organizations'),
  ])
  const organizationId = integer(project.organization_id, 'project.organization_id')
  if (String(project.ref ?? '') !== projectRef) throw new Error('project reference changed after exact lookup')
  const { slug } = findOrganization(rawOrganizations, organizationId)

  const [rawUsage, rawSubscription] = await Promise.all([
    platformRequest(`/organizations/${encodeURIComponent(slug)}/usage/daily`, {
      searchParams: { start: windowStart, end: windowEnd, project_ref: projectRef },
    }),
    platformRequest(`/organizations/${encodeURIComponent(slug)}/billing/subscription`),
  ])

  const usage = aggregateUsage(rawUsage)
  const subscription = readSubscription(rawSubscription)
  const uncachedEgressBytes31d = usage.totals.EGRESS
  const cachedEgressBytes31d = usage.totals.CACHED_EGRESS
  const functionInvocations31d = usage.totals.FUNCTION_INVOCATIONS

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-org-usage-billing-snapshot',
    sourceRunId,
    sourceCommit,
    observedAt: observedAt.toISOString(),
    windowStart,
    windowEnd,
    windowDays: 31,
    planId: subscription.planId,
    usageBillingEnabled: subscription.usageBillingEnabled,
    usageRows: usage.usages.length,
    ignoredMetricRows: usage.ignoredMetricRows,
    uncachedEgressBytes31d,
    cachedEgressBytes31d,
    functionInvocations31d,
    thresholds: {
      uncachedEgressHaltBytes,
      uncachedEgressHardBytes,
      cachedEgressHaltBytes,
      cachedEgressHardBytes,
      invocationHaltCount,
      invocationHardCount,
    },
    checks: {
      officialOrganizationsEndpoint: true,
      officialProjectsEndpointVersion2: true,
      officialDailyUsageEndpoint: true,
      officialSubscriptionEndpoint: true,
      exactProjectOrganizationBinding: true,
      freePlanConfirmed: subscription.planId === 'free',
      automaticOverageDisabled: subscription.usageBillingEnabled === false,
      providerNoChargeStateConfirmed:
        subscription.planId === 'free' && subscription.usageBillingEnabled === false,
      uncachedEgressBelowHaltThreshold: uncachedEgressBytes31d < uncachedEgressHaltBytes,
      cachedEgressBelowHaltThreshold: cachedEgressBytes31d < cachedEgressHaltBytes,
      functionInvocationsBelowHaltThreshold: functionInvocations31d < invocationHaltCount,
      rawUsageRowsRetained: false,
      organizationSlugRetained: false,
      organizationIdRetained: false,
      billingIdentifiersRetained: false,
      profileSelected: false,
      g8Qualified: false,
    },
  }

  for (const [key, value] of Object.entries(evidence.checks)) {
    if (
      [
        'freePlanConfirmed',
        'automaticOverageDisabled',
        'providerNoChargeStateConfirmed',
        'uncachedEgressBelowHaltThreshold',
        'cachedEgressBelowHaltThreshold',
        'functionInvocationsBelowHaltThreshold',
      ].includes(key)
      && value !== true
    ) {
      throw new Error(`organization usage or billing guard failed: ${key}`)
    }
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
    schemaVersion: 1,
    purpose: 'r4c2d-org-usage-billing-snapshot',
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