import { createHash } from 'node:crypto'
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
if (!Number.isSafeInteger(sourceRunId)) throw new Error('GITHUB_RUN_ID exceeds safe integer range')

const outputDirectory = 'r4f-revision4-resource-snapshot-refresh'
const managementBase = `https://api.supabase.com/v1/projects/${projectRef}`
const interval = '1day'
const invocationHalt31d = 400_000
const bundleHaltBytes = 4_000_000

type JsonObject = Record<string, unknown>
type FunctionIdentity = {
  slug: string
  status: 'ACTIVE'
  version: number
  ezbrSha256: string | null
}
type BundleIdentity = {
  file: string
  slug: string
  source: string
  bytes: number
  sha256: string
  headSha: string
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value as JsonObject).sort().map((key) => [key, canonical((value as JsonObject)[key])]),
    )
  }
  return value
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function object(value: unknown, name: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value as JsonObject
}

function nonNegativeNumber(value: unknown, name: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative finite number`)
  }
  return parsed
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = nonNegativeNumber(value, name)
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive safe integer`)
  return parsed
}

async function managementRequest(path: string, searchParams?: Record<string, string>): Promise<unknown> {
  const url = new URL(`${managementBase}${path}`)
  for (const [key, value] of Object.entries(searchParams ?? {})) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`Supabase Management API ${path} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) && typeof (parsed as JsonObject).error === 'string') {
    throw new Error(`Supabase Management API ${path} returned error: ${String((parsed as JsonObject).error)}`)
  }
  return parsed
}

function extractActiveFunctions(raw: unknown): FunctionIdentity[] {
  const candidate = raw as { functions?: unknown[]; data?: unknown[] }
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(candidate?.functions)
      ? candidate.functions
      : Array.isArray(candidate?.data)
        ? candidate.data
        : null
  if (!values) throw new Error('Management API function list has an unsupported shape')

  const functions = values
    .map((entry, index) => object(entry, `function[${index}]`))
    .filter((entry) => String(entry.status ?? '').toUpperCase() === 'ACTIVE')
    .map((entry) => {
      const slug = String(entry.slug ?? entry.name ?? '').trim()
      const version = positiveInteger(entry.version, `function ${slug} version`)
      const rawDigest = typeof entry.ezbr_sha256 === 'string' ? entry.ezbr_sha256.toLowerCase() : null
      const ezbrSha256 = rawDigest && /^[a-f0-9]{64}$/u.test(rawDigest) ? rawDigest : null
      return { slug, status: 'ACTIVE' as const, version, ezbrSha256 }
    })
    .sort((left, right) => left.slug.localeCompare(right.slug))

  if (functions.length < 1 || functions.some((entry) => !/^[a-z0-9][a-z0-9-]*$/u.test(entry.slug))) {
    throw new Error('Management API returned no valid active functions')
  }
  if (new Set(functions.map((entry) => entry.slug)).size !== functions.length) {
    throw new Error('Management API returned duplicate active function slugs')
  }
  return functions
}

function extractRows(raw: unknown, slug: string): JsonObject[] {
  const candidate = raw as { result?: unknown[]; data?: unknown[] }
  const values = Array.isArray(candidate?.result)
    ? candidate.result
    : Array.isArray(candidate?.data)
      ? candidate.data
      : Array.isArray(raw)
        ? raw
        : null
  if (!values) throw new Error(`combined statistics for ${slug} have an unsupported shape`)
  return values.map((entry, index) => object(entry, `${slug} combined statistics row ${index}`))
}

function rowInvocationCount(row: JsonObject, slug: string, index: number): number {
  const success = nonNegativeNumber(row.success_count ?? 0, `${slug}[${index}].success_count`)
  const redirect = nonNegativeNumber(row.redirect_count ?? 0, `${slug}[${index}].redirect_count`)
  const clientError = nonNegativeNumber(row.client_err_count ?? 0, `${slug}[${index}].client_err_count`)
  const serverError = nonNegativeNumber(row.server_err_count ?? 0, `${slug}[${index}].server_err_count`)
  const count = success + redirect + clientError + serverError
  if (!Number.isSafeInteger(count)) throw new Error(`${slug}[${index}] invocation count exceeds safe integer range`)
  return count
}

async function bundleFunction(fn: FunctionIdentity): Promise<BundleIdentity> {
  const source = `supabase/functions/${fn.slug}/index.ts`
  const result = await Bun.build({
    entrypoints: [source],
    target: 'browser',
    format: 'esm',
    minify: false,
    sourcemap: 'none',
    write: false,
  })
  if (!result.success || result.outputs.length !== 1) {
    throw new Error(`failed to bundle active function ${fn.slug}: ${result.logs.map((entry) => String(entry)).join('; ')}`)
  }
  const text = await result.outputs[0].text()
  const unresolvedRelativeImport = /(?:from\s*|import\s*\()\s*['"]\.{1,2}\//u
  if (unresolvedRelativeImport.test(text)) throw new Error(`bundle retains relative import: ${fn.slug}`)
  if (text.includes('cloudflare:')) throw new Error(`bundle contains Cloudflare runtime import: ${fn.slug}`)
  if (!text.includes('Deno.serve')) throw new Error(`bundle lacks Deno.serve entrypoint: ${fn.slug}`)
  return {
    file: `${fn.slug}-bundle.json`,
    slug: fn.slug,
    source,
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
    headSha: sourceCommit,
  }
}

async function mapWithConcurrency<T, R>(values: T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= values.length) return
      results[index] = await mapper(values[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

async function run(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  const observedAt = new Date().toISOString()
  const functions = extractActiveFunctions(await managementRequest('/functions'))

  const stats = await mapWithConcurrency(functions, 4, async (fn) => {
    const raw = await managementRequest('/analytics/endpoints/functions.combined-stats', {
      interval,
      function_id: String((await managementRequest('/functions') as unknown[]).find((entry) => {
        const item = object(entry, 'function lookup')
        return String(item.slug ?? item.name ?? '').trim() === fn.slug
      }) ? '' : ''),
    })
    return { fn, raw }
  })

  // Re-read the function list once with IDs retained only in memory so no provider identifiers are published.
  const rawFunctions = await managementRequest('/functions')
  const rawArray = Array.isArray(rawFunctions)
    ? rawFunctions
    : Array.isArray((rawFunctions as { functions?: unknown[] })?.functions)
      ? (rawFunctions as { functions: unknown[] }).functions
      : Array.isArray((rawFunctions as { data?: unknown[] })?.data)
        ? (rawFunctions as { data: unknown[] }).data
        : null
  if (!rawArray) throw new Error('Management API function list has unsupported shape on ID pass')
  const ids = new Map<string, string>()
  for (const entry of rawArray) {
    const item = object(entry, 'function ID pass')
    if (String(item.status ?? '').toUpperCase() !== 'ACTIVE') continue
    const slug = String(item.slug ?? item.name ?? '').trim()
    const id = String(item.id ?? '').trim()
    if (!/^[0-9a-f-]{16,64}$/iu.test(id)) throw new Error(`active function ${slug} has invalid provider ID`)
    ids.set(slug, id)
  }
  if (ids.size !== functions.length) throw new Error('active function ID coverage mismatch')

  const invocationCounts = await mapWithConcurrency(functions, 4, async (fn) => {
    const raw = await managementRequest('/analytics/endpoints/functions.combined-stats', {
      interval,
      function_id: ids.get(fn.slug)!,
    })
    const rows = extractRows(raw, fn.slug)
    return rows.reduce((sum, row, index) => sum + rowInvocationCount(row, fn.slug, index), 0)
  })
  const invocationCount24h = invocationCounts.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(invocationCount24h) || invocationCount24h < 1) {
    throw new Error('combined statistics returned no valid invocations')
  }
  const projectedInvocations31d = invocationCount24h * 31
  if (!Number.isSafeInteger(projectedInvocations31d) || projectedInvocations31d >= invocationHalt31d) {
    throw new Error(`projected invocations are not safely below halt: ${projectedInvocations31d}`)
  }

  const bundles = await mapWithConcurrency(functions, 2, async (fn) => await bundleFunction(fn))
  bundles.sort((left, right) => left.slug.localeCompare(right.slug))
  const largest = bundles.reduce((current, next) => next.bytes > current.bytes ? next : current)
  if (largest.bytes >= bundleHaltBytes) {
    throw new Error(`largest active function bundle crosses halt: ${largest.slug}:${largest.bytes}`)
  }

  const snapshotCore = {
    schemaVersion: 2,
    snapshotId: `r4f-rev4-resource-${runIdText}`,
    sourceRunId,
    sourceCommit,
    observedAt,
    usageInterval: interval,
    invocationSource: 'functions.combined-stats',
    managementApiAvailable: true,
    invocationCount24h,
    projectedInvocations31d,
    functionCount: functions.length,
    maxBundleBytes: largest.bytes,
    maxBundleName: largest.slug,
    bundleCount: bundles.length,
    functions,
    bundles,
  }
  const proposal = {
    schemaVersion: 1,
    purpose: 'r4f-revision4-resource-snapshot-refresh-proposal',
    ...snapshotCore,
    functionIdentityDigest: digest(functions),
    bundleIdentityDigest: digest(bundles),
    evidenceDigest: digest(snapshotCore),
    thresholds: { invocationHalt31d, bundleHaltBytes },
    checks: {
      exactActiveFunctionCoverage: true,
      officialCombinedStatsEndpoint: true,
      currentInvocationProjectionBelowHalt: true,
      exactSameCommitBundleCoverage: true,
      currentBundleMaximumBelowHalt: true,
      providerFunctionIdsRetained: false,
      productionMutation: false,
    },
  }
  await writeFile(`${outputDirectory}/proposal.json`, `${JSON.stringify(proposal, null, 2)}\n`)
  console.log(JSON.stringify(proposal))
}

await run()
