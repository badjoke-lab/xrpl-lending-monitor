import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

import { parseValidatedLedgerResult } from '../../src/collector/incremental/validated-ledger-parser'

const XRPLTO_RPC = 'https://api.xrpl.to/v1/testnet/rpc'
const DIRECT_ENDPOINTS = [
  'https://s.altnet.rippletest.net:51234/',
  'https://testnet.honeycluster.io/',
  'https://testnet.xrpl-labs.com/',
]
const OUTPUT_DIR = process.env.XRPLTO_PARITY_OUTPUT_DIR || '.local/xrplto-testnet-parity'
const TIMEOUT_MS = 15_000
const USER_AGENT =
  'xrpl-lending-monitor-xrplto-parity/1.0 (+https://github.com/badjoke-lab/xrpl-lending-monitor)'

interface TimedResponse {
  url: string
  elapsedMs: number
  responseBytes: number
  body: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function postJson(url: string, body: unknown): Promise<TimedResponse> {
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
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const elapsedMs = Number((performance.now() - started).toFixed(3))
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`${url} returned HTTP ${response.status}: ${text.slice(0, 300)}`)
    }

    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed)) throw new Error(`${url} returned a non-object JSON body`)

    return {
      url,
      elapsedMs,
      responseBytes: Buffer.byteLength(text),
      body: parsed,
    }
  } finally {
    clearTimeout(timeout)
  }
}

async function xrplToRpc(
  method: string,
  params: Record<string, unknown> = {},
): Promise<TimedResponse & { result: Record<string, unknown> }> {
  const response = await postJson(XRPLTO_RPC, { method, params })
  if (response.body.success !== true) {
    throw new Error(`XRPL.to ${method}: outer success was not true`)
  }
  if (response.body.method !== method) {
    throw new Error(`XRPL.to ${method}: method echo mismatch`)
  }
  if (!isRecord(response.body.result)) {
    throw new Error(`XRPL.to ${method}: missing result object`)
  }
  if (response.body.result.error) {
    throw new Error(`XRPL.to ${method}: node error ${String(response.body.result.error)}`)
  }
  return { ...response, result: response.body.result }
}

