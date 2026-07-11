import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { canonicalJson } from '../src/shared/current-state/canonical-json'
import {
  normalizeLoan,
  normalizeLoanBroker,
  normalizeVault,
  type CurrentProjectionLedgerObject,
} from '../src/collector/current-state/normalize-current-objects'

interface Arguments {
  endpoint: string
  input: string
  output: string
  concurrency: number
}

interface SampleRow {
  last_processed_ledger: number
  last_processed_hash: string
  object_type: 'vault' | 'loan_broker' | 'loan'
  object_id: string
  operation: 'upsert' | 'deleted'
  projection_json: string | null
}

interface WranglerQueryEnvelope {
  results?: SampleRow[]
  success?: boolean
}

interface LedgerEntryResult {
  ledger_index?: number | string
  ledger_hash?: string
  node?: Record<string, unknown>
  error?: string
  error_message?: string
}

interface JsonRpcResponse {
  result?: LedgerEntryResult
  error?: unknown
}

interface VerificationRow {
  objectType: SampleRow['object_type']
  objectId: string
  operation: SampleRow['operation']
  status:
    | 'matched'
    | 'semantic_matched_raw_diff'
    | 'deleted_matched'
    | 'mismatch'
    | 'unexpected_present'
    | 'rpc_error'
  message: string | null
  mismatchPaths?: string[]
}

function argumentValue(args: string[], name: string): string | null {
  const index = args.indexOf(name)
  if (index < 0) return null
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  return value
}

function positiveInteger(value: string | null, fallback: number, field: string): number {
  if (value === null) return fallback
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 32) {
    throw new Error(`${field} must be an integer from 1 to 32`)
  }
  return parsed
}

function parseArguments(args: string[]): Arguments {
  return {
    endpoint: argumentValue(args, '--endpoint') ?? 'https://devnet.honeycluster.io/',
    input: resolve(argumentValue(args, '--input') ?? '/tmp/fast-lane-ledger-sample.json'),
    output: resolve(argumentValue(args, '--output') ?? '/tmp/fast-lane-ledger-diff-summary.json'),
    concurrency: positiveInteger(argumentValue(args, '--concurrency'), 8, 'concurrency'),
  }
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(parsed) || Number(parsed) < 0) throw new Error(`${field} is invalid`)
  return Number(parsed)
}

function normalizeProjection(row: SampleRow, node: Record<string, unknown>): string {
  const object: CurrentProjectionLedgerObject = {
    ...node,
    index: row.object_id,
    LedgerEntryType: row.object_type === 'loan_broker'
      ? 'LoanBroker'
      : row.object_type === 'loan'
        ? 'Loan'
        : 'Vault',
  }
  if (row.object_type === 'vault') return canonicalJson(normalizeVault(object))
  if (row.object_type === 'loan_broker') return canonicalJson(normalizeLoanBroker(object))
  return canonicalJson(normalizeLoan(object))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mismatchPaths(left: unknown, right: unknown, prefix = '', output: string[] = []): string[] {
  if (output.length >= 30) return output
  if (Object.is(left, right)) return output

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || canonicalJson(left) !== canonicalJson(right)) {
      output.push(prefix || '$')
    }
    return output
  }

  if (isRecord(left) && isRecord(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      mismatchPaths(left[key], right[key], prefix ? `${prefix}.${key}` : key, output)
      if (output.length >= 30) break
    }
    return output
  }

  output.push(prefix || '$')
  return output
}

function withoutRaw(value: unknown): unknown {
  if (!isRecord(value)) return value
  const copy: Record<string, unknown> = { ...value }
  delete copy.raw
  return copy
}

function isEntryNotFound(result: LedgerEntryResult | undefined): boolean {
  const code = result?.error ?? ''
  const message = result?.error_message ?? ''
  return code === 'entryNotFound' || /entry not found/i.test(message)
}

async function readLedgerEntry(options: {
  endpoint: string
  row: SampleRow
}): Promise<LedgerEntryResult> {
  const response = await fetch(options.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      method: 'ledger_entry',
      params: [{
        index: options.row.object_id,
        ledger_index: options.row.last_processed_ledger,
        binary: false,
      }],
    }),
  })
  if (!response.ok) throw new Error(`ledger_entry HTTP ${response.status}`)
  const body = await response.json() as JsonRpcResponse
  if (body.error !== undefined) throw new Error(`ledger_entry JSON-RPC error: ${String(body.error)}`)
  if (!body.result) throw new Error('ledger_entry response missing result')
  return body.result
}

