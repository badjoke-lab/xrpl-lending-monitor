import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

const XRPLTO_RPC = 'https://api.xrpl.to/v1/testnet/rpc'
const DIRECT_RPC = 'https://s.altnet.rippletest.net:51234/'
const OUTPUT_DIR =
  process.env.XRPLTO_PARTNER_LEDGER_DATA_OUTPUT_DIR ||
  '.local/xrplto-partner-ledger-data'
const API_KEY = process.env.XRPLTO_API_KEY?.trim() || ''
const MAX_PAGES = Number.parseInt(
  process.env.XRPLTO_LEDGER_DATA_PAGES || '100',
  10,
)
const PAGE_LIMIT = Number.parseInt(
  process.env.XRPLTO_LEDGER_DATA_LIMIT || '2048',
  10,
)
const BINARY = process.env.XRPLTO_LEDGER_DATA_BINARY !== 'false'
const TIMEOUT_MS = 20_000
const USER_AGENT =
  'xrpl-lending-monitor-partner-ledger-data/1.0 (+https://github.com/badjoke-lab/xrpl-lending-monitor)'

if (!API_KEY) throw new Error('XRPLTO_API_KEY is required')
if (!Number.isSafeInteger(MAX_PAGES) || MAX_PAGES < 1 || MAX_PAGES > 1000) {
  throw new Error('XRPLTO_LEDGER_DATA_PAGES must be an integer from 1 through 1000')
}
if (!Number.isSafeInteger(PAGE_LIMIT) || PAGE_LIMIT < 1 || PAGE_LIMIT > 2048) {
  throw new Error('XRPLTO_LEDGER_DATA_LIMIT must be an integer from 1 through 2048')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!isRecord(value)) return value
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value).sort()) out[key] = stableValue(value[key])
  return out
}

