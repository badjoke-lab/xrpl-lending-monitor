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
const managementEndpoint = `https://api.supabase.com/v1/projects/${projectRef}/analytics/endpoints/logs.all`
const retryableLogErrorPrefix = 'Backend error! Retry your query'
const retryDelaysMilliseconds = [0, 2_000, 5_000, 10_000]
const cpuHardMilliseconds = 2_000
const cpuHaltMilliseconds = 1_600
const memoryHardBytes = 256 * 1024 * 1024
const memoryHaltBytes = 200 * 1024 * 1024

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

function rowsFromResponse(raw) {
  const rows = Array.isArray(raw?.result)
    ? raw.result
    : Array.isArray(raw?.data)
      ? raw.data
      : Array.isArray(raw)
        ? raw
        : null
  if (!rows) throw new Error('runtime resource log query returned an unsupported shape')
  return rows
}

function isRetryable(raw) {
  return typeof raw?.error === 'string' && raw.error.startsWith(retryableLogErrorPrefix)
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function queryLogs(searchParams) {
  const url = new URL(managementEndpoint)
  for (const [key, value] of Object.entries(searchParams)) url.searchParams.set(key, value)
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text.slice(0, 2_000) } }
  if (!response.ok) {
    throw new Error(`runtime resource log query failed (${response.status}): ${JSON.stringify(parsed).slice(0, 2_000)}`)
  }
  return parsed
}

async function queryLogsWithRetry(searchParams) {
  let last
  for (const [index, delay] of retryDelaysMilliseconds.entries()) {
    if (delay > 0) await sleep(delay)
    last = await queryLogs(searchParams)
    if (!isRetryable(last)) return { raw: last, attempts: index + 1 }
  }
  return { raw: last, attempts: retryDelaysMilliseconds.length }
}

function parseJsonCandidate(value) {
  if (typeof value === 'object' && value !== null) return value
  if (typeof value !== 'string') return null
  let candidate = value.trim()
  for (let index = 0; index < 2; index += 1) {
    try {
      const parsed = JSON.parse(candidate)
      if (typeof parsed === 'string') {
        candidate = parsed.trim()
        continue
      }
      return parsed
    } catch {
      break
    }
  }
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

function findShutdown(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null || seen.has(value)) return null
  seen.add(value)
  if (!Array.isArray(value)) {
    if (typeof value.Shutdown === 'object' && value.Shutdown !== null) return value.Shutdown
    if (typeof value.shutdown === 'object' && value.shutdown !== null) return value.shutdown
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findShutdown(child, seen)
    if (found) return found
  }
  return null
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) throw new Error('percentile requires at least one value')
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

function extractSamples(rows) {
  const samples = []
  let rejectedRows = 0
  for (const [index, rawRow] of rows.entries()) {
    const row = object(rawRow, `runtime log row ${index}`)
    const parsed = parseJsonCandidate(row.event_message ?? row.eventMessage ?? row.message)
    const shutdown = findShutdown(parsed)
    if (!shutdown) {
      rejectedRows += 1
      continue
    }
    const memory = object(shutdown.memory_used ?? shutdown.memoryUsed, `shutdown ${index} memory`)
    const cpuMilliseconds = nonNegativeNumber(
      shutdown.cpu_time_used ?? shutdown.cpuTimeUsed,
      `shutdown ${index} cpu_time_used`,
    )
    const totalMemoryBytes = nonNegativeNumber(
      memory.total ?? memory.total_bytes ?? memory.totalBytes,
      `shutdown ${index} memory total`,
    )
    const heapMemoryBytes = nonNegativeNumber(
      memory.heap ?? memory.heap_bytes ?? memory.heapBytes ?? 0,
      `shutdown ${index} memory heap`,
    )
    const externalMemoryBytes = nonNegativeNumber(
      memory.external ?? memory.external_bytes ?? memory.externalBytes ?? 0,
      `shutdown ${index} memory external`,
    )
    const reason = String(shutdown.reason ?? 'unknown')
    samples.push({
      reason,
      cpuMilliseconds,
      totalMemoryBytes,
      heapMemoryBytes,
      externalMemoryBytes,
    })
  }
  if (samples.length < 1) throw new Error('no parseable ShutdownEvent resource samples were returned')
  return { samples, rejectedRows }
}

async function run() {
  await mkdir(evidenceDirectory, { recursive: true })
  const observedAtDate = new Date(Math.floor(Date.now() / 60_000) * 60_000)
  const windowStartDate = new Date(observedAtDate.getTime() - 24 * 60 * 60 * 1_000)
  const observedAt = observedAtDate.toISOString()
  const windowStart = windowStartDate.toISOString()
  const query = await queryLogsWithRetry({
    sql: `SELECT timestamp, event_message\nFROM logs\nWHERE source_name = 'function_logs'\n  AND positionCaseInsensitive(event_message, 'Shutdown') > 0\nORDER BY timestamp DESC\nLIMIT 1000`,
    iso_timestamp_start: windowStart,
    iso_timestamp_end: observedAt,
  })
  if (query.raw?.error) throw new Error(`runtime resource log query returned error: ${String(query.raw.error)}`)
  const rows = rowsFromResponse(query.raw)
  const { samples, rejectedRows } = extractSamples(rows)
  const reasons = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.reason))]
      .sort()
      .map((reason) => [reason, samples.filter((sample) => sample.reason === reason).length]),
  )
  const cpu = statistics(samples.map((sample) => sample.cpuMilliseconds))
  const memoryTotal = statistics(samples.map((sample) => sample.totalMemoryBytes))
  const memoryHeap = statistics(samples.map((sample) => sample.heapMemoryBytes))
  const memoryExternal = statistics(samples.map((sample) => sample.externalMemoryBytes))
  const terminalResourceReasons = ['CPUTime', 'Memory', 'WallClockTime']
  const terminalResourceShutdowns = samples.filter((sample) => terminalResourceReasons.includes(sample.reason)).length

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2d-runtime-resource-log-snapshot',
    sourceRunId,
    sourceCommit,
    observedAt,
    windowStart,
    windowHours: 24,
    queryAttempts: query.attempts,
    queriedRows: rows.length,
    parsedShutdownEvents: samples.length,
    rejectedRows,
    reasons,
    cpuMilliseconds: cpu,
    memoryTotalBytes: memoryTotal,
    memoryHeapBytes: memoryHeap,
    memoryExternalBytes: memoryExternal,
    thresholds: {
      cpuHaltMilliseconds,
      cpuHardMilliseconds,
      memoryHaltBytes,
      memoryHardBytes,
    },
    checks: {
      nonemptyShutdownEvidence: samples.length > 0,
      noRawEventMessagesRetained: true,
      noExecutionIdsRetained: true,
      noTerminalResourceShutdowns: terminalResourceShutdowns === 0,
      cpuBelowHaltThreshold: cpu.maximum < cpuHaltMilliseconds,
      memoryBelowHaltThreshold: memoryTotal.maximum < memoryHaltBytes,
      boundedTransientLogRetry: true,
      profileSelected: false,
      g8Qualified: false,
    },
  }
  if (
    evidence.checks.noTerminalResourceShutdowns !== true
    || evidence.checks.cpuBelowHaltThreshold !== true
    || evidence.checks.memoryBelowHaltThreshold !== true
  ) {
    throw new Error(`runtime resource evidence crossed a halt boundary: ${JSON.stringify(evidence.checks)}`)
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
    schemaVersion: 1,
    purpose: 'r4c2d-runtime-resource-log-snapshot',
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