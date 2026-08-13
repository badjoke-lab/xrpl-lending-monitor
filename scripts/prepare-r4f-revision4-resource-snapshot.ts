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
type ActiveFunction = {
  id: string
  slug: string
  status: 'ACTIVE'
  version: number
  ezbrSha256: string | null
}
type PublicFunctionIdentity = Omit<ActiveFunction, 'id'>
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
    const input = value as JsonObject
    return Object.fromEntries(Object.keys(input).sort().map((key) => [key, canonical(input[key])]))
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
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const error = (parsed as JsonObject).error
    if (typeof error === 'string' && error.length > 0) {
      throw new Error(`Supabase Management API ${path} returned error: ${error}`)
    }
  }
  return parsed
}

function rawFunctionArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'object' || raw === null) throw new Error('Management API function list has unsupported shape')
  const candidate = raw as { functions?: unknown[]; data?: unknown[] }
  if (Array.isArray(candidate.functions)) return candidate.functions
  if (Array.isArray(candidate.data)) return candidate.data
  throw new Error('Management API function list has unsupported shape')
}

function extractActiveFunctions(raw: unknown): ActiveFunction[] {
  const functions = rawFunctionArray(raw)
    .map((entry, index) => object(entry, `function[${index}]`))
    .filter((entry) => String(entry.status ?? '').toUpperCase() === 'ACTIVE')
    .map((entry) => {
      const slug = String(entry.slug ?? entry.name ?? '').trim()
      const id = String(entry.id ?? '').trim()
      if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug)) throw new Error(`invalid active function slug: ${slug}`)
      if (!/^[0-9a-f-]{16,64}$/iu.test(id)) throw new Error(`active function ${slug} has invalid provider ID`)
      const version = positiveInteger(entry.version, `function ${slug} version`)
      const rawDigest = typeof entry.ezbr_sha256 === 'string' ? entry.ezbr_sha256.toLowerCase() : null
      const ezbrSha256 = rawDigest && /^[a-f0-9]{64}$/u.test(rawDigest) ? rawDigest : null
      return { id, slug, status: 'ACTIVE' as const, version, ezbrSha256 }
    })
    .sort((left, right) => left.slug.localeCompare(right.slug))
  if (functions.length < 1) throw new Error('Management API returned no active functions')
  if (new Set(functions.map((entry) => entry.slug)).size !== functions.length) throw new Error('duplicate active function slugs')
  if (new Set(functions.map((entry) => entry.id)).size !== functions.length) throw new Error('duplicate active function IDs')
  return functions
}

function extractRows(raw: unknown, slug: string): JsonObject[] {
  if (Array.isArray(raw)) return raw.map((entry, index) => object(entry, `${slug}[${index}]`))
  if (typeof raw !== 'object' || raw === null) throw new Error(`combined statistics for ${slug} have unsupported shape`)
  const candidate = raw as { result?: unknown[]; data?: unknown[] }
  const rows = Array.isArray(candidate.result) ? candidate.result : candidate.data
  if (!Array.isArray(rows)) throw new Error(`combined statistics for ${slug} have unsupported shape`)
  return rows.map((entry, index) => object(entry, `${slug}[${index}]`))
}

function rowInvocationCount(row: JsonObject, slug: string, index: number): number {
  const count =
    nonNegativeNumber(row.success_count ?? 0, `${slug}[${index}].success_count`)
    + nonNegativeNumber(row.redirect_count ?? 0, `${slug}[${index}].redirect_count`)
    + nonNegativeNumber(row.client_err_count ?? 0, `${slug}[${index}].client_err_count`)
    + nonNegativeNumber(row.server_err_count ?? 0, `${slug}[${index}].server_err_count`)
  if (!Number.isSafeInteger(count)) throw new Error(`${slug}[${index}] invocation count exceeds safe integer range`)
  return count
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
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

async function bundleFunction(fn: ActiveFunction): Promise<BundleIdentity> {
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
    throw new Error(`failed to bundle active function ${fn.slug}`)
  }
  const text = await result.outputs[0].text()
  if (/(?:from\s*|import\s*\()\s*['"]\.{1,2}\//u.test(text)) throw new Error(`bundle retains relative import: ${fn.slug}`)
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

async function run(): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  const observedAt = new Date().toISOString()
  const active = extractActiveFunctions(await managementRequest('/functions'))
  const publicFunctions: PublicFunctionIdentity[] = active.map(({ id: _id, ...rest }) => rest)

  const invocationCounts = await mapWithConcurrency(active, 4, async (fn) => {
    const raw = await managementRequest('/analytics/endpoints/functions.combined-stats', {
      interval,
      function_id: fn.id,
    })
    const rows = extractRows(raw, fn.slug)
    return rows.reduce((sum, row, index) => sum + rowInvocationCount(row, fn.slug, index), 0)
  })
  const invocationCount24h = invocationCounts.reduce((sum, value) => sum + value, 0)
  if (!Number.isSafeInteger(invocationCount24h) || invocationCount24h < 1) throw new Error('combined statistics returned no valid invocations')
  const projectedInvocations31d = invocationCount24h * 31
  if (!Number.isSafeInteger(projectedInvocations31d) || projectedInvocations31d >= invocationHalt31d) {
    throw new Error(`projected invocations are not safely below halt: ${projectedInvocations31d}`)
  }

  const bundles = await mapWithConcurrency(active, 2, async (fn) => await bundleFunction(fn))
  bundles.sort((left, right) => left.slug.localeCompare(right.slug))
  const largest = bundles.reduce((current, next) => next.bytes > current.bytes ? next : current)
  if (largest.bytes >= bundleHaltBytes) throw new Error(`largest active function bundle crosses halt: ${largest.slug}:${largest.bytes}`)

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
    functionCount: publicFunctions.length,
    maxBundleBytes: largest.bytes,
    maxBundleName: largest.slug,
    bundleCount: bundles.length,
    functions: publicFunctions,
    bundles,
  }
  const proposal = {
    schemaVersion: 1,
    purpose: 'r4f-revision4-resource-snapshot-refresh-proposal',
    ...snapshotCore,
    functionIdentityDigest: digest(publicFunctions),
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
