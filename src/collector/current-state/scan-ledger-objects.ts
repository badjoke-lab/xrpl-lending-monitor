import { XrplJsonRpcClient, type FetchLike } from '../network/xrpl-rpc'

export type CurrentObjectFilter = 'vault' | 'loan_broker' | 'loan'
export type CurrentLedgerEntryType = 'Vault' | 'LoanBroker' | 'Loan'

const EXPECTED_ENTRY_TYPE: Record<CurrentObjectFilter, CurrentLedgerEntryType> = {
  vault: 'Vault',
  loan_broker: 'LoanBroker',
  loan: 'Loan',
}

export interface ScannedLedgerObject extends Record<string, unknown> {
  LedgerEntryType: CurrentLedgerEntryType
  index: string
}

interface LedgerDataResult {
  ledger_hash?: unknown
  ledger_index?: unknown
  validated?: unknown
  state?: unknown
  marker?: unknown
}

export interface LedgerObjectScanMetrics {
  pages: number
  requests: number
  objects: number
  elapsedMs: number
}

export interface LedgerObjectScanResult {
  filter: CurrentObjectFilter
  ledgerHash: string
  ledgerIndex: number
  objects: readonly ScannedLedgerObject[]
  metrics: LedgerObjectScanMetrics
}

export class LedgerObjectScanError extends Error {
  readonly filter: CurrentObjectFilter
  readonly pagesCompleted: number
  readonly objectsRead: number
  readonly cause: unknown

  constructor(options: {
    filter: CurrentObjectFilter
    message: string
    pagesCompleted: number
    objectsRead: number
    cause?: unknown
  }) {
    super(options.message)
    this.name = 'LedgerObjectScanError'
    this.filter = options.filter
    this.pagesCompleted = options.pagesCompleted
    this.objectsRead = options.objectsRead
    this.cause = options.cause
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value
}

function requiredLedgerIndex(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) < 0) {
    throw new Error('ledger_index must be a non-negative safe integer')
  }
  return Number(number)
}

function parsePage(options: {
  result: LedgerDataResult
  filter: CurrentObjectFilter
  expectedLedgerHash: string
  expectedLedgerIndex: number
}): { objects: ScannedLedgerObject[]; marker: unknown } {
  const { result, filter, expectedLedgerHash, expectedLedgerIndex } = options
  const ledgerHash = requiredString(result.ledger_hash, 'ledger_hash')
  const ledgerIndex = requiredLedgerIndex(result.ledger_index)

  if (ledgerHash !== expectedLedgerHash || ledgerIndex !== expectedLedgerIndex) {
    throw new Error(
      `ledger_data moved from ${expectedLedgerIndex}:${expectedLedgerHash} to ${ledgerIndex}:${ledgerHash}`,
    )
  }
  if (result.validated !== true) {
    throw new Error('ledger_data response must describe a validated ledger')
  }
  if (!Array.isArray(result.state)) {
    throw new Error('ledger_data response state must be an array')
  }

  const expectedType = EXPECTED_ENTRY_TYPE[filter]
  const objects = result.state.map((value, index) => {
    if (!isRecord(value)) throw new Error(`state[${index}] must be an object`)
    if (value.LedgerEntryType !== expectedType) {
      throw new Error(
        `state[${index}] expected ${expectedType}, received ${String(value.LedgerEntryType)}`,
      )
    }

    return {
      ...value,
      LedgerEntryType: expectedType,
      index: requiredString(value.index, `state[${index}].index`),
    }
  })

  return { objects, marker: result.marker }
}

export async function scanLedgerObjects(options: {
  endpoint: string
  timeoutMs: number
  ledgerHash: string
  ledgerIndex: number
  filter: CurrentObjectFilter
  pageLimit?: number
  requestLimit?: number
  fetcher?: FetchLike
  nowMs?: () => number
}): Promise<LedgerObjectScanResult> {
  const pageLimit = options.pageLimit ?? 200
  const requestLimit = options.requestLimit ?? 200
  if (!Number.isSafeInteger(pageLimit) || pageLimit <= 0) {
    throw new Error('pageLimit must be a positive integer')
  }
  if (!Number.isSafeInteger(requestLimit) || requestLimit <= 0) {
    throw new Error('requestLimit must be a positive integer')
  }

  const nowMs = options.nowMs ?? Date.now
  const startedAt = nowMs()
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
  })
  const objects: ScannedLedgerObject[] = []
  let marker: unknown = undefined
  let pages = 0
  let requests = 0

  try {
    while (true) {
      if (pages >= pageLimit) {
        throw new Error(`ledger_data page limit ${pageLimit} reached before completion`)
      }
      if (requests >= requestLimit) {
        throw new Error(`ledger_data request limit ${requestLimit} reached before completion`)
      }

      const params: Record<string, unknown> = {
        ledger_hash: options.ledgerHash,
        binary: false,
        type: options.filter,
      }
      if (marker !== undefined) params.marker = marker

      requests += 1
      const result = await client.call<LedgerDataResult>('ledger_data', params)
      const page = parsePage({
        result,
        filter: options.filter,
        expectedLedgerHash: options.ledgerHash,
        expectedLedgerIndex: options.ledgerIndex,
      })

      pages += 1
      objects.push(...page.objects)
      marker = page.marker

      if (marker === undefined || marker === null) break
    }
  } catch (error) {
    throw new LedgerObjectScanError({
      filter: options.filter,
      message: `Incomplete ${options.filter} scan: ${error instanceof Error ? error.message : String(error)}`,
      pagesCompleted: pages,
      objectsRead: objects.length,
      cause: error,
    })
  }

  return {
    filter: options.filter,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    objects,
    metrics: {
      pages,
      requests,
      objects: objects.length,
      elapsedMs: Math.max(0, nowMs() - startedAt),
    },
  }
}
