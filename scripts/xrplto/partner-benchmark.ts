import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

import { parseValidatedLedgerResult } from '../../src/collector/incremental/validated-ledger-parser'

const XRPLTO_RPC = 'https://api.xrpl.to/v1/testnet/rpc'
const DIRECT_RPC = 'https://s.altnet.rippletest.net:51234/'
const OUTPUT_DIR =
  process.env.XRPLTO_PARTNER_BENCHMARK_OUTPUT_DIR ||
  '.local/xrplto-partner-benchmark'
const API_KEY = process.env.XRPLTO_API_KEY?.trim() || ''
const SAMPLE_LEDGERS = Number.parseInt(
  process.env.XRPLTO_SAMPLE_LEDGERS || '100',
  10,
)
const XRPLTO_WINDOW = Number.parseInt(
  process.env.XRPLTO_WINDOW || '16',
  10,
)
const XRPLTO_SPACING_MS = Number.parseInt(
  process.env.XRPLTO_SPACING_MS || '0',
  10,
)
const DIRECT_WINDOW = 16
const TIMEOUT_MS = 15_000
const USER_AGENT =
  'xrpl-lending-monitor-partner-benchmark/1.0 (+https://github.com/badjoke-lab/xrpl-lending-monitor)'

if (!API_KEY) throw new Error('XRPLTO_API_KEY is required')
if (!Number.isSafeInteger(SAMPLE_LEDGERS) || SAMPLE_LEDGERS < 1 || SAMPLE_LEDGERS > 1000) {
  throw new Error('XRPLTO_SAMPLE_LEDGERS must be an integer from 1 through 1000')
}
if (!Number.isSafeInteger(XRPLTO_WINDOW) || XRPLTO_WINDOW < 1 || XRPLTO_WINDOW > 32) {
  throw new Error('XRPLTO_WINDOW must be an integer from 1 through 32')
}
if (!Number.isSafeInteger(XRPLTO_SPACING_MS) || XRPLTO_SPACING_MS < 0) {
  throw new Error('XRPLTO_SPACING_MS must be a non-negative integer')
}

interface RpcRead {
  result: Record<string, unknown>
  elapsedMs: number
  responseBytes: number
  headers: Record<string, string>
}

interface LedgerMeasurement {
  ledgerIndex: number
  elapsedMs: number
  responseBytes: number
  ledgerHash: string
  semanticDigest: string
  transactionCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function selectedHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of [
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-daily-remaining',
  ]) {
    const value = headers.get(name)
    if (value !== null) out[name] = value
  }
  return out
}

async function postJson(
  url: string,
  payload: unknown,
  useKey: boolean,
): Promise<{
  body: Record<string, unknown>
  elapsedMs: number
  responseBytes: number
  headers: Record<string, string>
}> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const started = performance.now()

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'user-agent': USER_AGENT,
        ...(useKey ? { 'x-api-key': API_KEY } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    const elapsedMs = Number((performance.now() - started).toFixed(3))
    const text = await response.text()
    const headers = selectedHeaders(response.headers)

    let body: unknown
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(
        `${url} returned non-JSON HTTP ${response.status}: ${text.slice(0, 300)}`,
      )
    }

    if (!response.ok) {
      throw new Error(
        `${url} returned HTTP ${response.status} headers=${JSON.stringify(headers)} body=${text.slice(0, 300)}`,
      )
    }
    if (!isRecord(body)) throw new Error(`${url} returned a non-object JSON body`)

    return {
      body,
      elapsedMs,
      responseBytes: Buffer.byteLength(text),
      headers,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function xrplToRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcRead> {
  const response = await postJson(XRPLTO_RPC, { method, params }, true)
  if (response.body.success !== true || response.body.method !== method) {
    throw new Error(`XRPL.to ${method} envelope mismatch`)
  }
  if (!isRecord(response.body.result)) {
    throw new Error(`XRPL.to ${method} missing result`)
  }
  if (response.body.result.error) {
    throw new Error(
      `XRPL.to ${method} node error ${String(response.body.result.error)}`,
    )
  }
  return { ...response, result: response.body.result }
}

async function directRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<RpcRead> {
  const response = await postJson(
    DIRECT_RPC,
    {
      method,
      params: [{ ...params, api_version: 2 }],
    },
    false,
  )
  if (!isRecord(response.body.result)) {
    throw new Error(`Direct ${method} missing result`)
  }
  if (response.body.result.error) {
    throw new Error(
      `Direct ${method} node error ${String(response.body.result.error)}`,
    )
  }
  return { ...response, result: response.body.result }
}

function validatedSeq(result: Record<string, unknown>): number {
  const info = result.info
  if (!isRecord(info) || !isRecord(info.validated_ledger)) {
    throw new Error('server_info missing validated_ledger')
  }
  const seq = Number(info.validated_ledger.seq)
  if (!Number.isSafeInteger(seq) || seq < SAMPLE_LEDGERS + 20) {
    throw new Error('Invalid validated ledger index')
  }
  return seq
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key])
  return out
}

