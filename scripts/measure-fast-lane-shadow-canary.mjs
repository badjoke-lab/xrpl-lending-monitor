#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const LENDING_TRANSACTION_TYPES = new Set([
  'VaultCreate',
  'VaultDeposit',
  'VaultWithdraw',
  'VaultSet',
  'VaultClawback',
  'VaultDelete',
  'LoanBrokerSet',
  'LoanBrokerCoverDeposit',
  'LoanBrokerCoverWithdraw',
  'LoanBrokerCoverClawback',
  'LoanBrokerDelete',
  'LoanSet',
  'LoanPay',
  'LoanManage',
  'LoanDelete',
])

const TRACKED_LEDGER_ENTRY_TYPES = new Set(['Vault', 'LoanBroker', 'Loan'])

function parseArgs(argv) {
  const args = {
    endpoint: 'https://devnet.honeycluster.io/',
    startLedger: null,
    maxLedgers: 160,
    readWindow: 4,
    bootstrapLedgers: 90,
    output: 'fast-lane-canary/sample.json',
  }

  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (key === '--endpoint') args.endpoint = value
    else if (key === '--start-ledger') args.startLedger = Number(value)
    else if (key === '--max-ledgers') args.maxLedgers = Number(value)
    else if (key === '--read-window') args.readWindow = Number(value)
    else if (key === '--bootstrap-ledgers') args.bootstrapLedgers = Number(value)
    else if (key === '--output') args.output = value
    else continue
    index += 1
  }

  for (const [name, value] of [
    ['maxLedgers', args.maxLedgers],
    ['readWindow', args.readWindow],
    ['bootstrapLedgers', args.bootstrapLedgers],
  ]) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  }
  if (args.startLedger !== null && (!Number.isSafeInteger(args.startLedger) || args.startLedger < 0)) {
    throw new Error('startLedger must be a non-negative integer')
  }
  if (!args.endpoint || !args.output) throw new Error('endpoint and output are required')
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

function parseHead(result) {
  const ledger = record(result.ledger)
  const index = Number(result.ledger_index ?? ledger?.ledger_index ?? ledger?.seqNum)
  const hash = result.ledger_hash ?? ledger?.ledger_hash ?? ledger?.hash
  if (!Number.isSafeInteger(index) || index < 0) throw new Error('Validated head ledger index is invalid')
  if (typeof hash !== 'string' || !/^[A-F0-9]{64}$/i.test(hash)) throw new Error('Validated head hash is invalid')
  return { ledgerIndex: index, ledgerHash: hash.toUpperCase() }
}

function txBody(entry) {
  const item = record(entry)
  if (!item) return null
  return record(item.tx_json) ?? record(item.tx) ?? item
}

function txMeta(entry) {
  const item = record(entry)
  if (!item) return null
  return record(item.meta) ?? record(item.metaData) ?? record(item.meta_data)
}

function collectAffectedObjects(metadata, destination) {
  const nodes = Array.isArray(metadata?.AffectedNodes) ? metadata.AffectedNodes : []
  for (const wrapper of nodes) {
    const outer = record(wrapper)
    const node = record(outer?.CreatedNode) ?? record(outer?.ModifiedNode) ?? record(outer?.DeletedNode)
    if (!node) continue
    const type = node.LedgerEntryType
    const id = node.LedgerIndex
    if (!TRACKED_LEDGER_ENTRY_TYPES.has(type) || typeof id !== 'string' || id.length === 0) continue
    destination.get(type).add(id.toUpperCase())
  }
}

