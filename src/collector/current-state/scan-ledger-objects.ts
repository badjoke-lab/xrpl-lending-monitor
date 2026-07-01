import { decode } from '@xrpl-commons/ripple-binary-codec'

import { XrplJsonRpcClient, type FetchLike } from '../network/xrpl-rpc'

export type CurrentObjectFilter = 'vault' | 'loan_broker' | 'loan'
export type CurrentLedgerEntryType = 'Vault' | 'LoanBroker' | 'Loan'
export type LedgerObjectDecoder = (binaryHex: string) => Record<string, unknown>

const EXPECTED_ENTRY_TYPE: Record<CurrentObjectFilter, CurrentLedgerEntryType> = {
  vault: 'Vault',
  loan_broker: 'LoanBroker',
  loan: 'Loan',
}

export interface ScannedLedgerObject extends Record<string, unknown> {
  LedgerEntryType: CurrentLedgerEntryType
  index: string
  BinaryHex: string
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
  requestedObjectsPerPage: number
  responseMode: 'binary'
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
  readonly lastMarker: unknown
  readonly cause: unknown

  constructor(options: {
    filter: CurrentObjectFilter
    message: string
    pagesCompleted: number
    objectsRead: number
    lastMarker?: unknown
    cause?: unknown
  }) {
    super(options.message)
    this.name = 'LedgerObjectScanError'
    this.filter = options.filter
    this.pagesCompleted = options.pagesCompleted
    this.objectsRead = options.objectsRead
    this.lastMarker = options.lastMarker
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

function requiredHex(value: unknown, field: string): string {
  const hex = requiredString(value, field)
  if (hex.length % 2 !== 0 || !/^[A-Fa-f0-9]+$/.test(hex)) {
    throw new Error(`${field} must be an even-length hexadecimal string`)
  }
  return hex.toUpperCase()
}

function requiredLedgerIndex(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) < 0) {
    throw new Error('ledger_index must be a non-negative safe integer')
  }
  return Number(number)
}

function markerFingerprint(marker: unknown): string {
  if (typeof marker === 'string') return `string:${marker}`
  if (typeof marker === 'number') return `number:${marker}`
  if (typeof marker === 'boolean') return `boolean:${marker}`

  try {
    return `json:${JSON.stringify(marker)}`
  } catch {
    throw new Error('ledger_data marker could not be serialized for repetition detection')
  }
}

function defaultDecoder(binaryHex: string): Record<string, unknown> {
  const decoded = decode(binaryHex)
  if (!isRecord(decoded)) throw new Error('Binary ledger object did not decode to an object')
  return decoded
}

function parsePage(options: {
  result: LedgerDataResult
  filter: CurrentObjectFilter
  expectedLedgerHash: string
  expectedLedgerIndex: number
  decodeObject: LedgerObjectDecoder
}): { objects: ScannedLedgerObject[]; marker: unknown } {
  const { result, filter, expectedLedgerHash, expectedLedgerIndex, decodeObject } = options
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
    const binaryHex = requiredHex(value.data, `state[${index}].data`)
    const decoded = decodeObject(binaryHex)
    if (!isRecord(decoded)) throw new Error(`state[${index}] did not decode to an object`)
    if (decoded.LedgerEntryType !== expectedType) {
      throw new Error(
        `state[${index}] expected ${expectedType}, received ${String(decoded.LedgerEntryType)}`,
      )
    }

    return {
      ...decoded,
      LedgerEntryType: expectedType,
      index: requiredString(value.index, `state[${index}].index`),
      BinaryHex: binaryHex,
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
  objectLimitPerPage?: number
  fetcher?: FetchLike
  nowMs?: () => number
  decodeObject?: LedgerObjectDecoder
}): Promise<LedgerObjectScanResult> {
  const pageLimit = options.pageLimit ?? 200
  const requestLimit = options.requestLimit ?? 200
  const objectLimitPerPage = options.objectLimitPerPage ?? 2_048
  if (!Number.isSafeInteger(pageLimit) || pageLimit <= 0) {
    throw new Error('pageLimit must be a positive integer')
  }
  if (!Number.isSafeInteger(requestLimit) || requestLimit <= 0) {
    throw new Error('requestLimit must be a positive integer')
  }
  if (!Number.isSafeInteger(objectLimitPerPage) || objectLimitPerPage <= 0) {
    throw new Error('objectLimitPerPage must be a positive integer')
  }

  const nowMs = options.nowMs ?? Date.now
  const startedAt = nowMs()
  const client = new XrplJsonRpcClient({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    fetcher: options.fetcher,
  })
  const decodeObject = options.decodeObject ?? defaultDecoder
  const objects: ScannedLedgerObject[] = []
  const seenMarkers = new Set<string>()
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
        binary: true,
        type: options.filter,
        limit: objectLimitPerPage,
      }
      if (marker !== undefined) params.marker = marker

      requests += 1
      const result = await client.call<LedgerDataResult>('ledger_data', params)
      const page = parsePage({
        result,
        filter: options.filter,
        expectedLedgerHash: options.ledgerHash,
        expectedLedgerIndex: options.ledgerIndex,
        decodeObject,
      })

      pages += 1
      objects.push(...page.objects)
      marker = page.marker

      if (marker === undefined || marker === null) break
      const fingerprint = markerFingerprint(marker)
      if (seenMarkers.has(fingerprint)) {
        throw new Error(`ledger_data repeated marker after page ${pages}`)
      }
      seenMarkers.add(fingerprint)
    }
  } catch (error) {
    throw new LedgerObjectScanError({
      filter: options.filter,
      message: `Incomplete ${options.filter} scan: ${error instanceof Error ? error.message : String(error)}`,
      pagesCompleted: pages,
      objectsRead: objects.length,
      lastMarker: marker,
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
      requestedObjectsPerPage: objectLimitPerPage,
      responseMode: 'binary',
    },
  }
}