async function verifyOne(endpoint: string, row: SampleRow): Promise<VerificationRow> {
  let result: LedgerEntryResult
  try {
    result = await readLedgerEntry({ endpoint, row })
  } catch (error) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'rpc_error',
      message: error instanceof Error ? error.message : String(error),
    }
  }

  if (row.operation === 'deleted') {
    if (isEntryNotFound(result)) {
      return {
        objectType: row.object_type,
        objectId: row.object_id,
        operation: row.operation,
        status: 'deleted_matched',
        message: null,
      }
    }
    if (result.node) {
      return {
        objectType: row.object_type,
        objectId: row.object_id,
        operation: row.operation,
        status: 'unexpected_present',
        message: 'Fast-lane tombstone exists but ledger_entry returned a node at the same head',
      }
    }
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'rpc_error',
      message: `Unexpected delete lookup response: ${result.error ?? 'unknown'}`,
    }
  }

  if (isEntryNotFound(result)) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'mismatch',
      message: 'Fast-lane upsert exists but ledger_entry returned entryNotFound',
    }
  }
  if (!result.node) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'rpc_error',
      message: 'ledger_entry response missing node',
    }
  }

  const responseLedgerIndex = integer(result.ledger_index, 'ledger_entry ledger_index')
  if (responseLedgerIndex !== row.last_processed_ledger) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'mismatch',
      message: `ledger_entry index mismatch: ${responseLedgerIndex}`,
    }
  }
  if (
    typeof result.ledger_hash === 'string'
    && result.ledger_hash.toUpperCase() !== row.last_processed_hash.toUpperCase()
  ) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'mismatch',
      message: 'ledger_entry hash mismatch',
    }
  }

  try {
    const observed = normalizeProjection(row, result.node)
    if (observed === row.projection_json) {
      return {
        objectType: row.object_type,
        objectId: row.object_id,
        operation: row.operation,
        status: 'matched',
        message: null,
      }
    }

    const expectedValue = JSON.parse(row.projection_json ?? 'null') as unknown
    const observedValue = JSON.parse(observed) as unknown
    const paths = mismatchPaths(expectedValue, observedValue)
    if (canonicalJson(withoutRaw(expectedValue)) === canonicalJson(withoutRaw(observedValue))) {
      return {
        objectType: row.object_type,
        objectId: row.object_id,
        operation: row.operation,
        status: 'semantic_matched_raw_diff',
        message: 'Semantic projection matches exact ledger state; only raw metadata fields differ',
        mismatchPaths: paths,
      }
    }

    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'mismatch',
      message: 'Semantic projection differs from exact ledger_entry normalization',
      mismatchPaths: paths,
    }
  } catch (error) {
    return {
      objectType: row.object_type,
      objectId: row.object_id,
      operation: row.operation,
      status: 'mismatch',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function mapConcurrent<T, U>(items: T[], concurrency: number, mapper: (item: T) => Promise<U>): Promise<U[]> {
  const output = new Array<U>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      output[index] = await mapper(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return output
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2))
  const raw = JSON.parse(await readFile(args.input, 'utf8')) as WranglerQueryEnvelope[]
  const rows = raw[0]?.results ?? []
  if (rows.length === 0) throw new Error('Fast-lane ledger diff sample is empty')
  if (raw[0]?.success !== true) throw new Error('Fast-lane ledger diff D1 query was not successful')

  const headLedger = rows[0]!.last_processed_ledger
  const headHash = rows[0]!.last_processed_hash
  for (const row of rows) {
    if (row.last_processed_ledger !== headLedger || row.last_processed_hash !== headHash) {
      throw new Error('Fast-lane sample contains mixed head identities')
    }
    if (row.operation === 'upsert' && row.projection_json === null) {
      throw new Error(`Fast-lane upsert ${row.object_id} has null projection_json`)
    }
  }

  const evidence = await mapConcurrent(rows, args.concurrency, (row) => verifyOne(args.endpoint, row))
  const counts = evidence.reduce<Record<string, number>>((total, item) => {
    total[item.status] = (total[item.status] ?? 0) + 1
    return total
  }, {})
  const failures = evidence.filter((item) => (
    item.status !== 'matched'
    && item.status !== 'semantic_matched_raw_diff'
    && item.status !== 'deleted_matched'
  ))
  const rawDifferences = evidence.filter((item) => item.status === 'semantic_matched_raw_diff')
  const summary = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'fast-lane-exact-ledger-entry-diff',
    passed: failures.length === 0,
    endpoint: args.endpoint,
    head: {
      ledgerIndex: headLedger,
      ledgerHash: headHash,
    },
    sampleSize: rows.length,
    counts,
    rawDifferences,
    failures,
  }

  await writeFile(args.output, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  if (!summary.passed) process.exitCode = 1
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
