#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import process from 'node:process'

const BASE_URL = 'https://api.xrpl.to/v1/testnet'
const OUTPUT_DIR = process.env.XRPLTO_PROBE_OUTPUT_DIR || '.local/xrplto-testnet-probe'
const REQUEST_TIMEOUT_MS = 15_000
const REQUEST_SPACING_MS = 650

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hex64(value) {
  return typeof value === 'string' && /^[A-Fa-f0-9]{64}$/.test(value)
}

function responseHeaders(headers) {
  const wanted = [
    'content-type',
    'retry-after',
    'x-ratelimit-limit',
    'x-ratelimit-remaining',
    'x-ratelimit-reset',
    'x-ratelimit-daily-remaining',
    'x-credits-used',
    'x-credits-remaining',
  ]
  const out = {}
  for (const key of wanted) {
    const value = headers.get(key)
    if (value !== null) out[key] = value
  }
  return out
}

async function fetchJson({ name, url, init }) {
  await sleep(REQUEST_SPACING_MS)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  const started = performance.now()

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(init?.headers || {}),
      },
    })
    const elapsedMs = Number((performance.now() - started).toFixed(3))
    const text = await response.text()
    let body
    try {
      body = JSON.parse(text)
    } catch {
      throw new Error(`${name}: invalid JSON response (HTTP ${response.status})`)
    }

    const record = {
      name,
      url,
      httpStatus: response.status,
      ok: response.ok,
      elapsedMs,
      responseBytes: Buffer.byteLength(text),
      headers: responseHeaders(response.headers),
      body,
    }

    await writeFile(
      `${OUTPUT_DIR}/raw-${name}.json`,
      JSON.stringify(record, null, 2) + '\n',
    )

    if (!response.ok) {
      throw new Error(`${name}: HTTP ${response.status}`)
    }

    return record
  } finally {
    clearTimeout(timeout)
  }
}

async function rpc(name, method, params = {}) {
  const record = await fetchJson({
    name,
    url: `${BASE_URL}/rpc`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params }),
    },
  })

  if (!isRecord(record.body)) {
    throw new Error(`${name}: outer response is not an object`)
  }
  if (record.body.success !== true) {
    throw new Error(`${name}: outer success is not true`)
  }
  if (record.body.method !== method) {
    throw new Error(
      `${name}: outer method mismatch (expected ${method}, got ${String(record.body.method)})`,
    )
  }
  if (!isRecord(record.body.result)) {
    throw new Error(`${name}: missing node result object`)
  }

  return record
}

function findVaultCandidate(value, seen = new Set()) {
  if (!isRecord(value) && !Array.isArray(value)) return null
  if (seen.has(value)) return null
  seen.add(value)

  if (isRecord(value)) {
    if (value.LedgerEntryType === 'Vault' && hex64(value.index)) {
      return { vaultId: value.index, source: 'LedgerEntryType/index', object: value }
    }
    if (value.LedgerEntryType === 'Vault' && hex64(value.LedgerIndex)) {
      return { vaultId: value.LedgerIndex, source: 'LedgerEntryType/LedgerIndex', object: value }
    }
    for (const [key, child] of Object.entries(value)) {
      if (/vault/i.test(key) && isRecord(child)) {
        if (hex64(child.index)) {
          return { vaultId: child.index, source: `${key}.index`, object: child }
        }
        if (hex64(child.LedgerIndex)) {
          return {
            vaultId: child.LedgerIndex,
            source: `${key}.LedgerIndex`,
            object: child,
          }
        }
      }
    }
    for (const child of Object.values(value)) {
      const found = findVaultCandidate(child, seen)
      if (found) return found
    }
  } else {
    for (const child of value) {
      const found = findVaultCandidate(child, seen)
      if (found) return found
    }
  }

  return null
}

function validatedLedgerFromServerInfo(result) {
  const info = result.info
  if (!isRecord(info) || !isRecord(info.validated_ledger)) {
    throw new Error('server_info: missing info.validated_ledger')
  }

  const seq = Number(info.validated_ledger.seq)
  const hash = info.validated_ledger.hash
  if (!Number.isSafeInteger(seq) || seq <= 0 || !hex64(hash)) {
    throw new Error('server_info: invalid validated ledger identity')
  }

  return { index: seq, hash }
}

