import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import type { IncrementalCollectorState } from '../../worker/repositories/incremental-collector-state'
import { createBoundedLedgerReader } from './bounded-ledger-reader'
import type { CollectorScopeRow } from './collector-scope'
import {
  runPreparedIncrementalRange,
  type RunnableCursor,
} from './run-prepared-range'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import { createXrplWebSocketLedgerSession } from './xrpl-websocket-ledger-session'

interface BoundedPreparedIncrementalRangeOptions {
  db: D1Database
  cursor: RunnableCursor
  scope: CollectorScopeRow
  previous: IncrementalCollectorState | null
  attemptedAt: string
  startedAtMs: number
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  now?: () => Date
}

async function runHttpPreparedIncrementalRange(options: BoundedPreparedIncrementalRangeOptions) {
  const bounded = createBoundedLedgerReader({
    runtimeConfig: options.runtimeConfig,
    incrementalConfig: options.incrementalConfig,
    preferredEndpoint: options.cursor.endpoint,
  })

  const result = await runPreparedIncrementalRange({
    ...options,
    scan: (scanOptions) => scanValidatedLedgerRange({
      ...scanOptions,
      reader: bounded.reader,
    }),
  })

  return {
    ...result,
    state: {
      ...result.state,
      endpoint: bounded.usage.lastSuccessfulEndpoint ?? result.state.endpoint,
      lastRpcRequests: bounded.usage.rpcRequests,
      lastEndpointAttempts: bounded.usage.endpointAttempts,
    },
  }
}

async function runWebSocketPreparedIncrementalRange(options: BoundedPreparedIncrementalRangeOptions) {
  const endpoint = options.incrementalConfig.webSocketEndpoint
  if (!endpoint) throw new Error('WebSocket incremental transport requires an endpoint')

  const session = createXrplWebSocketLedgerSession({ endpoint })
  try {
    const result = await runPreparedIncrementalRange({
      ...options,
      scan: (scanOptions) => scanValidatedLedgerRange({
        ...scanOptions,
        endpoint,
        reader: session.reader,
        readWindowSize: options.incrementalConfig.webSocketReadWindow,
      }),
    })

    return {
      ...result,
      state: {
        ...result.state,
        endpoint,
        lastRpcRequests: session.usage.logicalMessages,
        lastEndpointAttempts: session.usage.connections,
      },
    }
  } finally {
    session.close()
  }
}

export async function runBoundedPreparedIncrementalRange(
  options: BoundedPreparedIncrementalRangeOptions,
) {
  if (options.incrementalConfig.ledgerTransport === 'websocket') {
    return runWebSocketPreparedIncrementalRange(options)
  }
  return runHttpPreparedIncrementalRange(options)
}
