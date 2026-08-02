import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import { readValidatedLedger } from './read-validated-ledger-rpc'
import type { LedgerReader } from './scan-validated-ledgers'

export interface BoundedLedgerReaderUsage {
  rpcRequests: number
  endpointAttempts: number
  lastSuccessfulEndpoint: string | null
}

export function createBoundedLedgerReader(options: {
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  preferredEndpoint: string | null
  baseReader?: LedgerReader
}): { reader: LedgerReader; usage: BoundedLedgerReaderUsage } {
  const configuredEndpoints = new Set(options.runtimeConfig.xrplRpcUrls)
  const preferredEndpoint = options.preferredEndpoint && configuredEndpoints.has(options.preferredEndpoint)
    ? options.preferredEndpoint
    : null
  const endpoints = [...new Set([
    preferredEndpoint,
    ...options.runtimeConfig.xrplRpcUrls,
  ].filter((value): value is string => Boolean(value)))]
  const baseReader = options.baseReader ?? readValidatedLedger
  const usage: BoundedLedgerReaderUsage = {
    rpcRequests: 0,
    endpointAttempts: 0,
    lastSuccessfulEndpoint: null,
  }

  const reader: LedgerReader = async (request) => {
    let lastError: unknown = new Error('No XRPL endpoint is configured')
    for (const endpoint of endpoints) {
      for (let retry = 0; retry <= options.incrementalConfig.maxRetriesPerEndpoint; retry += 1) {
        if (usage.rpcRequests >= options.incrementalConfig.maxLedgerRpcRequestsPerRun) {
          throw new Error('Incremental RPC request budget exhausted')
        }
        usage.rpcRequests += 1
        usage.endpointAttempts += 1
        try {
          const result = await baseReader({ ...request, endpoint })
          usage.lastSuccessfulEndpoint = endpoint
          return result
        } catch (error) {
          lastError = error
        }
      }
    }
    throw lastError
  }

  return { reader, usage }
}