function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)
  return Number(sorted[index].toFixed(3))
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
) {
  const response = await postJson(XRPLTO_RPC, { method, params }, true)
  if (response.body.success !== true || response.body.method !== method) {
    throw new Error(`XRPL.to ${method} envelope mismatch`)
  }
  if (!isRecord(response.body.result)) {
    throw new Error(`XRPL.to ${method} missing result object`)
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
) {
  const response = await postJson(
    DIRECT_RPC,
    {
      method,
      params: [{ ...params, api_version: 2 }],
    },
    false,
  )
  if (!isRecord(response.body.result)) {
    throw new Error(`Direct ${method} missing result object`)
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
    throw new Error('server_info missing info.validated_ledger')
  }
  const seq = Number(info.validated_ledger.seq)
  if (!Number.isSafeInteger(seq) || seq < 20) {
    throw new Error('server_info returned an invalid validated ledger sequence')
  }
  return seq
}

function stateIndex(row: unknown): string | null {
  if (!isRecord(row)) return null
  const index = row.index ?? row.LedgerIndex
  return typeof index === 'string' && index.length > 0 ? index : null
}

async function traverse(options: {
  name: 'xrplto' | 'direct'
  ledgerIndex: number
  call: (
    method: string,
    params: Record<string, unknown>,
  ) => Promise<{
    result: Record<string, unknown>
    elapsedMs: number
    responseBytes: number
    headers: Record<string, string>
  }>
}) {
  const digest = createHash('sha256')
  const latencies: number[] = []
  let marker: unknown = undefined
  let pages = 0
  let rows = 0
  let totalResponseBytes = 0
  let ledgerHash: string | null = null
  let firstIndex: string | null = null
  let lastIndex: string | null = null
  let finalHeaders: Record<string, string> = {}
  const started = performance.now()

  while (pages < MAX_PAGES) {
    const params: Record<string, unknown> = {
      ledger_index: options.ledgerIndex,
      binary: BINARY,
      limit: PAGE_LIMIT,
    }
    if (marker !== undefined && marker !== null) params.marker = marker

    const response = await options.call('ledger_data', params)
    const result = response.result
    const state = result.state
    if (!Array.isArray(state)) {
      throw new Error(
        `${options.name}: ledger_data result.state was not an array`,
      )
    }

    const currentLedgerIndex = Number(result.ledger_index)
    if (currentLedgerIndex !== options.ledgerIndex) {
      throw new Error(
        `${options.name}: ledger_data index ${currentLedgerIndex} != ${options.ledgerIndex}`,
      )
    }

    const currentLedgerHash =
      typeof result.ledger_hash === 'string' ? result.ledger_hash : null
    if (!currentLedgerHash) {
      throw new Error(`${options.name}: ledger_data missing ledger_hash`)
    }
    if (ledgerHash !== null && currentLedgerHash !== ledgerHash) {
      throw new Error(
        `${options.name}: ledger_hash changed during traversal`,
      )
    }
    ledgerHash = currentLedgerHash

    for (const row of state) {
      digest.update(JSON.stringify(stableValue(row)))
      digest.update('\n')
      const index = stateIndex(row)
      if (firstIndex === null && index !== null) firstIndex = index
      if (index !== null) lastIndex = index
    }

    rows += state.length
    pages += 1
    totalResponseBytes += response.responseBytes
    latencies.push(response.elapsedMs)
    finalHeaders = response.headers

    marker = result.marker
    if (marker === undefined || marker === null) break
  }

  const wallMs = performance.now() - started
  return {
    name: options.name,
    pages,
    rows,
    exhausted: marker === undefined || marker === null,
    markerAfterFinalPage: marker ?? null,
    ledgerHash,
    firstIndex,
    lastIndex,
    semanticDigest: digest.digest('hex'),
    totalResponseBytes,
    wallMs: Number(wallMs.toFixed(3)),
    pagesPerSecond: Number((pages / (wallMs / 1000)).toFixed(3)),
    rowsPerSecond: Number((rows / (wallMs / 1000)).toFixed(3)),
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
    finalHeaders,
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const startedAt = new Date().toISOString()

  const head = await xrplToRpc('server_info')
  const targetLedger = validatedSeq(head.result) - 10

  const direct = await traverse({
    name: 'direct',
    ledgerIndex: targetLedger,
    call: directRpc,
  })

  const xrplTo = await traverse({
    name: 'xrplto',
    ledgerIndex: targetLedger,
    call: xrplToRpc,
  })

  const summary = {
    schemaVersion: 1,
    probe: 'xrplto-partner-ledger-data',
    startedAt,
    completedAt: new Date().toISOString(),
    targetLedger,
    pageLimit: PAGE_LIMIT,
    binary: BINARY,
    maxPages: MAX_PAGES,
    xrplTo,
    direct,
    parity: {
      ledgerHashEqual: xrplTo.ledgerHash === direct.ledgerHash,
      rowCountEqual: xrplTo.rows === direct.rows,
      semanticDigestEqual:
        xrplTo.semanticDigest === direct.semanticDigest,
      firstIndexEqual: xrplTo.firstIndex === direct.firstIndex,
      lastIndexEqual: xrplTo.lastIndex === direct.lastIndex,
    },
    pass:
      xrplTo.ledgerHash === direct.ledgerHash &&
      xrplTo.rows === direct.rows &&
      xrplTo.semanticDigest === direct.semanticDigest,
  }

  await writeFile(
    `${OUTPUT_DIR}/summary.json`,
    JSON.stringify(summary, null, 2) + '\n',
  )

  await writeFile(
    `${OUTPUT_DIR}/evidence.md`,
    [
      '# XRPL.to Partner ledger_data benchmark',
      '',
      `- pass: **${summary.pass ? 'YES' : 'NO'}**`,
      `- target ledger: \`${targetLedger}\``,
      `- binary: \`${BINARY}\``,
      `- page limit: \`${PAGE_LIMIT}\``,
      `- max pages: \`${MAX_PAGES}\``,
      `- XRPL.to pages / rows: \`${xrplTo.pages} / ${xrplTo.rows}\``,
      `- direct pages / rows: \`${direct.pages} / ${direct.rows}\``,
      `- semantic digest equal: \`${summary.parity.semanticDigestEqual}\``,
      `- XRPL.to wall time: \`${xrplTo.wallMs} ms\``,
      `- XRPL.to rows/sec: \`${xrplTo.rowsPerSecond}\``,
      `- XRPL.to p50/p95: \`${xrplTo.latencyMs.p50} / ${xrplTo.latencyMs.p95} ms\``,
      `- direct wall time: \`${direct.wallMs} ms\``,
      `- direct rows/sec: \`${direct.rowsPerSecond}\``,
      `- direct p50/p95: \`${direct.latencyMs.p50} / ${direct.latencyMs.p95} ms\``,
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
    probe: 'xrplto-partner-ledger-data',
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
