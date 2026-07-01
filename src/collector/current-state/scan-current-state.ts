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

export interface CurrentStatePage {
  pageNumber: number
  markerBefore: unknown
  markerAfter: unknown
  firstLedgerIndex: string | null
  lastLedgerIndex: string | null
  decodedObjects: number
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
}

export interface CurrentStateBatchResult {
  endpoint: string
  ledgerHash: string
  ledgerIndex: number
  complete: boolean
  nextMarker: unknown
  metrics: CurrentStateScanMetrics
}

export interface CurrentStateScanResult extends CurrentStateBatchResult {
  complete: true
  nextMarker: null
  vaults: readonly ScannedLedgerObject[]
  loanBrokers: readonly ScannedLedgerObject[]
  loans: readonly ScannedLedgerObject[]
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

function addPageMetrics(metrics: CurrentStateScanMetrics, page: CurrentStatePage): void {
  metrics.pages += 1
  metrics.requests += 1
  metrics.decodedObjects += page.decodedObjects
  metrics.byType.vault.objects += page.vaults.length
  metrics.byType.loan_broker.objects += page.loanBrokers.length
  metrics.byType.loan.objects += page.loans.length
  metrics.objects += page.vaults.length + page.loanBrokers.length + page.loans.length
}

export async function scanCurrentStateBatch(options: {
  endpoint: string
  timeoutMs: number
  ledgerHash: string
  ledgerIndex: number
  startMarker?: unknown
  maxPages?: number
  objectLimitPerPage?: number
  fetcher?: FetchLike
  nowMs?: () => number
  decodeObject?: LedgerObjectDecoder
  onPage: (page: CurrentStatePage) => Promise<void> | void
}): Promise<CurrentStateBatchResult> {
  const maxPages = options.maxPages ?? 25
  const objectLimitPerPage = options.objectLimitPerPage ?? 2_048
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error('maxPages must be a positive integer')
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
  const seenMarkers = new Set<string>()
  let marker: unknown = options.startMarker
  const metrics: CurrentStateScanMetrics = {
    pages: 0,
    requests: 0,
    decodedObjects: 0,
    objects: 0,
    elapsedMs: 0,
    requestedObjectsPerPage: objectLimitPerPage,
    responseMode: 'binary',
    byType: {
      vault: { objects: 0 },
      loan_broker: { objects: 0 },
      loan: { objects: 0 },
    },
  }

  if (marker !== undefined && marker !== null) {
    seenMarkers.add(markerFingerprint(marker))
  }

  try {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const markerBefore = marker
      const params: Record<string, unknown> = {
        ledger_hash: options.ledgerHash,
        binary: true,
        limit: objectLimitPerPage,
      }
      if (markerBefore !== undefined && markerBefore !== null) params.marker = markerBefore

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

      const vaults: ScannedLedgerObject[] = []
      const loanBrokers: ScannedLedgerObject[] = []
      const loans: ScannedLedgerObject[] = []
      let firstLedgerIndex: string | null = null
      let lastLedgerIndex: string | null = null

      for (let index = 0; index < result.state.length; index += 1) {
        const value = result.state[index]
        if (!isRecord(value)) throw new Error(`state[${index}] must be an object`)
        const ledgerObjectIndex = requiredString(value.index, `state[${index}].index`)
        firstLedgerIndex ??= ledgerObjectIndex
        lastLedgerIndex = ledgerObjectIndex
        const binaryHex = requiredHex(value.data, `state[${index}].data`)
        const decoded = decodeObject(binaryHex)
        if (!isRecord(decoded)) throw new Error(`state[${index}] did not decode to an object`)

        const entryType = decoded.LedgerEntryType
        if (entryType !== 'Vault' && entryType !== 'LoanBroker' && entryType !== 'Loan') {
          continue
        }

        const object: ScannedLedgerObject = {
          ...decoded,
          LedgerEntryType: entryType,
          index: ledgerObjectIndex,
          BinaryHex: binaryHex,
        }
        const filter = FILTER_BY_ENTRY_TYPE[entryType]
        if (filter === 'vault') vaults.push(object)
        else if (filter === 'loan_broker') loanBrokers.push(object)
        else loans.push(object)
      }

      ensureUniqueIds('vault', vaults)
      ensureUniqueIds('loan_broker', loanBrokers)
      ensureUniqueIds('loan', loans)

      marker = result.marker
      const page: CurrentStatePage = {
        pageNumber,
        markerBefore,
        markerAfter: marker,
        firstLedgerIndex,
        lastLedgerIndex,
        decodedObjects: result.state.length,
        vaults,
        loanBrokers,
        loans,
      }
      await options.onPage(page)
      addPageMetrics(metrics, page)

      if (marker === undefined || marker === null) {
        metrics.elapsedMs = Math.max(0, nowMs() - startedAt)
        return {
          endpoint: options.endpoint,
          ledgerHash: options.ledgerHash,
          ledgerIndex: options.ledgerIndex,
          complete: true,
          nextMarker: null,
          metrics,
        }
      }

      const fingerprint = markerFingerprint(marker)
      if (seenMarkers.has(fingerprint)) {
        throw new Error(`ledger_data repeated marker after page ${metrics.pages}`)
      }
      seenMarkers.add(fingerprint)
    }
  } catch (error) {
    throw new CurrentStateScanError({
      message: `Incomplete current-state batch: ${error instanceof Error ? error.message : String(error)}`,
      pagesCompleted: metrics.pages,
      requestsCompleted: metrics.requests + 1,
      decodedObjects: metrics.decodedObjects,
      relevantObjects: metrics.objects,
      lastMarker: marker,
      cause: error,
    })
  }

  metrics.elapsedMs = Math.max(0, nowMs() - startedAt)
  return {
    endpoint: options.endpoint,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    complete: false,
    nextMarker: marker,
    metrics,
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
  const vaults: ScannedLedgerObject[] = []
  const loanBrokers: ScannedLedgerObject[] = []
  const loans: ScannedLedgerObject[] = []
  const maxPages = Math.min(
    options.pageLimitPerType ?? 200,
    options.requestLimitTotal ?? 600,
  )

  const batch = await scanCurrentStateBatch({
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    maxPages,
    objectLimitPerPage: options.objectLimitPerPage,
    fetcher: options.fetcher,
    nowMs: options.nowMs,
    decodeObject: options.decodeObject,
    onPage(page) {
      vaults.push(...page.vaults)
      loanBrokers.push(...page.loanBrokers)
      loans.push(...page.loans)
    },
  })

  if (!batch.complete) {
    throw new CurrentStateScanError({
      message: `Incomplete current-state scan: page limit ${maxPages} reached before completion`,
      pagesCompleted: batch.metrics.pages,
      requestsCompleted: batch.metrics.requests,
      decodedObjects: batch.metrics.decodedObjects,
      relevantObjects: batch.metrics.objects,
      lastMarker: batch.nextMarker,
    })
  }

  ensureUniqueIds('vault', vaults)
  ensureUniqueIds('loan_broker', loanBrokers)
  ensureUniqueIds('loan', loans)

  return {
    ...batch,
    complete: true,
    nextMarker: null,
    vaults,
    loanBrokers,
    loans,
  }
}
