import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'

await import('./record-supabase-runtime-resource-log-snapshot.mjs')
await import('./record-supabase-provider-metric-capability.mjs')

const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const verifierToken = process.env.XRPL_READER_VERIFY_TOKEN ?? ''
const runIdText = process.env.GITHUB_RUN_ID ?? ''
const sourceCommit = (process.env.GITHUB_SHA ?? '').toLowerCase()

if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact 20-character project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')
if (!/^[a-f0-9]{64}$/u.test(verifierToken)) throw new Error('XRPL_READER_VERIFY_TOKEN must be an exact 64-character hex token')
if (!/^[1-9][0-9]*$/u.test(runIdText)) throw new Error('GITHUB_RUN_ID must be a positive integer')
if (!/^[a-f0-9]{40}$/u.test(sourceCommit)) throw new Error('GITHUB_SHA must be an exact lowercase commit SHA')

const sourceRunId = Number(runIdText)
if (!Number.isSafeInteger(sourceRunId)) throw new Error('GITHUB_RUN_ID exceeds the safe integer range')

const evidenceDirectory = 'supabase-remote-probe-evidence'
const purpose = 'r4c2d-resource-headroom-guard'
const functionEndpoint = `https://${projectRef}.supabase.co/functions/v1/xrpl-resource-headroom-guard`
const managementBase = `https://api.supabase.com/v1/projects/${projectRef}`
const runtimeEvidencePath = `${evidenceDirectory}/runtime-resource-log-snapshot.json`

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function object(value, name) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`)
  }
  return value
}

function integer(value, name) {
  const parsed = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative safe integer`)
  }
  return parsed
}

