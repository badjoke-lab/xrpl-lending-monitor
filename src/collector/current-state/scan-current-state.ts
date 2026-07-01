import type { FetchLike } from '../network/xrpl-rpc'
import {
  scanLedgerObjects,
  type CurrentObjectFilter,
  type LedgerObjectScanResult,
} from './scan-ledger-objects'

const FILTERS: readonly CurrentObjectFilter[] = ['vault', 'loan_broker', 'loan']

export interface CurrentStateScanMetrics {
  pages: number
  requests: number
  objects: number
  elapsedMs: number
  byType: Record<CurrentObjectFilter, LedgerObjectScanResult['metrics']>
}

export interface CurrentStateScanResult {
  endpoint: string
  ledgerHash: string
  ledgerIndex: number
  vaults: LedgerObjectScanResult['objects']
  loanBrokers: LedgerObjectScanResult['objects']
  loans: LedgerObjectScanResult['objects']
  metrics: CurrentStateScanMetrics
}

function ensureUniqueIds(result: LedgerObjectScanResult): void {
  const seen = new Set<string>()
  for (const object of result.objects) {
    if (seen.has(object.index)) {
      throw new Error(`Duplicate ${result.filter} object ${object.index}`)
    }
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
}): Promise<CurrentStateScanResult> {
  const requestLimitTotal = options.requestLimitTotal ?? 600
  if (!Number.isSafeInteger(requestLimitTotal) || requestLimitTotal < FILTERS.length) {
    throw new Error(`requestLimitTotal must be at least ${FILTERS.length}`)
  }

  const nowMs = options.nowMs ?? Date.now
  const startedAt = nowMs()
  const results = new Map<CurrentObjectFilter, LedgerObjectScanResult>()
  let requestsUsed = 0

  for (const filter of FILTERS) {
    const remainingRequests = requestLimitTotal - requestsUsed
    if (remainingRequests <= 0) {
      throw new Error('Current-state request limit reached before all object types completed')
    }

    const result = await scanLedgerObjects({
      endpoint: options.endpoint,
      timeoutMs: options.timeoutMs,
      ledgerHash: options.ledgerHash,
      ledgerIndex: options.ledgerIndex,
      filter,
      pageLimit: options.pageLimitPerType,
      requestLimit: remainingRequests,
      objectLimitPerPage: options.objectLimitPerPage,
      fetcher: options.fetcher,
      nowMs,
    })
    ensureUniqueIds(result)
    results.set(filter, result)
    requestsUsed += result.metrics.requests
  }

  const vaults = results.get('vault')
  const loanBrokers = results.get('loan_broker')
  const loans = results.get('loan')
  if (!vaults || !loanBrokers || !loans) {
    throw new Error('Current-state scan finished without all required object types')
  }

  return {
    endpoint: options.endpoint,
    ledgerHash: options.ledgerHash,
    ledgerIndex: options.ledgerIndex,
    vaults: vaults.objects,
    loanBrokers: loanBrokers.objects,
    loans: loans.objects,
    metrics: {
      pages: vaults.metrics.pages + loanBrokers.metrics.pages + loans.metrics.pages,
      requests: requestsUsed,
      objects: vaults.metrics.objects + loanBrokers.metrics.objects + loans.metrics.objects,
      elapsedMs: Math.max(0, nowMs() - startedAt),
      byType: {
        vault: vaults.metrics,
        loan_broker: loanBrokers.metrics,
        loan: loans.metrics,
      },
    },
  }
}
