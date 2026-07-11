import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const productionBase = (process.env.PRODUCTION_BASE ?? 'https://xrpl-lending-monitor.badjoke-lab.workers.dev').replace(/\/$/, '')
const outputDir = process.env.OUTPUT_DIR ?? 'production-read-audit/live-source'
const rpcEndpoints = [
  process.env.XRPL_PRIMARY_RPC ?? 'https://devnet.honeycluster.io/',
  process.env.XRPL_FALLBACK_RPC ?? 'https://s.devnet.rippletest.net:51234/',
]
const CURRENT_MAX_AGE_SECONDS = 10 * 60
const CURRENT_MAX_LAG_LEDGERS = 200
const HISTORY_MAX_AGE_SECONDS = 5 * 60 * 60
const RIPPLE_EPOCH_MS = Date.UTC(2000, 0, 1)

await mkdir(outputDir, { recursive: true })

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value, field) {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function array(value) {
  return Array.isArray(value) ? value : []
}

function numberValue(value) {
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  return Number.isFinite(parsed) ? Number(parsed) : null
}

function stringValue(value) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isoAgeSeconds(value, nowMs = Date.now()) {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? Math.max(0, Math.round((nowMs - parsed) / 1000)) : null
}

function rippleTimeToIso(seconds) {
  const value = numberValue(seconds)
  return value === null ? null : new Date(RIPPLE_EPOCH_MS + value * 1000).toISOString()
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  )
}

