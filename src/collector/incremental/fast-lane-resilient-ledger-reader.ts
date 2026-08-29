import { readValidatedLedger } from './read-validated-ledger-rpc'
import type { LedgerReader } from './scan-validated-ledgers'

export const FAST_LANE_HTTP_FALLBACK_REQUEST_LIMIT = 16

export class FastLaneHttpFallbackBudgetError extends Error {
  readonly limit: number
  readonly attemptedLedgerIndex: number

  constructor(limit: number, attemptedLedgerIndex: number) {
    super(
      `Fast-lane HTTP fallback budget exhausted before ledger ${attemptedLedgerIndex}: limit=${limit}`,
    )
    this.name = 'FastLaneHttpFallbackBudgetError'
    this.limit = limit
    this.attemptedLedgerIndex = attemptedLedgerIndex
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createFastLaneResilientLedgerReader(options: {
  primary: LedgerReader
  fallbackEndpoints: readonly string[]
  fallbackReader?: LedgerReader
  maxFallbackRequests?: number
}): LedgerReader {
  const fallbackReader = options.fallbackReader ?? readValidatedLedger
  const endpoints = [...new Set(options.fallbackEndpoints)]
  const maxFallbackRequests = options.maxFallbackRequests ?? FAST_LANE_HTTP_FALLBACK_REQUEST_LIMIT
  if (!Number.isSafeInteger(maxFallbackRequests) || maxFallbackRequests < 0) {
    throw new Error('Fast-lane HTTP fallback request budget is invalid')
  }
  let fallbackRequests = 0

  return async (request) => {
    try {
      return await options.primary(request)
    } catch (primaryError) {
      const failures = [`primary=${errorMessage(primaryError)}`]
      for (const endpoint of endpoints) {
        if (fallbackRequests >= maxFallbackRequests) {
          throw new FastLaneHttpFallbackBudgetError(maxFallbackRequests, request.ledgerIndex)
        }
        fallbackRequests += 1
        try {
          return await fallbackReader({ ...request, endpoint })
        } catch (fallbackError) {
          failures.push(`${endpoint}=${errorMessage(fallbackError)}`)
        }
      }
      throw new Error(
        `Fast-lane ledger ${request.ledgerIndex} failed on WebSocket and all HTTP fallbacks: ${failures.join('; ')}`,
        { cause: primaryError },
      )
    }
  }
}