#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const LENDING_TYPES = new Set([
  'VaultCreate','VaultDeposit','VaultWithdraw','VaultSet','VaultClawback','VaultDelete',
  'LoanBrokerSet','LoanBrokerCoverDeposit','LoanBrokerCoverWithdraw','LoanBrokerCoverClawback','LoanBrokerDelete',
  'LoanSet','LoanPay','LoanManage','LoanDelete',
])
const TRACKED_OBJECT_TYPES = new Set(['Vault', 'LoanBroker', 'Loan'])

function parseArgs(argv) {
  const args = {
    endpoint: 'https://devnet.honeycluster.io/',
    lookbackSeconds: 22 * 60 * 60,
    maxLedgers: 27000,
    readWindow: 12,
    output: '/tmp/fast-lane-22h-history.json',
  }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === '--endpoint') args.endpoint = value
    else if (key === '--lookback-seconds') args.lookbackSeconds = Number(value)
    else if (key === '--max-ledgers') args.maxLedgers = Number(value)
    else if (key === '--read-window') args.readWindow = Number(value)
    else if (key === '--output') args.output = value
    else continue
    i += 1
  }
  for (const [name, value] of [
    ['lookbackSeconds', args.lookbackSeconds],
    ['maxLedgers', args.maxLedgers],
    ['readWindow', args.readWindow],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  }
  return args
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

async function rpc(endpoint, method, params) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method, params: [params] }),
  })
  if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`)
  const body = await response.json()
  if (body?.result?.error) throw new Error(`RPC ${method} failed: ${body.result.error_message ?? body.result.error}`)
  if (!body?.result) throw new Error(`RPC ${method} returned no result`)
  return body.result
}

function parseLedger(result, requestedIndex = null) {
  const ledger = record(result.ledger)
  if (!ledger) throw new Error('ledger result missing ledger object')
  const ledgerIndex = Number(result.ledger_index ?? ledger.ledger_index ?? ledger.seqNum)
  const ledgerHash = result.ledger_hash ?? ledger.ledger_hash ?? ledger.hash
  const parentHash = ledger.parent_hash ?? ledger.parentHash
  const closeTime = Number(ledger.close_time ?? ledger.closeTime)
  if (!Number.isSafeInteger(ledgerIndex) || ledgerIndex < 0) throw new Error('invalid ledger index')
  if (requestedIndex !== null && ledgerIndex !== requestedIndex) throw new Error(`requested ${requestedIndex}, received ${ledgerIndex}`)
  if (typeof ledgerHash !== 'string' || typeof parentHash !== 'string') throw new Error(`ledger ${ledgerIndex} hash data invalid`)
  if (!Number.isSafeInteger(closeTime) || closeTime < 0) throw new Error(`ledger ${ledgerIndex} close time invalid`)
  return {
    ledgerIndex,
    ledgerHash: ledgerHash.toUpperCase(),
    parentHash: parentHash.toUpperCase(),
    closeTime,
    transactions: Array.isArray(ledger.transactions) ? ledger.transactions : [],
  }
}

function txBody(entry) {
  const item = record(entry)
  return item ? (record(item.tx_json) ?? record(item.tx) ?? item) : null
}

function txMeta(entry) {
  const item = record(entry)
  return item ? (record(item.meta) ?? record(item.metaData) ?? record(item.meta_data)) : null
}

function affectedObjectKey(node) {
  const type = node?.LedgerEntryType
  const id = node?.LedgerIndex
  if (!TRACKED_OBJECT_TYPES.has(type) || typeof id !== 'string' || id.length === 0) return null
  return `${type}:${id.toUpperCase()}`
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

async function readLedger(endpoint, ledgerIndex) {
  const result = await rpc(endpoint, 'ledger', {
    ledger_index: ledgerIndex,
    transactions: true,
    expand: true,
    owner_funds: false,
  })
  return parseLedger(result, ledgerIndex)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const startedAt = Date.now()
  const headResult = await rpc(args.endpoint, 'ledger', {
    ledger_index: 'validated', transactions: true, expand: true, owner_funds: false,
  })
  const head = parseLedger(headResult)
  const cutoff = head.closeTime - args.lookbackSeconds
  const startLedger = Math.max(0, head.ledgerIndex - args.maxLedgers + 1)

  const bins = new Map()
  let previousHash = null
  let earliestCloseTime = null
  let ledgersRead = 0
  let inspectedTransactions = 0

  for (let cursor = startLedger; cursor <= head.ledgerIndex; cursor += args.readWindow) {
    const windowEnd = Math.min(head.ledgerIndex, cursor + args.readWindow - 1)
    const indexes = Array.from({ length: windowEnd - cursor + 1 }, (_, offset) => cursor + offset)
    const ledgers = await Promise.all(indexes.map((index) => readLedger(args.endpoint, index)))

    for (const ledger of ledgers) {
      if (previousHash && ledger.parentHash !== previousHash) {
        throw new Error(`ledger chain continuity failed at ${ledger.ledgerIndex}`)
      }
      previousHash = ledger.ledgerHash
      ledgersRead += 1
      if (earliestCloseTime === null) earliestCloseTime = ledger.closeTime
      if (ledger.closeTime < cutoff) continue

      const binIndex = Math.min(Math.floor((ledger.closeTime - cutoff) / 300), Math.floor((args.lookbackSeconds - 1) / 300))
      const bin = bins.get(binIndex) ?? {
        index: binIndex,
        startCloseTime: cutoff + binIndex * 300,
        endCloseTimeExclusive: cutoff + (binIndex + 1) * 300,
        ledgers: 0,
        inspectedTransactions: 0,
        lendingTransactions: 0,
        successfulLendingTransactions: 0,
        transactionTypes: {},
        affectedObjects: new Set(),
      }
      bin.ledgers += 1
      bin.inspectedTransactions += ledger.transactions.length
      inspectedTransactions += ledger.transactions.length

      for (const entry of ledger.transactions) {
        const body = txBody(entry)
        const meta = txMeta(entry)
        const type = body?.TransactionType
        if (typeof type !== 'string' || !LENDING_TYPES.has(type)) continue
        bin.lendingTransactions += 1
        bin.transactionTypes[type] = (bin.transactionTypes[type] ?? 0) + 1
        if (meta?.TransactionResult !== 'tesSUCCESS') continue
        bin.successfulLendingTransactions += 1
        const nodes = Array.isArray(meta?.AffectedNodes) ? meta.AffectedNodes : []
        for (const wrapper of nodes) {
          const outer = record(wrapper)
          const node = record(outer?.CreatedNode) ?? record(outer?.ModifiedNode) ?? record(outer?.DeletedNode)
          const key = affectedObjectKey(node)
          if (key) bin.affectedObjects.add(key)
        }
      }
      bins.set(binIndex, bin)
    }
  }

  if (earliestCloseTime === null || earliestCloseTime > cutoff) {
    throw new Error(`maxLedgers=${args.maxLedgers} did not cover the requested lookback`)
  }

  const expectedBins = Math.ceil(args.lookbackSeconds / 300)
  const windows = Array.from({ length: expectedBins }, (_, index) => {
    const bin = bins.get(index) ?? {
      index,
      startCloseTime: cutoff + index * 300,
      endCloseTimeExclusive: cutoff + (index + 1) * 300,
      ledgers: 0,
      inspectedTransactions: 0,
      lendingTransactions: 0,
      successfulLendingTransactions: 0,
      transactionTypes: {},
      affectedObjects: new Set(),
    }
    const affectedObjects = bin.affectedObjects.size
    return {
      index: bin.index,
      startCloseTime: bin.startCloseTime,
      endCloseTimeExclusive: bin.endCloseTimeExclusive,
      ledgers: bin.ledgers,
      inspectedTransactions: bin.inspectedTransactions,
      lendingTransactions: bin.lendingTransactions,
      successfulLendingTransactions: bin.successfulLendingTransactions,
      affectedObjects,
      minimalProjectionWriteLowerBound: bin.successfulLendingTransactions + affectedObjects + 2,
      transactionTypes: bin.transactionTypes,
    }
  })

  const metric = (name) => windows.map((window) => window[name])
  const total = (name) => metric(name).reduce((sum, value) => sum + value, 0)
  const distribution = (name) => ({
    min: Math.min(...metric(name)),
    p50: percentile(metric(name), 50),
    p95: percentile(metric(name), 95),
    p99: percentile(metric(name), 99),
    max: Math.max(...metric(name)),
    average: total(name) / windows.length,
  })

  const result = {
    schemaVersion: 1,
    mode: 'historical-22h-five-minute-replay',
    measuredAt: new Date().toISOString(),
    source: {
      endpoint: args.endpoint,
      headLedger: head.ledgerIndex,
      headHash: head.ledgerHash,
      headCloseTime: head.closeTime,
      cutoffCloseTime: cutoff,
      lookbackSeconds: args.lookbackSeconds,
      startLedger,
      ledgersRead,
      readWindow: args.readWindow,
      elapsedMs: Date.now() - startedAt,
    },
    coverage: {
      fiveMinuteWindows: windows.length,
      expectedWindows: expectedBins,
      complete: windows.length === expectedBins,
    },
    totals: {
      inspectedTransactions,
      lendingTransactions: total('lendingTransactions'),
      successfulLendingTransactions: total('successfulLendingTransactions'),
      affectedObjects: total('affectedObjects'),
      minimalProjectionWriteLowerBound: total('minimalProjectionWriteLowerBound'),
    },
    perFiveMinuteWindow: {
      lendingTransactions: distribution('lendingTransactions'),
      successfulLendingTransactions: distribution('successfulLendingTransactions'),
      affectedObjects: distribution('affectedObjects'),
      minimalProjectionWriteLowerBound: distribution('minimalProjectionWriteLowerBound'),
    },
    projectedDailyWriteLowerBound: total('minimalProjectionWriteLowerBound') * (24 / 22),
    windows,
  }

  const output = resolve(args.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify({
    mode: result.mode,
    fiveMinuteWindows: result.coverage.fiveMinuteWindows,
    ledgersRead: result.source.ledgersRead,
    elapsedMs: result.source.elapsedMs,
    projectedDailyWriteLowerBound: result.projectedDailyWriteLowerBound,
    perFiveMinuteWindow: result.perFiveMinuteWindow,
  })}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
