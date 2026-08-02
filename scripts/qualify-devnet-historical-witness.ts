import { mkdirSync, writeFileSync } from 'node:fs'

import { buildPortableXrplNormalizedWork } from '../src/collector/history-segments/portable-xrpl-normalization.ts'
import { isLendingTransactionType } from '../src/collector/incremental/lending-transaction-types.ts'
import type { IncrementalScanResult } from '../src/collector/incremental/scan-validated-ledgers.ts'
import {
  parseValidatedLedgerResult,
  type ValidatedLedgerRead,
} from '../src/collector/incremental/validated-ledger-parser.ts'

const DEFAULT_ENDPOINT = 'https://s.devnet.rippletest.net:51234/'
const OUTPUT_DIRECTORY = 'devnet-historical-witness-evidence'
const OUTPUT_PATH = `${OUTPUT_DIRECTORY}/historical-witness.json`
const FAILURE_PATH = `${OUTPUT_DIRECTORY}/failed-historical-witness.json`
const AUDIT_GENERATED_AT = '2026-06-30T16:38:10.748Z'
const AUDIT_WINDOW_START = 3_269_937
const AUDIT_WINDOW_END = 3_270_064
const EXACT_KNOWN_LEDGER_INDEXES = [63_189, 1_801_434, 2_776_760, 2_980_845, 3_127_240]
const REQUEST_TIMEOUT_MILLISECONDS = 15_000
const REQUEST_ATTEMPTS = 2
const CONCURRENCY = 6

const semanticClasses = [
  'validated-ledger',
  'protocol-event',
  'object-change',
  'loan-lifecycle',
  'archived-object',
  'balance-history',
  'current-projection',
] as const

type SemanticClass = (typeof semanticClasses)[number]
type JsonRecord = Record<string, unknown>

type LedgerWitness = {
  ledgerIndex: number
  ledgerHash: string
  parentHash: string
  closeTime: number
  lendingTransactions: Array<{
    hash: string
    transactionType: string
    result: string
    transactionIndex: number
  }>
  semanticCounts: Record<SemanticClass, number>
  canonicalKeys: Record<SemanticClass, string[]>
  relationshipIds: string[]
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readLedger(endpoint: string, ledgerIndex: number): Promise<ValidatedLedgerRead> {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          method: 'ledger',
          params: [
            {
              ledger_index: ledgerIndex,
              transactions: true,
              expand: true,
              owner_funds: false,
            },
          ],
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json()
      if (!isRecord(payload) || !isRecord(payload.result)) {
        throw new Error('XRPL response did not contain a result object')
      }
      const rpcError = payload.result.error
      if (typeof rpcError === 'string' && rpcError.length > 0) {
        const message = typeof payload.result.error_message === 'string'
          ? payload.result.error_message
          : rpcError
        throw new Error(`${rpcError}: ${message}`)
      }
      return parseValidatedLedgerResult({
        endpoint,
        requestedLedgerIndex: ledgerIndex,
        result: payload.result,
      })
    } catch (error) {
      lastError = error
      if (attempt < REQUEST_ATTEMPTS) await sleep(250 * attempt)
    }
  }
  throw new Error(`ledger ${ledgerIndex}: ${errorMessage(lastError)}`)
}

function singleLedgerScan(ledger: ValidatedLedgerRead): IncrementalScanResult {
  const lendingTransactions = ledger.transactions.filter((transaction) =>
    isLendingTransactionType(transaction.transactionType),
  )
  return {
    endpoint: ledger.endpoint,
    startLedgerIndex: ledger.ledgerIndex,
    endLedgerIndex: ledger.ledgerIndex,
    latestValidatedLedger: ledger.ledgerIndex,
    completeToLatest: true,
    ledgers: [{ ...ledger, lendingTransactions }],
    metrics: {
      ledgers: 1,
      inspectedTransactions: ledger.transactions.length,
      lendingTransactions: lendingTransactions.length,
      elapsedMs: 0,
    },
  }
}

function emptyClassMap<T>(factory: () => T): Record<SemanticClass, T> {
  return Object.fromEntries(semanticClasses.map((semanticClass) => [semanticClass, factory()])) as Record<
    SemanticClass,
    T
  >
}