function semanticDigest(
  parsed: ReturnType<typeof parseValidatedLedgerResult>,
): string {
  const semantic = {
    ledgerIndex: parsed.ledgerIndex,
    ledgerHash: parsed.ledgerHash,
    parentHash: parsed.parentHash,
    closeTime: parsed.closeTime,
    transactions: parsed.transactions.map((item) => ({
      hash: item.hash,
      transactionType: item.transactionType,
      account: item.account,
      sequence: item.sequence,
      fee: item.fee,
      result: item.result,
      transactionIndex: item.transactionIndex,
      transaction: item.transaction,
      metadata: item.metadata,
    })),
  }

  return createHash('sha256')
    .update(JSON.stringify(stableValue(semantic)))
    .digest('hex')
}

function measurement(
  endpoint: string,
  ledgerIndex: number,
  read: RpcRead,
): LedgerMeasurement {
  const parsed = parseValidatedLedgerResult({
    endpoint,
    requestedLedgerIndex: ledgerIndex,
    result: read.result,
  })

  return {
    ledgerIndex,
    elapsedMs: read.elapsedMs,
    responseBytes: read.responseBytes,
    ledgerHash: parsed.ledgerHash,
    semanticDigest: semanticDigest(parsed),
    transactionCount: parsed.transactions.length,
  }
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return Number(sorted[index].toFixed(3))
}

function stats(items: readonly LedgerMeasurement[], wallMs: number) {
  const latencies = items.map((item) => item.elapsedMs)
  return {
    ledgers: items.length,
    wallMs: Number(wallMs.toFixed(3)),
    requestsPerSecond: Number((items.length / (wallMs / 1000)).toFixed(3)),
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(3)),
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: Number(Math.max(...latencies).toFixed(3)),
      mean: Number(
        (
          latencies.reduce((sum, value) => sum + value, 0) /
          latencies.length
        ).toFixed(3),
      ),
    },
    totalResponseBytes: items.reduce(
      (sum, item) => sum + item.responseBytes,
      0,
    ),
    totalTransactions: items.reduce(
      (sum, item) => sum + item.transactionCount,
      0,
    ),
  }
}

async function readXrplToRange(indexes: readonly number[]) {
  const reads: LedgerMeasurement[] = []
  const started = performance.now()
  let lastHeaders: Record<string, string> = {}

  for (let offset = 0; offset < indexes.length; offset += XRPLTO_WINDOW) {
    if (offset > 0 && XRPLTO_SPACING_MS > 0) {
      await sleep(XRPLTO_SPACING_MS)
    }
    const window = indexes.slice(offset, offset + XRPLTO_WINDOW)
    const results = await Promise.all(
      window.map(async (ledgerIndex) => {
        const read = await xrplToRpc('ledger', {
          ledger_index: ledgerIndex,
          transactions: true,
          expand: true,
          owner_funds: false,
        })
        return {
          measurement: measurement(XRPLTO_RPC, ledgerIndex, read),
          headers: read.headers,
        }
      }),
    )

    for (const result of results) {
      lastHeaders = result.headers
      reads.push(result.measurement)
    }
  }

  reads.sort((left, right) => left.ledgerIndex - right.ledgerIndex)
  return {
    reads,
    wallMs: performance.now() - started,
    finalRateLimitHeaders: lastHeaders,
  }
}

