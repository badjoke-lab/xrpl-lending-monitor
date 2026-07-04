import { createBoundedLedgerReader } from './bounded-ledger-reader'
import {
  runPreparedIncrementalRange,
  type RunnableCursor,
} from './run-prepared-range'
import { scanValidatedLedgerRange } from './scan-validated-ledgers'
import type { IncrementalRuntimeConfig } from '../../shared/incremental-runtime-config'
import type { RuntimeConfig } from '../../shared/runtime-config'
import type { IncrementalCollectorState } from '../../worker/repositories/incremental-collector-state'
import type { CollectorScopeRow } from './collector-scope'

export async function runBoundedPreparedIncrementalRange(options: {
  db: D1Database
  cursor: RunnableCursor
  scope: CollectorScopeRow
  previous: IncrementalCollectorState | null
  attemptedAt: string
  startedAtMs: number
  runtimeConfig: RuntimeConfig
  incrementalConfig: IncrementalRuntimeConfig
  now?: () => Date
}) {
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
