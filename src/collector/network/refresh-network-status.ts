import {
  planFailedStatus,
  planSuccessfulStatus,
  type StoredSyncState,
} from '../../domain/network/status'
import type { RuntimeConfig } from '../../shared/runtime-config'
import {
  getSyncState,
  saveFailedStatus,
  saveSuccessfulStatus,
} from '../../worker/repositories/network-status-repository'
import { readNetworkSnapshot, NetworkSnapshotError } from './read-network-snapshot'
import type { FetchLike } from './xrpl-rpc'

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof NetworkSnapshotError) {
    const summary = error.failures
      .map((failure) => (
        `${failure.endpoint} ${failure.method}: ${failure.code} (${failure.message})`
      ))
      .join('; ')

    return {
      code: 'all_endpoints_failed',
      message: summary || error.message,
    }
  }

  return {
    code: 'network_status_refresh_failed',
    message: error instanceof Error ? error.message : String(error),
  }
}

export async function refreshNetworkStatus(options: {
  db: D1Database
  config: RuntimeConfig
  fetcher?: FetchLike
  now?: () => Date
}): Promise<StoredSyncState> {
  const now = options.now ?? (() => new Date())
  const previous = await getSyncState(options.db)

  try {
    const snapshot = await readNetworkSnapshot({
      endpoints: options.config.xrplRpcUrls,
      timeoutMs: options.config.rpcTimeoutMs,
      fetcher: options.fetcher,
      now,
    })
    const plan = planSuccessfulStatus({
      previous,
      snapshot,
      staleAfterSeconds: options.config.staleAfterSeconds,
    })

    await saveSuccessfulStatus(options.db, plan)
    return plan.state
  } catch (error) {
    const failure = errorDetails(error)
    const failedState = planFailedStatus({
      previous,
      attemptedAt: now().toISOString(),
      code: failure.code,
      message: failure.message,
    })

    await saveFailedStatus(options.db, failedState)
    throw error
  }
}