async function readDirectRange(indexes: readonly number[]) {
  const reads: LedgerMeasurement[] = []
  const started = performance.now()

  for (let offset = 0; offset < indexes.length; offset += DIRECT_WINDOW) {
    const window = indexes.slice(offset, offset + DIRECT_WINDOW)
    const results = await Promise.all(
      window.map(async (ledgerIndex) => {
        const read = await directRpc('ledger', {
          ledger_index: ledgerIndex,
          transactions: true,
          expand: true,
          owner_funds: false,
        })
        return measurement(DIRECT_RPC, ledgerIndex, read)
      }),
    )
    reads.push(...results)
  }

  return {
    reads,
    wallMs: performance.now() - started,
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const startedAt = new Date().toISOString()

  const head = await xrplToRpc('server_info')
  const latest = validatedSeq(head.result)
  const endLedger = latest - 10
  const startLedger = endLedger - SAMPLE_LEDGERS + 1
  const indexes = Array.from(
    { length: SAMPLE_LEDGERS },
    (_, offset) => startLedger + offset,
  )

  const direct = await readDirectRange(indexes)
  const xrplTo = await readXrplToRange(indexes)

  const directByIndex = new Map(
    direct.reads.map((item) => [item.ledgerIndex, item]),
  )
  const mismatches: Array<{
    ledgerIndex: number
    field: string
    xrplTo: string
    direct: string
  }> = []

  for (const item of xrplTo.reads) {
    const other = directByIndex.get(item.ledgerIndex)
    if (!other) {
      mismatches.push({
        ledgerIndex: item.ledgerIndex,
        field: 'missing-direct-ledger',
        xrplTo: item.ledgerHash,
        direct: '',
      })
      continue
    }
    if (item.ledgerHash !== other.ledgerHash) {
      mismatches.push({
        ledgerIndex: item.ledgerIndex,
        field: 'ledgerHash',
        xrplTo: item.ledgerHash,
        direct: other.ledgerHash,
      })
    }
    if (item.semanticDigest !== other.semanticDigest) {
      mismatches.push({
        ledgerIndex: item.ledgerIndex,
        field: 'semanticDigest',
        xrplTo: item.semanticDigest,
        direct: other.semanticDigest,
      })
    }
  }

  const summary = {
    schemaVersion: 1,
    probe: 'xrplto-partner-benchmark',
    startedAt,
    completedAt: new Date().toISOString(),
    sample: {
      ledgers: SAMPLE_LEDGERS,
      startLedger,
      endLedger,
      latestObservedByXrplTo: latest,
    },
    xrplTo: {
      auth: 'api-key',
      intentionalSpacingMs: XRPLTO_SPACING_MS,
      readWindow: XRPLTO_WINDOW,
      ...stats(xrplTo.reads, xrplTo.wallMs),
      finalRateLimitHeaders: xrplTo.finalRateLimitHeaders,
    },
    direct: {
      endpoint: DIRECT_RPC,
      readWindow: DIRECT_WINDOW,
      ...stats(direct.reads, direct.wallMs),
    },
    parity: {
      comparedLedgers: xrplTo.reads.length,
      mismatches,
      allSemanticDigestsEqual: mismatches.length === 0,
    },
    pass:
      xrplTo.reads.length === SAMPLE_LEDGERS &&
      direct.reads.length === SAMPLE_LEDGERS &&
      mismatches.length === 0,
  }

  await writeFile(
    `${OUTPUT_DIR}/summary.json`,
    JSON.stringify(summary, null, 2) + '\n',
  )

  await writeFile(
    `${OUTPUT_DIR}/evidence.md`,
    [
      '# XRPL.to Partner benchmark',
      '',
      `- pass: **${summary.pass ? 'YES' : 'NO'}**`,
      `- range: \`${startLedger} → ${endLedger}\` (${SAMPLE_LEDGERS} ledgers)`,
      `- semantic mismatches: \`${mismatches.length}\``,
      `- XRPL.to window: \`${XRPLTO_WINDOW}\``,
      `- XRPL.to wall time: \`${summary.xrplTo.wallMs} ms\``,
      `- XRPL.to p50/p95: \`${summary.xrplTo.latencyMs.p50} / ${summary.xrplTo.latencyMs.p95} ms\``,
      `- XRPL.to effective rate: \`${summary.xrplTo.requestsPerSecond} req/s\``,
      `- direct wall time: \`${summary.direct.wallMs} ms\``,
      `- direct p50/p95: \`${summary.direct.latencyMs.p50} / ${summary.direct.latencyMs.p95} ms\``,
      `- direct effective rate: \`${summary.direct.requestsPerSecond} req/s\``,
      '',
      'The API key is supplied only through X-Api-Key and is never written to artifacts.',
      '',
    ].join('\n'),
  )

  console.log(JSON.stringify(summary, null, 2))
  if (!summary.pass) process.exitCode = 1
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const failure = {
    schemaVersion: 1,
    probe: 'xrplto-partner-benchmark',
    pass: false,
    failedAt: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error),
  }
  await writeFile(
    `${OUTPUT_DIR}/failure.json`,
    JSON.stringify(failure, null, 2) + '\n',
  )
  console.error(error)
  process.exitCode = 1
})
