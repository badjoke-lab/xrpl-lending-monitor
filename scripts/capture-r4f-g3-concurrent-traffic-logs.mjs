import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

function argument(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const targetRunText = argument('--target-run')
const start = argument('--start')
const end = argument('--end')
const output = argument('--output')
const projectRef = process.env.SUPABASE_PROJECT_ID ?? ''
const accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? ''

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u
if (!/^[1-9][0-9]*$/u.test(targetRunText ?? '')) throw new Error('target run must be a positive integer')
if (!start || !ISO.test(start) || !end || !ISO.test(end)) throw new Error('start/end must be canonical UTC seconds')
if (!output) throw new Error('output path is required')
if (!/^[a-z]{20}$/u.test(projectRef)) throw new Error('SUPABASE_PROJECT_ID must be an exact project ref')
if (accessToken.length < 20) throw new Error('SUPABASE_ACCESS_TOKEN is unavailable')

const targetRun = Number(targetRunText)
if (!Number.isSafeInteger(targetRun)) throw new Error('target run exceeds safe integer range')
const startMs = Date.parse(start)
const endMs = Date.parse(end)
if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) throw new Error('invalid log interval')
if (endMs - startMs > 60 * 60 * 1000) throw new Error('log interval must not exceed one hour')

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs`

async function query(sql) {
  const url = new URL(endpoint)
  url.searchParams.set('sql', sql)
  url.searchParams.set('iso_timestamp_start', start)
  url.searchParams.set('iso_timestamp_end', end)
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json',
    },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`Supabase logs endpoint returned non-JSON (${response.status})`)
  }
  if (!response.ok) {
    throw new Error(`Supabase logs endpoint failed (${response.status}): ${JSON.stringify(parsed).slice(0, 1000)}`)
  }
  if (typeof parsed?.error === 'string' && parsed.error.length > 0) {
    throw new Error(`Supabase logs endpoint returned error: ${parsed.error.slice(0, 1000)}`)
  }
  const rows = Array.isArray(parsed?.result) ? parsed.result : Array.isArray(parsed) ? parsed : null
  if (!rows) throw new Error('Supabase logs endpoint result shape is unsupported')
  return rows
}

function sanitizePath(value) {
  if (typeof value !== 'string') return ''
  const clean = value.split('?')[0]
  return clean.replaceAll(projectRef, '[project]')
}

function string(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

const sourceCountsSql = `
SELECT source, count() AS event_count
FROM logs
WHERE timestamp >= toDateTime('${start.replace('Z', '')}')
  AND timestamp <= toDateTime('${end.replace('Z', '')}')
GROUP BY source
ORDER BY source
LIMIT 100
`.trim()

const requestSql = `
SELECT
  timestamp,
  id,
  source,
  log_attributes['request.method'] AS method,
  log_attributes['request.path'] AS path,
  toInt32OrZero(log_attributes['response.status_code']) AS status
FROM logs
WHERE timestamp >= toDateTime('${start.replace('Z', '')}')
  AND timestamp <= toDateTime('${end.replace('Z', '')}')
  AND source IN ('function_edge_logs', 'edge_logs', 'storage_logs', 'auth_logs', 'realtime_logs')
ORDER BY timestamp ASC
LIMIT 1000
`.trim()

const [sourceCountRows, requestRows] = await Promise.all([
  query(sourceCountsSql),
  query(requestSql),
])

const sourceCounts = sourceCountRows.map((row) => ({
  source: string(row.source),
  eventCount: Number(row.event_count ?? row.eventCount ?? 0),
})).filter((row) => row.source.length > 0 && Number.isSafeInteger(row.eventCount) && row.eventCount >= 0)

const requests = requestRows.map((row) => ({
  timestamp: string(row.timestamp),
  idDigest: createHash('sha256').update(string(row.id)).digest('hex'),
  source: string(row.source),
  method: string(row.method).toUpperCase(),
  path: sanitizePath(row.path),
  status: Number(row.status ?? 0),
})).filter((row) => row.timestamp.length > 0 && row.source.length > 0)

const targetPath = '/functions/v1/xrpl-r4f-g3-directional-probe'
const targetFunctionRequests = requests.filter((row) =>
  row.source === 'function_edge_logs' && row.path.endsWith(targetPath),
)
const otherFunctionRequests = requests.filter((row) =>
  row.source === 'function_edge_logs' && !row.path.endsWith(targetPath),
)
const otherNetworkRequests = requests.filter((row) =>
  row.source !== 'function_edge_logs' && row.path.length > 0,
)

const evidence = {
  schemaVersion: 1,
  purpose: 'r4f-g3-concurrent-traffic-log-window',
  targetRun,
  interval: { start, end },
  projectIdentityDigest: createHash('sha256').update(projectRef).digest('hex'),
  providerEndpoint: 'supabase-management-api-project-logs-clickhouse',
  queryScope: {
    sourceCounts: true,
    networkRequestSources: ['function_edge_logs', 'edge_logs', 'storage_logs', 'auth_logs', 'realtime_logs'],
    maxRows: 1000,
    projectRefRetained: false,
    credentialsRetained: false,
  },
  sourceCounts,
  requests,
  classification: {
    targetFunctionPath: targetPath,
    targetFunctionRequestCount: targetFunctionRequests.length,
    otherFunctionRequestCount: otherFunctionRequests.length,
    otherNetworkRequestCount: otherNetworkRequests.length,
    noOtherFunctionRequestsObserved: otherFunctionRequests.length === 0,
  },
  safety: {
    readOnlyManagementApi: true,
    providerMutationPerformed: false,
    databaseRequestIssued: false,
    recoveryMutationCommitted: false,
    mainnetRequestIssued: false,
  },
}

const slash = output.lastIndexOf('/')
if (slash > 0) await mkdir(output.slice(0, slash), { recursive: true })
await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
process.stdout.write(`${JSON.stringify({
  targetRun,
  sourceCounts,
  targetFunctionRequestCount: targetFunctionRequests.length,
  otherFunctionRequestCount: otherFunctionRequests.length,
  otherNetworkRequestCount: otherNetworkRequests.length,
  output,
})}\n`)