function parseLedger(result, expectedIndex) {
  const ledger = record(result.ledger)
  if (!ledger) throw new Error(`Ledger ${expectedIndex} response did not include ledger`)
  const ledgerIndex = Number(result.ledger_index ?? ledger.ledger_index ?? ledger.seqNum)
  const ledgerHash = result.ledger_hash ?? ledger.ledger_hash ?? ledger.hash
  const parentHash = ledger.parent_hash ?? ledger.parentHash
  const closeTime = Number(ledger.close_time ?? ledger.closeTime)
  if (ledgerIndex !== expectedIndex) throw new Error(`Requested ledger ${expectedIndex}, received ${ledgerIndex}`)
  if (typeof ledgerHash !== 'string' || typeof parentHash !== 'string') throw new Error(`Ledger ${expectedIndex} hash data is invalid`)
  if (!Number.isSafeInteger(closeTime) || closeTime < 0) throw new Error(`Ledger ${expectedIndex} close time is invalid`)
  const transactions = Array.isArray(ledger.transactions) ? ledger.transactions : []
  return { ledgerIndex, ledgerHash: ledgerHash.toUpperCase(), parentHash: parentHash.toUpperCase(), closeTime, transactions }
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
  const startedAtMs = Date.now()
  const sampledAt = new Date(startedAtMs).toISOString()
  const head = parseHead(await rpc(args.endpoint, 'ledger', {
    ledger_index: 'validated',
    transactions: false,
    expand: false,
  }))

  const requestedStart = args.startLedger ?? Math.max(0, head.ledgerIndex - args.bootstrapLedgers + 1)
  const backlogBefore = Math.max(0, head.ledgerIndex - requestedStart + 1)
  const endLedger = requestedStart > head.ledgerIndex
    ? requestedStart - 1
    : Math.min(head.ledgerIndex, requestedStart + args.maxLedgers - 1)

  const ledgers = []
  for (let cursor = requestedStart; cursor <= endLedger; cursor += args.readWindow) {
    const windowEnd = Math.min(endLedger, cursor + args.readWindow - 1)
    const indexes = Array.from({ length: windowEnd - cursor + 1 }, (_, offset) => cursor + offset)
    const windowLedgers = await Promise.all(indexes.map((ledgerIndex) => readLedger(args.endpoint, ledgerIndex)))
    ledgers.push(...windowLedgers)
  }

  for (let index = 1; index < ledgers.length; index += 1) {
    if (ledgers[index].parentHash !== ledgers[index - 1].ledgerHash) {
      throw new Error(`Ledger chain continuity failed at ${ledgers[index].ledgerIndex}`)
    }
  }

  let inspectedTransactions = 0
  let lendingTransactions = 0
  let successfulLendingTransactions = 0
  const transactionTypes = new Map()
  const affected = new Map([
    ['Vault', new Set()],
    ['LoanBroker', new Set()],
    ['Loan', new Set()],
  ])
  const lendingHashes = new Set()

  for (const ledger of ledgers) {
    inspectedTransactions += ledger.transactions.length
    for (const entry of ledger.transactions) {
      const body = txBody(entry)
      const metadata = txMeta(entry)
      const type = body?.TransactionType
      if (typeof type !== 'string' || !LENDING_TRANSACTION_TYPES.has(type)) continue
      lendingTransactions += 1
      transactionTypes.set(type, (transactionTypes.get(type) ?? 0) + 1)
      const hash = record(entry)?.hash ?? body?.hash
      if (typeof hash === 'string') lendingHashes.add(hash.toUpperCase())
      if (metadata?.TransactionResult === 'tesSUCCESS') {
        successfulLendingTransactions += 1
        collectAffectedObjects(metadata, affected)
      }
    }
  }

  const affectedCounts = {
    vaults: affected.get('Vault').size,
    loanBrokers: affected.get('LoanBroker').size,
    loans: affected.get('Loan').size,
  }
  const affectedObjectsTotal = affectedCounts.vaults + affectedCounts.loanBrokers + affectedCounts.loans
  const lowerBoundWrites = successfulLendingTransactions + affectedObjectsTotal + (ledgers.length > 0 ? 2 : 1)
  const actualEnd = ledgers.at(-1)?.ledgerIndex ?? null
  const completeToHead = actualEnd === head.ledgerIndex || requestedStart > head.ledgerIndex

  const sample = {
    schemaVersion: 1,
    mode: 'read-only-shadow',
    sampledAt,
    source: {
      endpoint: args.endpoint,
      cadenceTargetSeconds: 300,
      requestedStartLedger: requestedStart,
      endLedger: actualEnd,
      latestValidatedLedger: head.ledgerIndex,
      latestValidatedHash: head.ledgerHash,
      backlogBefore,
      completeToHead,
      ledgersRead: ledgers.length,
      readWindow: args.readWindow,
      maxLedgers: args.maxLedgers,
      closeTimeSpanSeconds: ledgers.length > 1 ? ledgers.at(-1).closeTime - ledgers[0].closeTime : 0,
    },
    metrics: {
      inspectedTransactions,
      lendingTransactions,
      uniqueLendingTransactions: lendingHashes.size,
      successfulLendingTransactions,
      transactionTypes: Object.fromEntries([...transactionTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
      affectedObjects: { total: affectedObjectsTotal, ...affectedCounts },
      minimalProjectionWriteLowerBound: lowerBoundWrites,
    },
    timing: {
      elapsedMs: Date.now() - startedAtMs,
    },
  }

  const output = resolve(args.output)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, `${JSON.stringify(sample, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(sample)}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})