function ledgerSummary(result, expected) {
  if (result.error) {
    throw new Error(`ledger: node returned ${String(result.error)}`)
  }
  if (!isRecord(result.ledger)) {
    throw new Error('ledger: missing ledger object')
  }

  const ledger = result.ledger
  const index = Number(ledger.ledger_index ?? result.ledger_index)
  const hash = ledger.ledger_hash ?? result.ledger_hash
  const parentHash = ledger.parent_hash
  const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : []

  if (index !== expected.index) {
    throw new Error(`ledger: index mismatch ${index} != ${expected.index}`)
  }
  if (hash !== expected.hash) {
    throw new Error(`ledger: hash mismatch ${String(hash)} != ${expected.hash}`)
  }
  if (!hex64(parentHash)) {
    throw new Error('ledger: invalid parent hash')
  }

  const expandedCount = transactions.filter((tx) => isRecord(tx)).length
  const stringHashCount = transactions.filter((tx) => typeof tx === 'string').length

  return {
    index,
    hash,
    parentHash,
    validated: result.validated ?? ledger.validated ?? null,
    transactionCount: transactions.length,
    expandedTransactionCount: expandedCount,
    transactionHashOnlyCount: stringHashCount,
    firstTransactionKeys:
      expandedCount > 0
        ? Object.keys(transactions.find((tx) => isRecord(tx))).sort()
        : [],
  }
}

