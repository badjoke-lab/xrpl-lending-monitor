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
const managementBase = `https://api.supabase.com/v1/projects/${projectRef}`
const interval = '1day'
const cpuHardMilliseconds = 2_000
const cpuHaltMilliseconds = 1_600
const memoryHardMegabytes = 256
const memoryHaltMegabytes = 200

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function nonNegativeNumber(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function positiveInteger(value, name) {
  const parsed = nonNegativeNumber(value, name)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive safe integer`)
  }
  return parsed
}

async function managementRequest(path, searchParams) {
  const url = new URL(`${managementBase}${path}`)
  for (const [key, value] of Object.entries(searchParams ?? {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
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

function extractActiveFunctions(raw) {
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.functions)
      ? raw.functions
      : Array.isArray(raw?.data)
        ? raw.data
        : null
  if (!values) throw new Error('Management API function list has an unsupported shape')

  const functions = values
    .map((value, index) => object(value, `function[${index}]`))
    .filter((value) => String(value.status ?? '').toUpperCase() === 'ACTIVE')
    .map((value) => ({
      id: String(value.id ?? '').trim(),
      slug: String(value.slug ?? value.name ?? '').trim(),
      version: positiveInteger(value.version, `function ${String(value.slug ?? value.name)} version`),
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug))

  if (
    functions.length < 1
    || functions.some((value) => !/^[0-9a-f-]{16,64}$/iu.test(value.id))
    || functions.some((value) => !/^[a-z0-9][a-z0-9-]*$/u.test(value.slug))
  ) {
    throw new Error('Management API returned no valid active functions')
  }
  if (
    new Set(functions.map((value) => value.id)).size !== functions.length
    || new Set(functions.map((value) => value.slug)).size !== functions.length
  ) {
    throw new Error('Management API returned duplicate active function identities')
  }
  return functions
}

function extractRows(raw, functionSlug) {
  const rows = Array.isArray(raw?.result)
    ? raw.result
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw)
        ? raw
        : null
  if (!rows) throw new Error(`combined statistics for ${functionSlug} have an unsupported shape`)
  return rows.map((value, index) => object(value, `${functionSlug} combined statistics row ${index}`))
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length < 1) throw new Error('percentile requires at least one value')
  const rank = Math.max(1, Math.ceil(sortedValues.length * fraction))
  return sortedValues[Math.min(sortedValues.length - 1, rank - 1)]
}

function statistics(values) {
  const sorted = [...values].sort((left, right) => left - right)
  return {
    minimum: sorted[0],
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    maximum: sorted.at(-1),
  }
}

function rowMetrics(row, functionSlug, index) {
  const success = nonNegativeNumber(row.success_count ?? 0, `${functionSlug}[${index}].success_count`)
  const redirect = nonNegativeNumber(row.redirect_count ?? 0, `${functionSlug}[${index}].redirect_count`)
  const clientError = nonNegativeNumber(row.client_err_count ?? 0, `${functionSlug}[${index}].client_err_count`)
  const serverError = nonNegativeNumber(row.server_err_count ?? 0, `${functionSlug}[${index}].server_err_count`)
  const statusInvocationCount = success + redirect + clientError + serverError
  const requestsCount = nonNegativeNumber(
    row.requests_count ?? statusInvocationCount,
    `${functionSlug}[${index}].requests_count`,
  )
  if (requestsCount < statusInvocationCount) {
    throw new Error(`${functionSlug}[${index}] request count is below classified invocation count`)
  }

  return {
    statusInvocationCount,
    requestsCount,
    maxCpuMilliseconds: nonNegativeNumber(
      row.max_cpu_time_used ?? 0,
      `${functionSlug}[${index}].max_cpu_time_used`,
    ),
    averageCpuMilliseconds: nonNegativeNumber(
      row.avg_cpu_time_used ?? 0,
      `${functionSlug}[${index}].avg_cpu_time_used`,
    ),
    averageMemoryMegabytes: nonNegativeNumber(
      row.avg_memory_used ?? 0,
      `${functionSlug}[${index}].avg_memory_used`,
    ),
    averageHeapMemoryMegabytes: nonNegativeNumber(
      row.avg_heap_memory_used ?? 0,
      `${functionSlug}[${index}].avg_heap_memory_used`,
    ),
    averageExternalMemoryMegabytes: nonNegativeNumber(
      row.avg_external_memory_used ?? 0,
      `${functionSlug}[${index}].avg_external_memory_used`,
    ),
    maxExecutionMilliseconds: nonNegativeNumber(
      row.max_execution_time ?? 0,
      `${functionSlug}[${index}].max_execution_time`,
    ),
  }
}

async function mapWithConcurrency(values, concurrency, mapper) {
  const results = new Array(values.length)
  let nextIndex = 0
  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAt = new Date().toISOString()
  const functions = extractActiveFunctions(await managementRequest('/functions'))

  const functionStats = await mapWithConcurrency(functions, 4, async (fn) => {
    const raw = await managementRequest('/analytics/endpoints/functions.combined-stats', {
      interval,
      function_id: fn.id,
    })
    const rows = extractRows(raw, fn.slug)
    const metrics = rows.map((row, index) => rowMetrics(row, fn.slug, index))
    return {
      slug: fn.slug,
      version: fn.version,
      rowCount: rows.length,
      statusInvocationCount: metrics.reduce((sum, value) => sum + value.statusInvocationCount, 0),
      requestsCount: metrics.reduce((sum, value) => sum + value.requestsCount, 0),
      maxCpuMilliseconds: metrics.reduce((maximum, value) => Math.max(maximum, value.maxCpuMilliseconds), 0),
      maxAverageMemoryMegabytes: metrics.reduce(
        (maximum, value) => Math.max(maximum, value.averageMemoryMegabytes),
        0,
      ),
      maxExecutionMilliseconds: metrics.reduce(
        (maximum, value) => Math.max(maximum, value.maxExecutionMilliseconds),
        0,
      ),
      metrics,
    }
  })

  const allMetrics = functionStats.flatMap((value) => value.metrics)
  if (allMetrics.length < 1) throw new Error('function combined statistics returned no metric rows')

  const invocationCount24h = functionStats.reduce(
    (sum, value) => sum + value.statusInvocationCount,
    0,
  )
  const requestsCount24h = functionStats.reduce((sum, value) => sum + value.requestsCount, 0)
  if (!Number.isSafeInteger(invocationCount24h) || invocationCount24h < 1) {
    throw new Error('function combined statistics returned no classified invocations')
  }
  if (!Number.isSafeInteger(requestsCount24h) || requestsCount24h < invocationCount24h) {
    throw new Error('function combined statistics returned an invalid total request count')
  }

  const maxCpu = statistics(allMetrics.map((value) => value.maxCpuMilliseconds))
  const averageCpu = statistics(allMetrics.map((value) => value.averageCpuMilliseconds))
  const averageMemory = statistics(allMetrics.map((value) => value.averageMemoryMegabytes))
  const averageHeapMemory = statistics(allMetrics.map((value) => value.averageHeapMemoryMegabytes))
  const averageExternalMemory = statistics(
    allMetrics.map((value) => value.averageExternalMemoryMegabytes),
  )
  const maxExecution = statistics(allMetrics.map((value) => value.maxExecutionMilliseconds))

  const evidence = {
    schemaVersion: 2,
    purpose: 'r4c2d-function-combined-stats-snapshot',
    sourceRunId,
    sourceCommit,
    observedAt,
    interval,
    functionCount: functions.length,
    metricRowCount: allMetrics.length,
    invocationCount24h,
    requestsCount24h,
    maxCpuMilliseconds: maxCpu,
    averageCpuMilliseconds: averageCpu,
    averageMemoryMegabytes: averageMemory,
    averageHeapMemoryMegabytes: averageHeapMemory,
    averageExternalMemoryMegabytes: averageExternalMemory,
    maxExecutionMilliseconds: maxExecution,
    functions: functionStats.map((value) => ({
      slug: value.slug,
      version: value.version,
      rowCount: value.rowCount,
      statusInvocationCount: value.statusInvocationCount,
      requestsCount: value.requestsCount,
      maxCpuMilliseconds: value.maxCpuMilliseconds,
      maxAverageMemoryMegabytes: value.maxAverageMemoryMegabytes,
      maxExecutionMilliseconds: value.maxExecutionMilliseconds,
    })),
    thresholds: {
      cpuHaltMilliseconds,
      cpuHardMilliseconds,
      memoryAverageHaltMegabytes: memoryHaltMegabytes,
      memoryHardMegabytes,
    },
    checks: {
      officialCombinedStatsEndpoint: true,
      exactActiveFunctionCoverage: functionStats.length === functions.length,
      nonemptyInvocationEvidence: invocationCount24h > 0,
      requestCountCoversClassifiedInvocations: requestsCount24h >= invocationCount24h,
      cpuBelowHaltThreshold: maxCpu.maximum < cpuHaltMilliseconds,
      averageMemoryBelowHaltThreshold: averageMemory.maximum < memoryHaltMegabytes,
      exactMemoryMaximumCovered: false,
      rawAnalyticsRowsRetained: false,
      functionIdsRetained: false,
      profileSelected: false,
      g8Qualified: false,
    },
  }

  if (
    evidence.checks.exactActiveFunctionCoverage !== true
    || evidence.checks.cpuBelowHaltThreshold !== true
    || evidence.checks.averageMemoryBelowHaltThreshold !== true
  ) {
    throw new Error(`function combined statistics crossed a resource halt boundary: ${JSON.stringify(evidence.checks)}`)
  }

  await writeFile(
    `${evidenceDirectory}/runtime-resource-log-snapshot.json`,
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
    purpose: 'r4c2d-function-combined-stats-snapshot',
    sourceRunId,
    sourceCommit,
    failedAt: new Date().toISOString(),
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-runtime-resource-log-snapshot.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}