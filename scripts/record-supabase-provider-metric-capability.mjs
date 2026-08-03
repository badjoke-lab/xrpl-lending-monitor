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
const managementProjectBase = `https://api.supabase.com/v1/projects/${projectRef}`
const managementBase = 'https://api.supabase.com/v1'
const dashboardBase = 'https://api.supabase.com/platform'
const interval = '1day'

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function collectFieldNames(value, prefix = '', depth = 0, names = new Set()) {
  if (depth > 8 || value === null || value === undefined) return names
  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 10)) collectFieldNames(entry, prefix, depth + 1, names)
    return names
  }
  if (typeof value !== 'object') return names
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.trim()
    if (!normalizedKey) continue
    const path = prefix ? `${prefix}.${normalizedKey}` : normalizedKey
    names.add(path)
    collectFieldNames(nested, path, depth + 1, names)
  }
  return names
}

function matchingFields(fieldNames, pattern) {
  return fieldNames.filter((name) => pattern.test(name)).sort()
}

async function request(url, { required = false } = {}) {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/plain;q=0.9',
    },
    signal: AbortSignal.timeout(60_000),
  })
  const contentType = String(response.headers.get('content-type') ?? '').split(';')[0].trim()
  const text = await response.text()
  let parsed = null
  try { parsed = JSON.parse(text) } catch {}
  if (required && !response.ok) {
    throw new Error(`required Supabase metric endpoint failed (${response.status})`)
  }
  return {
    ok: response.ok,
    status: response.status,
    contentType,
    parsed,
    text: parsed === null ? text : '',
  }
}

function sanitizedEndpoint(name, response) {
  const fieldNames = response.parsed === null
    ? []
    : [...collectFieldNames(response.parsed)].sort()
  const metricNames = response.parsed === null
    ? [...new Set(
        [...response.text.matchAll(/^([a-zA-Z_:][a-zA-Z0-9_:]*)/gmu)].map((match) => match[1]),
      )].sort()
    : []
  return {
    name,
    ok: response.ok,
    status: response.status,
    contentType: response.contentType,
    fieldNames,
    metricNames,
  }
}

