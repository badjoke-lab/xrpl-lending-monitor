import { decode } from '@xrpl-commons/ripple-binary-codec'

import type { FetchLike } from '../network/xrpl-rpc'
import { XrplJsonRpcClient } from '../network/xrpl-rpc'
import type {
  CurrentLedgerEntryType,
  CurrentObjectFilter,
  LedgerObjectDecoder,
  ScannedLedgerObject,
} from './scan-ledger-objects'

const FILTER_BY_ENTRY_TYPE: Partial<Record<CurrentLedgerEntryType, CurrentObjectFilter>> = {
  Vault: 'vault',
  LoanBroker: 'loan_broker',
  Loan: 'loan',
}

interface LedgerDataResult {
  ledger_hash?: unknown
  ledger_index?: unknown
  validated?: unknown
  state?: unknown
  marker?: unknown
}

export interface CurrentStateTypeMetrics {
  objects: number
}

export interface CurrentStateScanMetrics {
  pages: number
  requests: number
  decodedObjects: number
  objects: number
  elapsedMs: number
  requestedObjectsPerPage: number
  responseMode: 'binary'
  byType: Record<CurrentObjectFilter, CurrentStateTypeMetrics>
}

export interface CurrentStateScanResult {
  endpoint: string
  ledgerHash: string
  ledgerIndex: number
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
  metrics: CurrentStateScanMetrics
}

export class CurrentStateScanError extends Error {
  readonly pagesCompleted: number
  readonly requestsCompleted: number
  readonly decodedObjects: number
  readonly relevantObjects: number
  readonly lastMarker: unknown
  readonly cause: unknown

  constructor(options: {
    message: string
    pagesCompleted: number
    requestsCompleted: number
    decodedObjects: number
    relevantObjects: number
    lastMarker?: unknown
    cause?: unknown
  }) {
    super(options.message)
    this.name = 'CurrentStateScanError'
    this.pagesCompleted = options.pagesCompleted
    this.requestsCompleted = options.requestsCompleted
    this.decodedObjects = options.decodedObjects
    this.relevantObjects = options.relevantObjects
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
  return `json:${JSON.stringify(marker)}`
}

function defaultDecoder(binaryHex: string): Record<string, unknown> {
  const decoded = decode(binaryHex)
  if (!isRecord(decoded)) throw new Error('Binary ledger object did not decode to an object')
  return decoded
}

function ensureUniqueIds(filter: CurrentObjectFilter, objects: readonly ScannedLedgerObject[]): void {
  const seen = new Set<string>()
  for (const object of objects) {
    if (seen.has(object.index)) throw new Error(`Duplicate ${filter} object ${object.index}`)
    seen.add(object.index)
  }
}

export async function scanCurrentState(options: {
  endpoint: string
  timeoutMs: number
  ledgerHash: string
  ledgerIndex: number
  pageLimitPerType?: number
  requestLimitTotal?: number
  objectLimitPerPage?: number
  fetcher?: FetchLike
  nowMs?: () => number
  decodeObject?: LedgerObjectDecoder
}): Promise<CurrentStateScanResult> {
  const pageLimit = options.pageLimitPerType ?? 200
  const requestLimit = options.requestLimitTotal ?? 600
  const objectLimitPerPage = options.objectLimitPerPage ?? 2_048
  if (!Number.isSafeInteger(pageLimit) || pageLimit <= 0) {
    throw new Error('pageLimitPerType must be a positive integer')
  }
  if (!Number.isSafeInteger(requestLimit) || requestLimit <= 0) {
    throw new Error('requestLimitTotal must be a positive integer')
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
  const vaults: ScannedLedgerObject[] = []
  const loanBrokers: ScannedLedgerObject[] = []
  const loans: ScannedLedgerObject[] = []
  const seenMarkers = new Set<string>()
  let marker: unknown = undefined
  let pages = 0
  let requests = 0
  let decodedObjects = 0

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
        limit: objectLimitPerPage,
      }
      if (marker !== undefined) params.marker = marker

      requests += 1
      const result = await client.call<LedgerDataResult>('ledger_data', params)
      const ledgerHash = requiredString(result.ledger_hash, 'ledger_hash')
      const ledgerIndex = requiredLedgerIndex(result.ledger_index)
      if (ledgerHash !== options.ledgerHash || ledgerIndex !== options.ledgerIndex) {
        throw new Error(
          `ledger_data moved from ${options.ledgerIndex}:${options.ledgerHash} to ${ledgerIndex}:${ledgerHash}`,
        )
      }
      if (result.validated !== true) {
        throw new Error('ledger_data response must describe a validated ledger')
      }
      if (!Array.isArray(result.state)) {
        throw new Error('ledger_data response state must be an array')
      }

      for (let index = 0; index < result.state.length; index += 1) {
        const value = result.state[index]
        if (!isRecord(value)) throw new Error(`state[${index}] must be an object`)
        const binaryHex = requiredHex(value.data, `state[${index}].data`)
        const decoded = decodeObject(binaryHex)
        if (!isRecord(decoded)) throw new Error(`state[${index}] did not decode to an object`)
        decodedObjects += 1

        const entryType = decoded.LedgerEntryType
        if (entryType !== 'Vault' && entryType !== 'LoanBroker' && entryType !== 'Loan') {
          continue
        }

        const object: ScannedLedgerObject = {
          ...decoded,
          LedgerEntryType: entryType,
          index: requiredString(value.index, `state[${index}].index`),
          BinaryHex: binaryHex,
        }
        const filter = FILTER_BY_ENTRY_TYPE[entryType]
        if (filter === 'vault') vaults.push(object)
        else if (filter === 'loan_broker') loanBrokers.push(object)
        else loans.push(object)
      }

      pages += 1
      marker = result.marker
      if (marker === undefined || marker === null) break
      const fingerprint = markerFingerprint(marker)
      if (seenMarkers.has(fingerprint)) {
        throw new Error(`ledger_data repeated marker after page ${pages}`)
      }
      seenMarkers.add(fingerprint)
    }

    ensureUniqueIds('vault', vaults)
    ensureUniqueIds('loan_broker', loanBrokers)
    ensureUniqueIds('loan', loans)
  } catch (error) {
    throw new CurrentStateScanError({
      message: `Incomplete current-state scan: ${error instanceof Error ? error.message : String(error)}`,
      pagesCompleted: pages,
      requestsCompleted: requests,
      decodedObjects,
      relevantObjects: vaults.length + loanBrokers.length + loans.length,
      lastMarker: marker,
      cause: error,
    })
  }

  return {
    endpoint: options.endpoint,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    vaults,
    loanBrokers,
    loans,
    metrics: {
      pages,
      requests,
      decodedObjects,
      objects: vaults.length + loanBrokers.length + loans.length,
      elapsedMs: Math.max(0, nowMs() - startedAt),
      requestedObjectsPerPage: objectLimitPerPage,
      responseMode: 'binary',
      byType: {
        vault: { objects: vaults.length },
        loan_broker: { objects: loanBrokers.length },
        loan: { objects: loans.length },
      },
    },
  }
}