async function managementRequest(path) {
  const response = await fetch(`${managementBase}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`Supabase Management API ${path} failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  return parsed
}

async function edgeRequest(body) {
  const response = await fetch(functionEndpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-xrpl-reader-purpose': purpose,
      'x-xrpl-reader-token': verifierToken,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`resource snapshot Edge record failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  return parsed
}

function extractFunctions(raw) {
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.functions)
      ? raw.functions
      : Array.isArray(raw?.data)
        ? raw.data
        : null
  if (!values) throw new Error('Management API function list has an unsupported shape')
  const active = values
    .map((value, index) => object(value, `function[${index}]`))
    .filter((value) => String(value.status ?? '').toUpperCase() === 'ACTIVE')
    .map((value) => ({
      slug: String(value.slug ?? value.name ?? '').trim(),
      status: String(value.status ?? '').toUpperCase(),
      version: integer(value.version ?? 0, `function ${String(value.slug ?? value.name)} version`),
      ezbrSha256: typeof value.ezbr_sha256 === 'string' ? value.ezbr_sha256 : null,
    }))
    .sort((left, right) => left.slug.localeCompare(right.slug))
  if (active.length === 0 || active.some((value) => !/^[a-z0-9][a-z0-9-]*$/u.test(value.slug))) {
    throw new Error('Management API returned no valid active functions')
  }
  if (new Set(active.map((value) => value.slug)).size !== active.length) {
    throw new Error('Management API returned duplicate active function slugs')
  }
  return active
}

async function readBundleEvidence() {
  const files = (await readdir(evidenceDirectory))
    .filter((name) => name.endsWith('-bundle.json') || name === 'bundle.json')
    .sort()
  const bundles = []
  for (const file of files) {
    const value = object(JSON.parse(await readFile(`${evidenceDirectory}/${file}`, 'utf8')), file)
    const source = String(value.source ?? '')
    const match = /^supabase\/functions\/([a-z0-9-]+)\/index\.ts$/u.exec(source)
    if (!match) continue
    const bytes = integer(value.bytes, `${file}.bytes`)
    const sha256 = String(value.sha256 ?? '').toLowerCase()
    const headSha = String(value.headSha ?? '').toLowerCase()
    if (bytes < 1 || !/^[a-f0-9]{64}$/u.test(sha256) || headSha !== sourceCommit) {
      throw new Error(`${file} has invalid or foreign bundle evidence`)
    }
    bundles.push({ file, slug: match[1], source, bytes, sha256, headSha })
  }
  bundles.sort((left, right) => left.slug.localeCompare(right.slug))
  if (bundles.length === 0 || new Set(bundles.map((value) => value.slug)).size !== bundles.length) {
    throw new Error('bundle evidence is missing or contains duplicate function slugs')
  }
  return bundles
}

async function readRuntimeEvidence() {
  const value = object(JSON.parse(await readFile(runtimeEvidencePath, 'utf8')), 'runtime resource evidence')
  if (
    value.schemaVersion !== 2
    || value.purpose !== 'r4c2d-function-combined-stats-snapshot'
    || value.sourceRunId !== sourceRunId
    || value.sourceCommit !== sourceCommit
    || value.interval !== '1day'
    || value.checks?.officialCombinedStatsEndpoint !== true
    || value.checks?.exactActiveFunctionCoverage !== true
  ) {
    throw new Error('runtime resource evidence identity or coverage is invalid')
  }
  const invocationCount24h = integer(value.invocationCount24h, 'runtime invocationCount24h')
  const functions = Array.isArray(value.functions) ? value.functions : null
  if (invocationCount24h < 1 || !functions) {
    throw new Error('runtime resource evidence contains no invocation or function coverage')
  }
  const slugs = functions.map((entry, index) => {
    const item = object(entry, `runtime function[${index}]`)
    const slug = String(item.slug ?? '')
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(slug)) {
      throw new Error(`runtime function[${index}] has an invalid slug`)
    }
    return slug
  }).sort()
  if (new Set(slugs).size !== slugs.length) {
    throw new Error('runtime resource evidence contains duplicate function slugs')
  }
  return { value, invocationCount24h, slugs }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAt = new Date().toISOString()
  const [rawFunctions, bundles, runtime] = await Promise.all([
    managementRequest('/functions'),
    readBundleEvidence(),
    readRuntimeEvidence(),
  ])

  const functions = extractFunctions(rawFunctions)
  const functionSlugs = functions.map((value) => value.slug)
  const bundleSlugs = bundles.map((value) => value.slug)
  if (
    JSON.stringify(functionSlugs) !== JSON.stringify(bundleSlugs)
    || JSON.stringify(functionSlugs) !== JSON.stringify(runtime.slugs)
  ) {
    throw new Error(
      `deployed function/bundle/combined-stats identity mismatch: deployed=${JSON.stringify(functionSlugs)} bundles=${JSON.stringify(bundleSlugs)} stats=${JSON.stringify(runtime.slugs)}`,
    )
  }

  const invocationCount24h = runtime.invocationCount24h
  const projectedInvocations31d = invocationCount24h * 31
  if (!Number.isSafeInteger(projectedInvocations31d)) {
    throw new Error('projected invocation count exceeds the safe integer range')
  }
  const largestBundle = bundles.reduce((largest, current) => (
    current.bytes > largest.bytes ? current : largest
  ))

  const snapshotCore = {
    schemaVersion: 2,
    snapshotId: `r4c2d-resource-${runIdText}`,
    sourceRunId,
    sourceCommit,
    observedAt,
    usageInterval: '1day',
    invocationSource: 'functions.combined-stats',
    managementApiAvailable: true,
    invocationCount24h,
    projectedInvocations31d,
    functionCount: functions.length,
    maxBundleBytes: largestBundle.bytes,
    maxBundleName: largestBundle.slug,
    bundleCount: bundles.length,
    functions,
    bundles,
  }
  const evidenceDigest = digest(snapshotCore)

  const record = await edgeRequest({
    action: 'record',
    snapshot: {
      snapshotId: snapshotCore.snapshotId,
      sourceRunId,
      sourceCommit,
      observedAt,
      invocationCount24h,
      projectedInvocations31d,
      functionCount: functions.length,
      maxBundleBytes: largestBundle.bytes,
      maxBundleName: largestBundle.slug,
      bundleCount: bundles.length,
      evidenceDigest,
    },
  })
  const result = object(record.result, 'recorded resource snapshot')
  const measurements = object(result.measurements, 'recorded resource measurements')
  const coverage = object(result.coverage, 'recorded resource coverage')

  if (
    measurements.externalSnapshotFresh !== true
    || integer(measurements.invocationCount24h, 'recorded invocationCount24h') !== invocationCount24h
    || integer(measurements.projectedInvocations31d, 'recorded projectedInvocations31d') !== projectedInvocations31d
    || integer(measurements.functionCount, 'recorded functionCount') !== functions.length
    || integer(measurements.maxBundleBytes, 'recorded maxBundleBytes') !== largestBundle.bytes
    || measurements.maxBundleName !== largestBundle.slug
    || coverage.functionInvocations !== true
    || coverage.bundleSize !== true
  ) {
    throw new Error('recorded resource snapshot does not match external evidence')
  }

  const evidence = {
    ...snapshotCore,
    evidenceDigest,
    recorded: result,
    checks: {
      managementApiAvailable: true,
      officialCombinedStatsInvocationSource: true,
      logsBackendNotRequired: true,
      exactSourceCommitBundleCoverage: true,
      exactDeployedFunctionCoverage: true,
      exactCombinedStatsFunctionCoverage: true,
      exactBundleEvidenceCoverage: true,
      invocationAggregateRecorded: true,
      nonzeroInvocationEvidence: true,
      externalSnapshotFresh: true,
      functionInvocationCoverage: true,
      bundleSizeCoverage: true,
      profileSelected: false,
      g8Qualified: false,
    },
  }
  await writeFile(
    `${evidenceDirectory}/resource-external-snapshot.json`,
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
    purpose: 'r4c2d-external-resource-snapshot',
    failedAt: new Date().toISOString(),
    sourceRunId,
    sourceCommit,
    reason: error instanceof Error ? error.message.slice(0, 4_000) : String(error).slice(0, 4_000),
  }
  await writeFile(
    `${evidenceDirectory}/failed-resource-external-snapshot.json`,
    `${JSON.stringify(failure, null, 2)}\n`,
  )
  throw error
}