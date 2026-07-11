import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type ObjectType = 'vault' | 'loan_broker' | 'loan'

interface Arguments {
  base: string
  state: string
  binding: string
  metrics: string
  schedules: string
  output: string
}

interface HttpResult {
  status: number
  body: unknown
  durationMs: number
}

interface CollectionAudit {
  type: ObjectType
  firstPageCount: number
  secondPageCount: number
  hasNextCursor: boolean
  firstPageDurationMs: number
  secondPageDurationMs: number | null
  detailDurationMs: number | null
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function parseArguments(args: string[]): Arguments {
  const base = argumentValue(args, '--base')
  if (!base) throw new Error('--base is required')
  return {
    base: base.replace(/\/$/, ''),
    state: resolve(argumentValue(args, '--state') ?? 'production-read-audit/state.json'),
    binding: resolve(argumentValue(args, '--binding') ?? 'production-read-audit/binding.json'),
    metrics: resolve(argumentValue(args, '--metrics') ?? 'production-read-audit/metrics.json'),
    schedules: resolve(argumentValue(args, '--schedules') ?? 'production-read-audit/schedules.json'),
    output: resolve(argumentValue(args, '--output') ?? 'production-read-audit/summary.json'),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`)
  return value
}

function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^-?\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed)) throw new Error(`${field} must be a safe integer`)
  return Number(parsed)
}

function nonNegative(value: unknown, field: string): number {
  const parsed = integer(value, field)
  if (parsed < 0) throw new Error(`${field} must be non-negative`)
  return parsed
}

function d1Rows(value: unknown, field: string): Record<string, unknown>[] {
  const envelope = array(value, field)
  const first = record(envelope[0], `${field}[0]`)
  if (first.success !== true) throw new Error(`${field} query did not succeed`)
  return array(first.results, `${field}[0].results`).map((row, index) => record(row, `${field} row ${index}`))
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}

async function fetchJson(url: string): Promise<HttpResult> {
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Request failed for ${url}: ${message}`, { cause: error })
  }
  const text = await response.text()
  let body: unknown = null
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown
    } catch (error) {
      throw new Error(`Non-JSON response from ${url}: HTTP ${response.status}`, { cause: error })
    }
  }
  return { status: response.status, body, durationMs: Date.now() - startedAt }
}

function collectionPath(type: ObjectType): string {
  if (type === 'vault') return '/api/vaults'
  if (type === 'loan_broker') return '/api/loan-brokers'
  return '/api/loans'
}

function detailPath(type: ObjectType, id: string): string {
  return `${collectionPath(type)}/${id}`
}

function collectionIds(body: unknown, field: string): { ids: string[]; nextCursor: string | null } {
  const envelope = record(body, field)
  const data = array(envelope.data, `${field}.data`)
  const ids = data.map((item, index) => stringValue(record(item, `${field}.data[${index}]`).id, `${field}.data[${index}].id`))
  const page = record(envelope.page, `${field}.page`)
  const nextCursor = page.next_cursor === null ? null : stringValue(page.next_cursor, `${field}.page.next_cursor`)
  return { ids, nextCursor }
}

function assertStrictAscending(ids: string[], field: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${field} contains duplicate IDs`)
  for (let index = 1; index < ids.length; index += 1) {
    if (ids[index - 1]! >= ids[index]!) throw new Error(`${field} is not strictly ascending`)
  }
}

async function auditCollection(base: string, type: ObjectType): Promise<CollectionAudit> {
  const path = collectionPath(type)
  const first = await fetchJson(`${base}${path}?limit=25&sort=id_asc`)
  if (first.status !== 200) throw new Error(`${type} first page returned HTTP ${first.status}`)
  const firstPage = collectionIds(first.body, `${type} first page`)
  assertStrictAscending(firstPage.ids, `${type} first page`)

  let secondPageCount = 0
  let secondPageDurationMs: number | null = null
  if (firstPage.nextCursor) {
    const second = await fetchJson(
      `${base}${path}?limit=25&sort=id_asc&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
    )
    if (second.status !== 200) throw new Error(`${type} second page returned HTTP ${second.status}`)
    const secondPage = collectionIds(second.body, `${type} second page`)
    assertStrictAscending(secondPage.ids, `${type} second page`)
    const combined = [...firstPage.ids, ...secondPage.ids]
    if (new Set(combined).size !== combined.length) throw new Error(`${type} pagination contains duplicate IDs`)
    if (firstPage.ids.length > 0 && secondPage.ids.length > 0 && firstPage.ids.at(-1)! >= secondPage.ids[0]!) {
      throw new Error(`${type} pagination boundary is not strictly ascending`)
    }
    secondPageCount = secondPage.ids.length
    secondPageDurationMs = second.durationMs
  }

  let detailDurationMs: number | null = null
  const firstId = firstPage.ids[0]
  if (firstId) {
    const detail = await fetchJson(`${base}${detailPath(type, firstId)}`)
    if (detail.status !== 200) throw new Error(`${type} detail returned HTTP ${detail.status}`)
    const detailEnvelope = record(detail.body, `${type} detail`)
    const detailData = record(detailEnvelope.data, `${type} detail.data`)
    if (detailData.id !== firstId) throw new Error(`${type} detail ID does not match collection item`)
    detailDurationMs = detail.durationMs
  }

  return {
    type,
    firstPageCount: firstPage.ids.length,
    secondPageCount,
    hasNextCursor: firstPage.nextCursor !== null,
    firstPageDurationMs: first.durationMs,
    secondPageDurationMs,
    detailDurationMs,
  }
}