function activeFunctionId(raw) {
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.functions)
      ? raw.functions
      : Array.isArray(raw?.data)
        ? raw.data
        : null
  if (!values) throw new Error('Management API function list has an unsupported shape')
  const active = values.find((value) =>
    value && typeof value === 'object'
    && String(value.status ?? '').toUpperCase() === 'ACTIVE'
    && /^[0-9a-f-]{16,64}$/iu.test(String(value.id ?? ''))
  )
  if (!active) throw new Error('Management API returned no active function identity')
  return String(active.id)
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAt = new Date().toISOString()

  const projectResponse = await request(`${managementBase}/projects/${projectRef}`, { required: true })
  const project = object(projectResponse.parsed, 'Management API project')
  if (project.ref !== projectRef) throw new Error('Management API project reference changed')
  const organizationSlug = String(project.organization_slug ?? '')
  if (!/^[a-zA-Z0-9_-]{1,200}$/u.test(organizationSlug)) {
    throw new Error('Management API project organization slug is unavailable')
  }

  const functionsResponse = await request(`${managementProjectBase}/functions`, { required: true })
  const functionId = activeFunctionId(functionsResponse.parsed)

  const apiCountsUrl = new URL(`${managementProjectBase}/analytics/endpoints/usage.api-counts`)
  apiCountsUrl.searchParams.set('interval', interval)
  const combinedStatsUrl = new URL(
    `${managementProjectBase}/analytics/endpoints/functions.combined-stats`,
  )
  combinedStatsUrl.searchParams.set('interval', interval)
  combinedStatsUrl.searchParams.set('function_id', functionId)

  const today = new Date(observedAt)
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1_000)
  const orgDailyUrl = new URL(
    `${dashboardBase}/organizations/${encodeURIComponent(organizationSlug)}/usage/daily`,
  )
  orgDailyUrl.searchParams.set('start', yesterday.toISOString().slice(0, 10))
  orgDailyUrl.searchParams.set('end', today.toISOString().slice(0, 10))
  orgDailyUrl.searchParams.set('project_ref', projectRef)

  const probes = await Promise.all([
    request(apiCountsUrl),
    request(`${managementProjectBase}/analytics/endpoints/usage.api-requests-count`),
    request(combinedStatsUrl),
    request(`${managementProjectBase}/analytics/endpoints/metrics`),
    request(orgDailyUrl),
  ])
  const endpoints = [
    sanitizedEndpoint('usage.api-counts', probes[0]),
    sanitizedEndpoint('usage.api-requests-count', probes[1]),
    sanitizedEndpoint('functions.combined-stats', probes[2]),
    sanitizedEndpoint('metrics', probes[3]),
    sanitizedEndpoint('organization.usage.daily', probes[4]),
  ]

  const managementFields = endpoints
    .filter((entry) => entry.name !== 'organization.usage.daily')
    .flatMap((entry) => [...entry.fieldNames, ...entry.metricNames])
  const egressFields = matchingFields(
    managementFields,
    /(?:^|[._])(cached_)?egress(?:$|[._])|bandwidth|response_bytes|bytes_sent/iu,
  )
  const peakMemoryFields = matchingFields(
    managementFields,
    /(?:max|peak|high_water|rss)[a-z0-9_.-]*memory|memory[a-z0-9_.-]*(?:max|peak|high_water|rss)/iu,
  ).filter((name) => !/(?:avg|average)/iu.test(name))
  const averageMemoryFields = matchingFields(
    managementFields,
    /(?:avg|average)[a-z0-9_.-]*memory|memory[a-z0-9_.-]*(?:avg|average)/iu,
  )
  const requestCountFields = matchingFields(
    managementFields,
    /requests?_count|total_[a-z0-9_]*requests?/iu,
  )

  const organizationUsage = endpoints.find((entry) => entry.name === 'organization.usage.daily')
  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-provider-metric-capability',
    sourceRunId,
    sourceCommit,
    observedAt,
    interval,
    endpoints,
    discoveredFields: {
      providerEgress: egressFields,
      exactPeakMemory: peakMemoryFields,
      averageMemory: averageMemoryFields,
      requestCounts: requestCountFields,
    },
    coverage: {
      patProjectIdentity: true,
      patFunctionList: true,
      patUsageApiCounts: endpoints[0].ok,
      patUsageApiRequestsCount: endpoints[1].ok,
      patFunctionsCombinedStats: endpoints[2].ok,
      patMetricsEndpoint: endpoints[3].ok,
      dashboardOrgDailyUsageWithPat: organizationUsage?.ok === true,
      requestCountsAvailable: requestCountFields.length > 0,
      averageMemoryAvailable: averageMemoryFields.length > 0,
      providerEgressBytesAvailable: egressFields.length > 0,
      exactPeakEdgeMemoryAvailable: peakMemoryFields.length > 0,
    },
    checks: {
      onlyPatAndPublicProjectIdentityUsed: true,
      organizationSlugRetained: false,
      projectRefRetained: false,
      functionIdRetained: false,
      rawResponseValuesRetained: false,
      fieldNamesOnlyRetained: true,
      providerCoverageNotOverstated: true,
      providerEgressUnavailableWhenNoFieldExists: egressFields.length === 0,
      exactPeakMemoryUnavailableWhenNoFieldExists: peakMemoryFields.length === 0,
      g8Qualified: false,
      profileSelected: false,
    },
  }

  await writeFile(
    `${evidenceDirectory}/provider-metric-capability.json`,
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
    purpose: 'r4c2d-provider-metric-capability',
    sourceRunId,
    sourceCommit,
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
    checks: {
      g8Qualified: false,
      profileSelected: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/failed-provider-metric-capability.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}