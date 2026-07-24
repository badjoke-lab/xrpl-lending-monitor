import { readValidatedLedger } from './read-validated-ledger'
import type { LedgerReader } from './scan-validated-ledgers'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createFastLaneResilientLedgerReader(options: {
  primary: LedgerReader
  fallbackEndpoints: readonly string[]
  fallbackReader?: LedgerReader
}): LedgerReader {
  const fallbackReader = options.fallbackReader ?? readValidatedLedger
  const endpoints = [...new Set(options.fallbackEndpoints)]

  return async (request) => {
    try {
      return await options.primary(request)
    } catch (primaryError) {
      const failures = [`primary=${errorMessage(primaryError)}`]
      for (const endpoint of endpoints) {
        try {
          return await fallbackReader({ ...request, endpoint })
        } catch (fallbackError) {
          failures.push(`${endpoint}=${errorMessage(fallbackError)}`)
        }
      }
      throw new Error(
        `Fast-lane ledger ${request.ledgerIndex} failed on WebSocket and all HTTP fallbacks: ${failures.join('; ')}`,
      )
    }
  }
}