async function directRpc(
  url: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<TimedResponse & { result: Record<string, unknown> }> {
  const response = await postJson(url, {
    method,
    params: [{ ...params, api_version: 2 }],
  })
  if (!isRecord(response.body.result)) {
    throw new Error(`${url} ${method}: missing result object`)
  }
  if (response.body.result.error) {
    throw new Error(`${url} ${method}: node error ${String(response.body.result.error)}`)
  }
  return { ...response, result: response.body.result }
}

function validatedSeq(result: Record<string, unknown>): number {
  const info = result.info
  if (!isRecord(info) || !isRecord(info.validated_ledger)) {
    throw new Error('XRPL.to server_info did not include validated_ledger')
  }
  const seq = Number(info.validated_ledger.seq)
  if (!Number.isSafeInteger(seq) || seq < 10) {
    throw new Error('XRPL.to server_info returned an invalid validated ledger index')
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

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex')
}

function semanticView(read: ReturnType<typeof parseValidatedLedgerResult>) {
  return {
    ledgerIndex: read.ledgerIndex,
    ledgerHash: read.ledgerHash,
    parentHash: read.parentHash,
    closeTime: read.closeTime,
    transactions: read.transactions.map((item) => ({
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
}

async function readDirectLedger(
  ledgerIndex: number,
): Promise<{ response: Awaited<ReturnType<typeof directRpc>>; endpoint: string }> {
  const failures: Array<{ endpoint: string; error: string }> = []

  for (const endpoint of DIRECT_ENDPOINTS) {
    try {
      const response = await directRpc(endpoint, 'ledger', {
        ledger_index: ledgerIndex,
        transactions: true,
        expand: true,
        owner_funds: false,
      })
      return { response, endpoint }
    } catch (error) {
      failures.push({
        endpoint,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new Error(`All direct Testnet endpoints failed: ${JSON.stringify(failures)}`)
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const startedAt = new Date().toISOString()

  const head = await xrplToRpc('server_info')
  const latest = validatedSeq(head.result)
  const targetLedger = latest - 5

  const xrplToLedger = await xrplToRpc('ledger', {
    ledger_index: targetLedger,
    transactions: true,
    expand: true,
    owner_funds: false,
  })

  const { response: directLedger, endpoint: directEndpoint } =
    await readDirectLedger(targetLedger)

  const xrplToParsed = parseValidatedLedgerResult({
    endpoint: XRPLTO_RPC,
    requestedLedgerIndex: targetLedger,
    result: xrplToLedger.result,
  })
  const directParsed = parseValidatedLedgerResult({
    endpoint: directEndpoint,
    requestedLedgerIndex: targetLedger,
    result: directLedger.result,
  })

  const xrplToSemantic = semanticView(xrplToParsed)
  const directSemantic = semanticView(directParsed)
  const xrplToDigest = sha256(xrplToSemantic)
  const directDigest = sha256(directSemantic)

  const txHashListXrplTo = xrplToParsed.transactions.map((item) => item.hash)
  const txHashListDirect = directParsed.transactions.map((item) => item.hash)

  const summary = {
    schemaVersion: 1,
    probe: 'xrplto-testnet-x2-parity',
    startedAt,
    completedAt: new Date().toISOString(),
    targetLedger,
    latestObservedByXrplTo: latest,
    directEndpoint,
    ledgerIdentity: {
      xrplTo: {
        index: xrplToParsed.ledgerIndex,
        hash: xrplToParsed.ledgerHash,
        parentHash: xrplToParsed.parentHash,
        closeTime: xrplToParsed.closeTime,
      },
      direct: {
        index: directParsed.ledgerIndex,
        hash: directParsed.ledgerHash,
        parentHash: directParsed.parentHash,
        closeTime: directParsed.closeTime,
      },
    },
    transactions: {
      xrplToCount: xrplToParsed.transactions.length,
      directCount: directParsed.transactions.length,
      txHashListEqual:
        JSON.stringify(txHashListXrplTo) === JSON.stringify(txHashListDirect),
      xrplToDigest,
      directDigest,
      semanticDigestEqual: xrplToDigest === directDigest,
    },
    transport: {
      xrplToServerInfo: {
        elapsedMs: head.elapsedMs,
        responseBytes: head.responseBytes,
      },
      xrplToLedger: {
        elapsedMs: xrplToLedger.elapsedMs,
        responseBytes: xrplToLedger.responseBytes,
      },
      directLedger: {
        elapsedMs: directLedger.elapsedMs,
        responseBytes: directLedger.responseBytes,
      },
    },
    pass:
      xrplToParsed.ledgerHash === directParsed.ledgerHash &&
      xrplToParsed.parentHash === directParsed.parentHash &&
      xrplToParsed.closeTime === directParsed.closeTime &&
      xrplToDigest === directDigest,
  }

  await writeFile(
    `${OUTPUT_DIR}/xrplto-semantic.json`,
    JSON.stringify(stableValue(xrplToSemantic), null, 2) + '\n',
  )
  await writeFile(
    `${OUTPUT_DIR}/direct-semantic.json`,
    JSON.stringify(stableValue(directSemantic), null, 2) + '\n',
  )
  await writeFile(
    `${OUTPUT_DIR}/summary.json`,
    JSON.stringify(summary, null, 2) + '\n',
  )

  const evidence = [
    '# XRPL.to Testnet X2 parity',
    '',
    `- pass: **${summary.pass ? 'YES' : 'NO'}**`,
    `- target ledger: \`${targetLedger}\``,
    `- direct endpoint: \`${directEndpoint}\``,
    `- ledger hash equal: \`${xrplToParsed.ledgerHash === directParsed.ledgerHash}\``,
    `- parent hash equal: \`${xrplToParsed.parentHash === directParsed.parentHash}\``,
    `- transaction count: \`${xrplToParsed.transactions.length}\``,
    `- transaction hash list equal: \`${summary.transactions.txHashListEqual}\``,
    `- semantic SHA-256 equal: \`${summary.transactions.semanticDigestEqual}\``,
    `- XRPL.to ledger latency: \`${xrplToLedger.elapsedMs} ms\``,
    `- direct ledger latency: \`${directLedger.elapsedMs} ms\``,
    '',
    'Both responses were parsed by the repository canonical parseValidatedLedgerResult implementation.',
    'This proves generic validated-ledger parser parity only; Lending-specific parity remains separately gated.',
    '',
  ].join('\n')

  await writeFile(`${OUTPUT_DIR}/evidence.md`, evidence)
  console.log(JSON.stringify(summary, null, 2))

  if (!summary.pass) process.exitCode = 1
}

main().catch(async (error) => {
  await mkdir(OUTPUT_DIR, { recursive: true })
  const failure = {
    schemaVersion: 1,
    probe: 'xrplto-testnet-x2-parity',
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