function jsonEqual(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function sanitiseName(value) {
  return value.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

async function saveText(name, text) {
  await writeFile(path.join(outputDir, name), text, 'utf8')
}

async function saveJson(name, value) {
  await saveText(name, `${JSON.stringify(value, null, 2)}\n`)
}

async function fetchText(url, options = {}) {
  const startedAt = Date.now()
  let response
  try {
    response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(45_000),
    })
  } catch (error) {
    return {
      ok: false,
      status: null,
      durationMs: Date.now() - startedAt,
      text: '',
      error: error instanceof Error ? error.message : String(error),
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    durationMs: Date.now() - startedAt,
    text: await response.text(),
    error: null,
  }
}

async function fetchPublic(pathname, name, options = {}) {
  const result = await fetchText(`${productionBase}${pathname}`, {
    headers: { accept: 'application/json', ...(options.headers ?? {}) },
    ...options,
  })
  let body = null
  if (result.text.length > 0) {
    try {
      body = JSON.parse(result.text)
    } catch {
      body = result.text
    }
  }
  await saveJson(`public-${sanitiseName(name)}.json`, {
    url: `${productionBase}${pathname}`,
    ...result,
    body,
  })
  return { ...result, body }
}

async function rpc(endpoint, method, params, name) {
  const payload = { method, params: [params] }
  const result = await fetchText(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  let body = null
  if (result.text.length > 0) {
    try {
      body = JSON.parse(result.text)
    } catch {
      body = result.text
    }
  }
  await saveJson(`rpc-${sanitiseName(name)}.json`, {
    endpoint,
    request: payload,
    ...result,
    body,
  })
  return { ...result, body, endpoint }
}

function rpcResult(call, field) {
  if (!call.ok || !isRecord(call.body)) throw new Error(`${field} RPC request failed`)
  const result = record(call.body.result, `${field}.result`)
  if (result.status === 'error' || typeof result.error === 'string') {
    throw new Error(`${field} RPC returned ${result.error ?? 'error'}`)
  }
  return result
}

function headFromRpc(call, field) {
  const result = rpcResult(call, field)
  const ledger = isRecord(result.ledger) ? result.ledger : {}
  const ledgerIndex = numberValue(result.ledger_index ?? ledger.ledger_index ?? ledger.seqNum)
  const ledgerHash = stringValue(result.ledger_hash ?? ledger.ledger_hash ?? ledger.hash)
  if (ledgerIndex === null || ledgerHash === null) throw new Error(`${field} head identity is incomplete`)
  const closeTime = numberValue(result.ledger_time ?? ledger.close_time)
  return {
    endpoint: call.endpoint,
    ledgerIndex,
    ledgerHash: ledgerHash.toUpperCase(),
    closeTime,
    closeTimeIso: rippleTimeToIso(closeTime),
  }
}

async function readLedger(endpoint, ledgerIndex, name) {
  const call = await rpc(endpoint, 'ledger', {
    ledger_index: ledgerIndex,
    transactions: false,
    expand: false,
  }, name)
  const result = rpcResult(call, name)
  const ledger = isRecord(result.ledger) ? result.ledger : {}
  const index = numberValue(result.ledger_index ?? ledger.ledger_index ?? ledger.seqNum)
  const hash = stringValue(result.ledger_hash ?? ledger.ledger_hash ?? ledger.hash)
  const closeTime = numberValue(result.ledger_time ?? ledger.close_time)
  return {
    index,
    hash: hash?.toUpperCase() ?? null,
    closeTime,
    closeTimeIso: rippleTimeToIso(closeTime),
  }
}

async function ledgerEntry(endpoint, objectId, name) {
  const call = await rpc(endpoint, 'ledger_entry', {
    ledger_index: 'validated',
    index: objectId,
    binary: false,
  }, name)
  if (!call.ok || !isRecord(call.body)) {
    return { found: false, error: call.error ?? `HTTP ${call.status}`, node: null }
  }
  const result = isRecord(call.body.result) ? call.body.result : {}
  if (result.status === 'error' || typeof result.error === 'string') {
    return { found: false, error: String(result.error ?? 'unknown_error'), node: null }
  }
  return {
    found: isRecord(result.node),
    error: null,
    node: isRecord(result.node) ? result.node : null,
    ledgerIndex: numberValue(result.ledger_index),
    ledgerHash: stringValue(result.ledger_hash)?.toUpperCase() ?? null,
  }
}

function compareRaw(siteRaw, sourceNode) {
  if (!isRecord(siteRaw) || !isRecord(sourceNode)) {
    return { comparable: false, commonFields: 0, mismatches: ['raw object unavailable'] }
  }
  const ignored = new Set(['index'])
  const common = Object.keys(siteRaw).filter((key) => !ignored.has(key) && Object.hasOwn(sourceNode, key))
  const mismatches = common
    .filter((key) => !jsonEqual(siteRaw[key], sourceNode[key]))
    .slice(0, 20)
  return {
    comparable: common.length > 0,
    commonFields: common.length,
    mismatches,
  }
}

function newestLedgerFromData(body, candidates) {
  if (!isRecord(body)) return null
  const rows = array(body.data)
  for (const row of rows) {
    if (!isRecord(row)) continue
    for (const key of candidates) {
      const value = numberValue(row[key])
      if (value !== null) return value
    }
  }
  return null
}

function newestTimeFromData(body, candidates) {
  if (!isRecord(body)) return null
  const rows = array(body.data)
  for (const row of rows) {
    if (!isRecord(row)) continue
    for (const key of candidates) {
      const value = row[key]
      if (typeof value === 'string' && value.length > 0) return value
      const numeric = numberValue(value)
      if (numeric !== null) return rippleTimeToIso(numeric)
    }
  }
  return null
}

const sourceHeadCalls = await Promise.all(
  rpcEndpoints.map((endpoint, index) => rpc(endpoint, 'ledger', {
    ledger_index: 'validated',
    transactions: false,
    expand: false,
  }, `validated-head-${index + 1}`)),
)

const sourceHeads = []
for (let index = 0; index < sourceHeadCalls.length; index += 1) {
  try {
    sourceHeads.push(headFromRpc(sourceHeadCalls[index], `validated-head-${index + 1}`))
  } catch (error) {
    sourceHeads.push({
      endpoint: rpcEndpoints[index],
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

const successfulHeads = sourceHeads.filter((head) => numberValue(head.ledgerIndex) !== null)
if (successfulHeads.length === 0) {
  await saveJson('summary.json', {
    generatedAt: new Date().toISOString(),
    productionBase,
    sourceHeads,
    fatal: 'No XRPL Devnet source endpoint returned a validated head',
  })
  process.exit(2)
}

const sourceHead = successfulHeads.reduce((latest, candidate) =>
  candidate.ledgerIndex > latest.ledgerIndex ? candidate : latest,
)
const authoritativeEndpoint = sourceHead.endpoint

const publicRequests = {
  overview: ['/api/overview', 'overview'],
  status: ['/api/status', 'status'],
  collector: ['/api/status/collector', 'collector'],
  historySource: ['/api/status/history-source', 'history-source'],
  fastLaneDiff: ['/api/status/fast-lane-diff?limit=500', 'fast-lane-diff'],
  activity: ['/api/activity?limit=100', 'activity'],
  lifecycle: ['/api/audit/lifecycle?limit=100', 'lifecycle'],
  archived: ['/api/audit/archived?limit=100', 'archived'],
  coverLoss: ['/api/audit/cover-loss?limit=100', 'cover-loss'],
  epochs: ['/api/epochs', 'epochs'],
  activityExport: ['/api/exports/activity?limit=100&format=json', 'activity-export-json'],
}

const publicEntries = await Promise.all(
  Object.entries(publicRequests).map(async ([key, [pathname, name]]) => [
    key,
    await fetchPublic(pathname, name),
  ]),
)
const publicApi = Object.fromEntries(publicEntries)

const overview = record(publicApi.overview.body, 'overview')
const currentWatermark = record(overview.current_state_watermark, 'overview.current_state_watermark')
const countsWatermark = record(overview.counts_watermark, 'overview.counts_watermark')
const collector = record(publicApi.collector.body, 'collector')
const collectorCursor = record(collector.cursor, 'collector.cursor')

const currentLedger = numberValue(currentWatermark.ledger_index)
const currentHash = stringValue(currentWatermark.ledger_hash)?.toUpperCase() ?? null
const currentUpdatedAt = stringValue(currentWatermark.updated_at)
const countsLedger = numberValue(countsWatermark.ledger_index)
const countsHash = stringValue(countsWatermark.ledger_hash)?.toUpperCase() ?? null
const countsUpdatedAt = stringValue(countsWatermark.updated_at)
const canonicalLedger = numberValue(collectorCursor.last_processed_ledger)
const canonicalHash = stringValue(collectorCursor.last_processed_hash)?.toUpperCase() ?? null

if (currentLedger === null || currentHash === null || countsLedger === null || countsHash === null || canonicalLedger === null || canonicalHash === null) {
  throw new Error('Public watermark or canonical cursor identity is incomplete')
}

const [currentSourceLedger, countsSourceLedger, canonicalSourceLedger] = await Promise.all([
  readLedger(authoritativeEndpoint, currentLedger, 'current-watermark-ledger'),
  readLedger(authoritativeEndpoint, countsLedger, 'counts-watermark-ledger'),
  readLedger(authoritativeEndpoint, canonicalLedger, 'canonical-cursor-ledger'),
])

const currentAgeSeconds = isoAgeSeconds(currentUpdatedAt)
const countsUpdateAgeSeconds = isoAgeSeconds(countsUpdatedAt)
const sourceLagLedgers = Math.max(0, sourceHead.ledgerIndex - currentLedger)
const countsLagLedgers = Math.max(0, sourceHead.ledgerIndex - countsLedger)
const canonicalLagLedgers = Math.max(0, sourceHead.ledgerIndex - canonicalLedger)
const sourceCloseMs = sourceHead.closeTimeIso ? Date.parse(sourceHead.closeTimeIso) : Date.now()
const countsCoverageAgeSeconds = countsSourceLedger.closeTimeIso
  ? Math.max(0, Math.round((sourceCloseMs - Date.parse(countsSourceLedger.closeTimeIso)) / 1000))
  : null
const canonicalCoverageAgeSeconds = canonicalSourceLedger.closeTimeIso
  ? Math.max(0, Math.round((sourceCloseMs - Date.parse(canonicalSourceLedger.closeTimeIso)) / 1000))
  : null

const currentHashMatches = currentSourceLedger.hash === currentHash
const countsHashMatches = countsSourceLedger.hash === countsHash
const canonicalHashMatches = canonicalSourceLedger.hash === canonicalHash
const sourceHeadSpread = Math.max(...successfulHeads.map((head) => head.ledgerIndex))
  - Math.min(...successfulHeads.map((head) => head.ledgerIndex))
const sourceAgreement = sourceHeadSpread <= 5

const collectionDefinitions = [
  { key: 'vaults', path: '/api/vaults', detailPath: (id) => `/api/vaults/${id}` },
  { key: 'loan_brokers', path: '/api/loan-brokers', detailPath: (id) => `/api/loan-brokers/${id}` },
  { key: 'loans', path: '/api/loans', detailPath: (id) => `/api/loans/${id}` },
]

const collectionAudits = {}
for (const definition of collectionDefinitions) {
  const collection = await fetchPublic(`${definition.path}?limit=3&sort=id_asc`, `${definition.key}-sample`)
  const rows = isRecord(collection.body) ? array(collection.body.data) : []
  const samples = []
  for (const row of rows.slice(0, 3)) {
    if (!isRecord(row) || typeof row.id !== 'string') continue
    const id = row.id.toUpperCase()
    const detail = await fetchPublic(definition.detailPath(id), `${definition.key}-detail-${id.slice(0, 12)}`)
    const detailData = isRecord(detail.body) && isRecord(detail.body.data) ? detail.body.data : null
    const source = await ledgerEntry(authoritativeEndpoint, id, `${definition.key}-ledger-entry-${id.slice(0, 12)}`)
    const comparison = compareRaw(detailData?.raw, source.node)
    samples.push({
      id,
      publicHttpStatus: detail.status,
      sourceFound: source.found,
      sourceError: source.error,
      rawComparison: comparison,
      passed: detail.status === 200
        && source.found
        && comparison.comparable
        && comparison.mismatches.length === 0,
    })
  }
  collectionAudits[definition.key] = {
    collectionHttpStatus: collection.status,
    sampleCount: samples.length,
    samples,
    passed: collection.status === 200
      && samples.length > 0
      && samples.every((sample) => sample.passed),
  }
}

const latestActivity = isRecord(publicApi.activity.body) ? array(publicApi.activity.body.data)[0] : null
let latestActivitySource = null
if (isRecord(latestActivity) && typeof latestActivity.transaction_hash === 'string') {
  const call = await rpc(authoritativeEndpoint, 'tx', {
    transaction: latestActivity.transaction_hash,
    binary: false,
  }, 'latest-activity-transaction')
  if (call.ok && isRecord(call.body) && isRecord(call.body.result)) {
    const result = call.body.result
    latestActivitySource = {
      found: result.status !== 'error' && typeof result.error !== 'string',
      error: result.error ?? null,
      ledgerIndex: numberValue(result.ledger_index),
      validated: result.validated ?? null,
    }
  } else {
    latestActivitySource = {
      found: false,
      error: call.error ?? `HTTP ${call.status}`,
      ledgerIndex: null,
      validated: null,
    }
  }
}

const historyCoverage = {
  canonicalCursor: {
    ledgerIndex: canonicalLedger,
    ledgerHash: canonicalHash,
    hashMatchesSource: canonicalHashMatches,
    sourceLagLedgers: canonicalLagLedgers,
    coverageAgeSeconds: canonicalCoverageAgeSeconds,
    coverageAgeHours: canonicalCoverageAgeSeconds === null ? null : canonicalCoverageAgeSeconds / 3600,
    collectorStatus: collector.status,
    lastSuccessAt: collector.last_success_at ?? null,
    error: collector.error ?? null,
  },
  activity: {
    httpStatus: publicApi.activity.status,
    latestLedger: newestLedgerFromData(publicApi.activity.body, ['ledger_index']),
    latestTime: newestTimeFromData(publicApi.activity.body, ['close_time', 'created_at']),
    sourceVerification: latestActivitySource,
  },
  lifecycle: {
    httpStatus: publicApi.lifecycle.status,
    latestLedger: newestLedgerFromData(publicApi.lifecycle.body, ['ledger_index']),
    latestTime: newestTimeFromData(publicApi.lifecycle.body, ['close_time', 'created_at']),
  },
  archived: {
    httpStatus: publicApi.archived.status,
    latestLedger: newestLedgerFromData(publicApi.archived.body, ['deletion_ledger_index']),
    latestTime: newestTimeFromData(publicApi.archived.body, ['deletion_close_time', 'archived_at']),
  },
  coverLoss: {
    httpStatus: publicApi.coverLoss.status,
    latestLedger: newestLedgerFromData(publicApi.coverLoss.body, ['ledger_index']),
    latestTime: newestTimeFromData(publicApi.coverLoss.body, ['close_time', 'created_at']),
  },
}

const currentStateFresh = sourceAgreement
  && currentHashMatches
  && currentAgeSeconds !== null
  && currentAgeSeconds <= CURRENT_MAX_AGE_SECONDS
  && sourceLagLedgers <= CURRENT_MAX_LAG_LEDGERS
  && Object.values(collectionAudits).every((audit) => audit.passed)

const countsFresh = countsHashMatches
  && countsCoverageAgeSeconds !== null
  && countsCoverageAgeSeconds <= HISTORY_MAX_AGE_SECONDS

const historyFresh = canonicalHashMatches
  && canonicalCoverageAgeSeconds !== null
  && canonicalCoverageAgeSeconds <= HISTORY_MAX_AGE_SECONDS
  && publicApi.activity.status === 200
  && publicApi.lifecycle.status === 200
  && publicApi.archived.status === 200
  && publicApi.coverLoss.status === 200

const apiMatrix = [
  {
    apiClass: 'current_state_watermark',
    endpoints: ['/api/overview', '/api/vaults', '/api/loan-brokers', '/api/loans', 'current-object details'],
    expectedCadence: '5 minutes',
    sourceLedger: sourceHead.ledgerIndex,
    coverageLedger: currentLedger,
    lagLedgers: sourceLagLedgers,
    ageSeconds: currentAgeSeconds,
    hashMatchesSource: currentHashMatches,
    verdict: currentStateFresh ? 'fresh' : 'not_confirmed_fresh',
  },
  {
    apiClass: 'overview_counts',
    endpoints: ['/api/overview counts'],
    expectedCadence: '4-hour canonical/count refresh',
    sourceLedger: sourceHead.ledgerIndex,
    coverageLedger: countsLedger,
    lagLedgers: countsLagLedgers,
    coverageAgeSeconds: countsCoverageAgeSeconds,
    updateAgeSeconds: countsUpdateAgeSeconds,
    hashMatchesSource: countsHashMatches,
    verdict: countsFresh ? 'fresh_for_declared_cadence' : 'stale_for_declared_cadence',
  },
  {
    apiClass: 'indexed_history',
    endpoints: [
      '/api/activity',
      '/api/transactions/:hash',
      '/api/objects/:type/:id/history',
      '/api/loans/:id/lifecycle',
      '/api/audit/lifecycle',
      '/api/audit/archived',
      '/api/audit/cover-loss',
      '/api/search history results',
      '/api/exports/activity',
      '/api/feeds/activity.ndjson',
    ],
    expectedCadence: '4-hour canonical history refresh',
    sourceLedger: sourceHead.ledgerIndex,
    coverageLedger: canonicalLedger,
    lagLedgers: canonicalLagLedgers,
    coverageAgeSeconds: canonicalCoverageAgeSeconds,
    hashMatchesSource: canonicalHashMatches,
    verdict: historyFresh ? 'fresh_for_declared_cadence' : 'stale_or_not_provably_latest',
  },
  {
    apiClass: 'status_and_metadata',
    endpoints: [
      '/api/health',
      '/api/status',
      '/api/status/collector',
      '/api/status/history-source',
      '/api/status/fast-lane-diff',
      '/api/epochs',
    ],
    expectedCadence: 'status reflects underlying source',
    verdict: 'structurally_available',
  },
]

const allPublicApisFresh = currentStateFresh && countsFresh && historyFresh
const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  productionBase,
  thresholds: {
    currentMaxAgeSeconds: CURRENT_MAX_AGE_SECONDS,
    currentMaxLagLedgers: CURRENT_MAX_LAG_LEDGERS,
    historyMaxAgeSeconds: HISTORY_MAX_AGE_SECONDS,
  },
  source: {
    heads: sourceHeads,
    selectedHead: sourceHead,
    headSpreadLedgers: sourceHeadSpread,
    agreement: sourceAgreement,
  },
  currentState: {
    fresh: currentStateFresh,
    watermark: currentWatermark,
    sourceLedger: currentSourceLedger,
    sourceLagLedgers,
    ageSeconds: currentAgeSeconds,
    hashMatchesSource: currentHashMatches,
    collectionAudits,
  },
  counts: {
    fresh: countsFresh,
    watermark: countsWatermark,
    sourceLedger: countsSourceLedger,
    sourceLagLedgers: countsLagLedgers,
    coverageAgeSeconds: countsCoverageAgeSeconds,
    updateAgeSeconds: countsUpdateAgeSeconds,
    hashMatchesSource: countsHashMatches,
    values: overview.counts ?? null,
  },
  history: {
    fresh: historyFresh,
    ...historyCoverage,
  },
  apiMatrix,
  allPublicApisFresh,
  conclusion: allPublicApisFresh
    ? 'All tested public API classes are fresh for their declared cadence.'
    : 'At least one public API class is stale or cannot be considered latest for its declared cadence.',
}

await saveJson('summary.json', summary)

const markdown = [
  '# Live XRPL Devnet source freshness audit',
  '',
  `Generated: ${summary.generatedAt}`,
  `Production: ${productionBase}`,
  '',
  '## Verdict',
  '',
  `- Current-state APIs: **${currentStateFresh ? 'FRESH' : 'NOT CONFIRMED FRESH'}**`,
  `- Overview counts: **${countsFresh ? 'FRESH FOR CADENCE' : 'STALE FOR CADENCE'}**`,
  `- Indexed history APIs: **${historyFresh ? 'FRESH FOR CADENCE' : 'STALE / NOT PROVABLY LATEST'}**`,
  `- All public APIs fresh: **${allPublicApisFresh ? 'YES' : 'NO'}**`,
  '',
  '## Ledger comparison',
  '',
  `- XRPL source head: ${sourceHead.ledgerIndex} (${sourceHead.ledgerHash})`,
  `- Current-state watermark: ${currentLedger}; lag ${sourceLagLedgers} ledgers; age ${currentAgeSeconds}s; hash match ${currentHashMatches}`,
  `- Counts watermark: ${countsLedger}; lag ${countsLagLedgers} ledgers; coverage age ${countsCoverageAgeSeconds}s; hash match ${countsHashMatches}`,
  `- Canonical history cursor: ${canonicalLedger}; lag ${canonicalLagLedgers} ledgers; coverage age ${canonicalCoverageAgeSeconds}s; hash match ${canonicalHashMatches}`,
  '',
  '## Object samples',
  '',
  ...Object.entries(collectionAudits).map(([key, audit]) =>
    `- ${key}: ${audit.passed ? 'PASS' : 'FAIL'} (${audit.sampleCount} samples)`),
  '',
].join('\n')

await saveText('summary.md', `${markdown}\n`)
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)

if (!allPublicApisFresh) process.exitCode = 2