async function buildWitness(ledger: ValidatedLedgerRead): Promise<LedgerWitness | null> {
  const scan = singleLedgerScan(ledger)
  if (scan.metrics.lendingTransactions === 0) return null

  const work = await buildPortableXrplNormalizedWork({
    scan,
    workId: `historical-witness:${ledger.ledgerIndex}:${ledger.ledgerHash}`,
    network: 'devnet',
    epochId: 'supabase-r4c2c-historical-witness-v1',
    baseIdentity: `historical-witness-${AUDIT_WINDOW_END}`,
    previousLedgerIndex: Math.max(0, ledger.ledgerIndex - 1),
    expectedParentHash: ledger.parentHash,
  })

  const counts = emptyClassMap(() => 0)
  const keys = emptyClassMap<string[]>(() => [])
  const relationships = new Set<string>()
  for (const chunk of work.chunks) {
    for (const record of chunk.chunk.records) {
      counts[record.semanticClass] += 1
      keys[record.semanticClass].push(record.canonicalKey)
      for (const relationshipId of record.relationshipIds) relationships.add(relationshipId)
    }
  }
  for (const semanticClass of semanticClasses) keys[semanticClass].sort()

  return {
    ledgerIndex: ledger.ledgerIndex,
    ledgerHash: ledger.ledgerHash,
    parentHash: ledger.parentHash,
    closeTime: ledger.closeTime,
    lendingTransactions: scan.ledgers[0]!.lendingTransactions.map((transaction) => ({
      hash: transaction.hash,
      transactionType: transaction.transactionType,
      result: transaction.result,
      transactionIndex: transaction.transactionIndex,
    })),
    semanticCounts: counts,
    canonicalKeys: keys,
    relationshipIds: [...relationships].sort(),
  }
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length)
  let cursor = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor
      cursor += 1
      if (index >= values.length) return
      results[index] = await mapper(values[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()))
  return results
}

async function main(): Promise<void> {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true })
  const endpoint = process.env.XRPL_DEVNET_RPC_URL?.trim() || DEFAULT_ENDPOINT
  const auditWindow = Array.from(
    { length: AUDIT_WINDOW_END - AUDIT_WINDOW_START + 1 },
    (_, offset) => AUDIT_WINDOW_START + offset,
  )
  const ledgerIndexes = [...new Set([...EXACT_KNOWN_LEDGER_INDEXES, ...auditWindow])].sort(
    (left, right) => left - right,
  )

  const failures: Array<{ ledgerIndex: number; error: string }> = []
  const witnesses = (
    await mapConcurrent(ledgerIndexes, CONCURRENCY, async (ledgerIndex) => {
      try {
        return await buildWitness(await readLedger(endpoint, ledgerIndex))
      } catch (error) {
        failures.push({ ledgerIndex, error: errorMessage(error).slice(0, 500) })
        return null
      }
    })
  ).filter((witness): witness is LedgerWitness => witness !== null)
  witnesses.sort((left, right) => left.ledgerIndex - right.ledgerIndex)
  failures.sort((left, right) => left.ledgerIndex - right.ledgerIndex)

  const totalCounts = emptyClassMap(() => 0)
  for (const witness of witnesses) {
    for (const semanticClass of semanticClasses) {
      totalCounts[semanticClass] += witness.semanticCounts[semanticClass]
    }
  }
  const requiredNonLedgerClasses = semanticClasses.filter(
    (semanticClass) => semanticClass !== 'validated-ledger',
  )
  const missingNonLedgerClasses = requiredNonLedgerClasses.filter(
    (semanticClass) => totalCounts[semanticClass] === 0,
  )

  const evidence = {
    schemaVersion: 1,
    purpose: 'r4c2c-read-only-historical-witness-discovery',
    generatedAt: new Date().toISOString(),
    endpoint,
    mutation: 'none',
    inputs: {
      sourceAuditGeneratedAt: AUDIT_GENERATED_AT,
      exactKnownLedgerIndexes: EXACT_KNOWN_LEDGER_INDEXES,
      auditWindow: { start: AUDIT_WINDOW_START, end: AUDIT_WINDOW_END },
      requestedLedgerCount: ledgerIndexes.length,
      concurrency: CONCURRENCY,
      requestAttempts: REQUEST_ATTEMPTS,
      requestTimeoutMilliseconds: REQUEST_TIMEOUT_MILLISECONDS,
    },
    result: {
      readableLedgerCount: ledgerIndexes.length - failures.length,
      failedLedgerCount: failures.length,
      lendingWitnessLedgerCount: witnesses.length,
      semanticCounts: totalCounts,
      missingNonLedgerClasses,
      completeSixClassWitness: missingNonLedgerClasses.length === 0,
    },
    witnesses,
    failures,
  }
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`)
  console.log(JSON.stringify(evidence.result))

  if (ledgerIndexes.length === failures.length) {
    throw new Error('No requested historical Devnet ledger was readable')
  }
}

main().catch((error) => {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true })
  const failure = {
    schemaVersion: 1,
    purpose: 'r4c2c-read-only-historical-witness-discovery',
    failedAt: new Date().toISOString(),
    reason: errorMessage(error).slice(0, 1_000),
    mutation: 'none',
  }
  writeFileSync(FAILURE_PATH, `${JSON.stringify(failure, null, 2)}\n`)
  console.error(failure.reason)
  process.exitCode = 1
})