function validateMetrics(rows: Record<string, unknown>[]): {
  intervalsSeconds: number[]
  newestRunAt: string
  oldestRunAt: string
  maxLagLedgers: number
  processedRuns: number
} {
  if (rows.length < 3) throw new Error(`expected at least 3 fast-lane run metrics, found ${rows.length}`)
  const allowed = new Set(['caught_up', 'committed', 'reanchored'])
  const times = rows.map((row, index) => {
    const status = stringValue(row.status, `metrics[${index}].status`)
    if (!allowed.has(status)) throw new Error(`metrics[${index}] has invalid status ${status}`)
    const lag = nonNegative(row.lag_ledgers, `metrics[${index}].lag_ledgers`)
    if (lag > 10) throw new Error(`metrics[${index}] lag ${lag} exceeds 10 ledgers`)
    nonNegative(row.ledgers_processed, `metrics[${index}].ledgers_processed`)
    nonNegative(row.lending_transactions, `metrics[${index}].lending_transactions`)
    nonNegative(row.coalesced_object_rows, `metrics[${index}].coalesced_object_rows`)
    nonNegative(row.persistence_rows_read, `metrics[${index}].persistence_rows_read`)
    nonNegative(row.persistence_rows_written, `metrics[${index}].persistence_rows_written`)
    const runAt = stringValue(row.run_at, `metrics[${index}].run_at`)
    const time = Date.parse(runAt)
    if (!Number.isFinite(time)) throw new Error(`metrics[${index}].run_at is invalid`)
    return time
  })

  const intervalsSeconds: number[] = []
  for (let index = 1; index < times.length; index += 1) {
    const interval = (times[index - 1]! - times[index]!) / 1000
    if (interval < 240 || interval > 420) {
      throw new Error(`fast-lane run interval ${interval}s is outside 240–420s`)
    }
    intervalsSeconds.push(interval)
  }
  const newestAgeMs = Date.now() - times[0]!
  if (newestAgeMs < 0 || newestAgeMs > 15 * 60 * 1000) {
    throw new Error(`newest fast-lane metric is stale by ${Math.round(newestAgeMs / 1000)}s`)
  }

  return {
    intervalsSeconds,
    newestRunAt: stringValue(rows[0]!.run_at, 'metrics[0].run_at'),
    oldestRunAt: stringValue(rows.at(-1)!.run_at, 'metrics[last].run_at'),
    maxLagLedgers: Math.max(...rows.map((row) => nonNegative(row.lag_ledgers, 'metric lag'))),
    processedRuns: rows.filter((row) => nonNegative(row.ledgers_processed, 'metric ledgers processed') > 0).length,
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const [stateJson, bindingJson, metricsJson, schedulesJson] = await Promise.all([
    readJson(args.state),
    readJson(args.binding),
    readJson(args.metrics),
    readJson(args.schedules),
  ])

  const stateRows = d1Rows(stateJson, 'state')
  if (stateRows.length !== 1) throw new Error(`expected one fast-lane state row, found ${stateRows.length}`)
  const state = stateRows[0]!
  const stateStatus = stringValue(state.status, 'state.status')
  if (stateStatus === 'error') throw new Error('fast-lane state is in error')
  const lastProcessedLedger = nonNegative(state.last_processed_ledger, 'state.last_processed_ledger')
  const latestObservedLedger = nonNegative(state.latest_observed_ledger, 'state.latest_observed_ledger')
  const stateLag = Math.max(0, latestObservedLedger - lastProcessedLedger)
  if (stateLag > 10) throw new Error(`fast-lane state lag ${stateLag} exceeds 10 ledgers`)

  const bindingRows = d1Rows(bindingJson, 'binding')
  if (bindingRows.length !== 1) throw new Error(`expected one fast-lane binding row, found ${bindingRows.length}`)
  const binding = bindingRows[0]!
  const metricsRows = d1Rows(metricsJson, 'metrics')
  const metrics = validateMetrics(metricsRows)

  const schedulesEnvelope = record(schedulesJson, 'schedules')
  if (schedulesEnvelope.success !== true) throw new Error('production schedules query did not succeed')
  const schedules = array(record(schedulesEnvelope.result, 'schedules.result').schedules, 'schedules.result.schedules')
  if (schedules.length !== 1 || record(schedules[0], 'schedule').cron !== '*/5 * * * *') {
    throw new Error('production schedule is not exactly one shared five-minute cron')
  }

  const [overviewResponse, diffResponse, collectorResponse, historyResponse, vaults, brokers, loans] = await Promise.all([
    fetchJson(`${args.base}/api/overview`),
    fetchJson(`${args.base}/api/status/fast-lane-diff?limit=500`),
    fetchJson(`${args.base}/api/status/collector`),
    fetchJson(`${args.base}/api/status/history-source`),
    auditCollection(args.base, 'vault'),
    auditCollection(args.base, 'loan_broker'),
    auditCollection(args.base, 'loan'),
  ])

  for (const [name, response] of [
    ['overview', overviewResponse],
    ['fast-lane diff', diffResponse],
    ['collector status', collectorResponse],
    ['history source', historyResponse],
  ] as const) {
    if (response.status !== 200) throw new Error(`${name} returned HTTP ${response.status}`)
  }

  const overview = record(overviewResponse.body, 'overview')
  const currentWatermark = record(overview.current_state_watermark, 'overview.current_state_watermark')
  const countsWatermark = record(overview.counts_watermark, 'overview.counts_watermark')
  if (currentWatermark.source !== 'fast_lane') throw new Error('Overview current-state source is not fast_lane')
  if (integer(currentWatermark.ledger_index, 'Overview current ledger') !== lastProcessedLedger) {
    throw new Error('Overview current-state ledger does not match D1 fast-lane state')
  }
  if (stringValue(currentWatermark.ledger_hash, 'Overview current hash').toUpperCase()
      !== stringValue(state.last_processed_hash, 'state.last_processed_hash').toUpperCase()) {
    throw new Error('Overview current-state hash does not match D1 fast-lane state')
  }
  if (integer(countsWatermark.ledger_index, 'Overview counts ledger') > lastProcessedLedger) {
    throw new Error('Overview counts watermark is ahead of current-state watermark')
  }

  const snapshot = record(overview.snapshot, 'overview.snapshot')
  if (binding.base_snapshot_id !== snapshot.id) throw new Error('fast-lane base binding snapshot does not match Overview')
  if (integer(binding.base_ledger_index, 'binding.base_ledger_index') !== integer(snapshot.ledger_index, 'snapshot.ledger_index')) {
    throw new Error('fast-lane base binding ledger does not match Overview snapshot')
  }
  if (stringValue(binding.base_ledger_hash, 'binding.base_ledger_hash').toUpperCase()
      !== stringValue(snapshot.ledger_hash, 'snapshot.ledger_hash').toUpperCase()) {
    throw new Error('fast-lane base binding hash does not match Overview snapshot')
  }

  const diff = record(diffResponse.body, 'fast-lane diff')
  if (diff.status !== 'ok' || diff.passed !== true) throw new Error('fast-lane differential status did not pass')
  const sample = record(diff.sample, 'fast-lane diff.sample')
  if (nonNegative(sample.sampledRows, 'fast-lane sampled rows') < 1) throw new Error('fast-lane diff sample is empty')
  if (nonNegative(sample.exactProjectionMismatches, 'fast-lane projection mismatches') !== 0) {
    throw new Error('fast-lane diff contains projection mismatches')
  }

  const collector = record(collectorResponse.body, 'collector status')
  const history = record(historyResponse.body, 'history source')
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    passed: true,
    productionBase: args.base,
    schedule: { count: schedules.length, cron: '*/5 * * * *' },
    state: {
      epochId: state.epoch_id,
      status: stateStatus,
      lastProcessedLedger,
      latestObservedLedger,
      lagLedgers: stateLag,
      updatedAt: state.updated_at,
    },
    metrics,
    overview: {
      currentStateWatermark: currentWatermark,
      countsWatermark,
      durationMs: overviewResponse.durationMs,
    },
    fastLaneDiff: {
      sampledRows: sample.sampledRows,
      exactProjectionMismatches: sample.exactProjectionMismatches,
      durationMs: diffResponse.durationMs,
    },
    collector: {
      status: collector.status,
      cursor: collector.cursor,
      error: collector.error,
      durationMs: collectorResponse.durationMs,
    },
    historySource: {
      status: history.status,
      mode: history.mode,
      durationMs: historyResponse.durationMs,
    },
    collections: { vaults, brokers, loans },
  }

  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