function ledgerDataSummary(result) {
  if (result.error) {
    throw new Error(`ledger_data: node returned ${String(result.error)}`)
  }
  if (!Array.isArray(result.state)) {
    throw new Error('ledger_data: missing state array')
  }
  return {
    ledgerIndex: Number(result.ledger_index),
    ledgerHash: result.ledger_hash ?? null,
    stateCount: result.state.length,
    markerPresent: result.marker !== undefined && result.marker !== null,
    markerType:
      result.marker === undefined || result.marker === null
        ? null
        : Array.isArray(result.marker)
          ? 'array'
          : typeof result.marker,
    marker: result.marker ?? null,
  }
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true })

  const startedAt = new Date().toISOString()
  const requests = []

  const fixtures = await fetchJson({
    name: 'fixtures',
    url: `${BASE_URL}/fixtures`,
  })
  requests.push(fixtures)

  const health = await fetchJson({
    name: 'health',
    url: `${BASE_URL}/health`,
  })
  requests.push(health)

  const serverInfo = await rpc('server-info', 'server_info')
  requests.push(serverInfo)
  const validatedLedger = validatedLedgerFromServerInfo(serverInfo.body.result)

  const feature = await rpc('feature', 'feature')
  requests.push(feature)
  if (feature.body.result.error) {
    throw new Error(`feature: node returned ${String(feature.body.result.error)}`)
  }

  const ledger = await rpc('ledger-expanded', 'ledger', {
    ledger_index: validatedLedger.index,
    transactions: true,
    expand: true,
    binary: false,
  })
  requests.push(ledger)
  const expandedLedger = ledgerSummary(ledger.body.result, validatedLedger)

  const ledgerData1 = await rpc('ledger-data-page-1', 'ledger_data', {
    ledger_index: validatedLedger.index,
    binary: false,
    limit: 64,
  })
  requests.push(ledgerData1)
  const ledgerDataPage1 = ledgerDataSummary(ledgerData1.body.result)

  let ledgerDataPage2 = null
  if (ledgerData1.body.result.marker !== undefined) {
    const second = await rpc('ledger-data-page-2', 'ledger_data', {
      ledger_index: validatedLedger.index,
      binary: false,
      limit: 64,
      marker: ledgerData1.body.result.marker,
    })
    requests.push(second)
    ledgerDataPage2 = ledgerDataSummary(second.body.result)
  }

  const vaultCandidate = findVaultCandidate(fixtures.body)
  let vaultInfo = {
    attempted: false,
    status: 'fixture-not-found',
    vaultId: null,
    source: null,
  }

  if (vaultCandidate) {
    const vault = await rpc('vault-info', 'vault_info', {
      vault_id: vaultCandidate.vaultId,
      ledger_index: 'validated',
    })
    requests.push(vault)
    vaultInfo = {
      attempted: true,
      status: vault.body.result.error ? 'node-error' : 'success',
      nodeError: vault.body.result.error ?? null,
      vaultId: vaultCandidate.vaultId,
      source: vaultCandidate.source,
      validated: vault.body.result.validated ?? null,
      ledgerIndex: vault.body.result.ledger_index ?? null,
      returnedVaultIndex: vault.body.result.vault?.index ?? null,
    }
  }

  const fixturesCatalogue = Array.isArray(fixtures.body?.catalogue)
    ? fixtures.body.catalogue
    : []

  const lendingKinds = fixturesCatalogue
    .filter((entry) => isRecord(entry) && typeof entry.kind === 'string')
    .map((entry) => entry.kind)
    .filter((kind) => /Vault|LoanBroker|Loan(Set|Pay|Manage|Delete)?/i.test(kind))

  const summary = {
    schemaVersion: 1,
    probe: 'xrplto-testnet-x1',
    startedAt,
    completedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    auth: 'none',
    validatedLedger,
    outerEnvelope: {
      successBoolean: true,
      methodEcho: true,
      nodeResultObject: true,
    },
    expandedLedger,
    ledgerData: {
      page1: ledgerDataPage1,
      page2: ledgerDataPage2,
      paginationObserved: ledgerDataPage1.markerPresent,
    },
    fixtures: {
      success: fixtures.body?.success === true,
      generatedAt: fixtures.body?.generated_at ?? null,
      ageSeconds: fixtures.body?.age_seconds ?? null,
      population: fixtures.body?.population ?? null,
      catalogueCount: fixturesCatalogue.length,
      lendingKinds,
      vaultFixtureFound: vaultCandidate !== null,
    },
    health: {
      success: health.body?.success === true,
      topLevelKeys: isRecord(health.body) ? Object.keys(health.body).sort() : [],
    },
    feature: {
      topLevelResultKeys: Object.keys(feature.body.result).sort(),
    },
    vaultInfo,
    requests: requests.map((request) => ({
      name: request.name,
      httpStatus: request.httpStatus,
      elapsedMs: request.elapsedMs,
      responseBytes: request.responseBytes,
      headers: request.headers,
    })),
    pass:
      fixtures.body?.success === true &&
      health.body?.success === true &&
      expandedLedger.index === validatedLedger.index &&
      expandedLedger.hash === validatedLedger.hash &&
      expandedLedger.transactionHashOnlyCount === 0 &&
      ledgerDataPage1.ledgerIndex === validatedLedger.index,
  }

  await writeFile(
    `${OUTPUT_DIR}/summary.json`,
    JSON.stringify(summary, null, 2) + '\n',
  )

  const evidence = [
    '# XRPL.to Testnet X1 probe',
    '',
    `- pass: **${summary.pass ? 'YES' : 'NO'}**`,
    `- validated ledger: \`${validatedLedger.index}\``,
    `- validated hash: \`${validatedLedger.hash}\``,
    `- expanded ledger transactions: \`${expandedLedger.transactionCount}\``,
    `- expanded objects: \`${expandedLedger.expandedTransactionCount}\``,
    `- hash-only transactions: \`${expandedLedger.transactionHashOnlyCount}\``,
    `- ledger_data page 1 rows: \`${ledgerDataPage1.stateCount}\``,
    `- ledger_data marker observed: \`${ledgerDataPage1.markerPresent}\``,
    `- second page rows: \`${ledgerDataPage2?.stateCount ?? 'not-run'}\``,
    `- fixture catalogue entries: \`${fixturesCatalogue.length}\``,
    `- fixture lending kinds: \`${lendingKinds.join(', ') || 'none observed'}\``,
    `- vault fixture: \`${vaultInfo.status}\``,
    '',
    'This is a non-canonical compatibility probe. It does not modify the active Devnet runtime.',
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
    probe: 'xrplto-testnet-x1',
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
