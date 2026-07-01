import type { RuntimeConfig } from '../../shared/runtime-config'
import { getSyncState } from '../../worker/repositories/network-status-repository'
import {
  activateCurrentSnapshot,
  beginCurrentSnapshot,
  failCurrentSnapshot,
  writeCurrentSnapshot,
  type CurrentSnapshotIdentity,
} from '../../worker/repositories/current-state-repository'
import type { FetchLike } from '../network/xrpl-rpc'
import { normalizeCurrentState } from './normalize-current-state'
import { scanCurrentState, type CurrentStateScanResult } from './scan-current-state'

export interface CurrentStateCollectionResult {
  snapshot: CurrentSnapshotIdentity
  scan: CurrentStateScanResult
  counts: { vaults: number; loanBrokers: number; loans: number }
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    return { code: error.name || 'collection_failed', message: error.message }
  }
  return { code: 'collection_failed', message: String(error) }
}

export async function collectCurrentState(options: {
  db: D1Database
  config: RuntimeConfig
  fetcher?: FetchLike
  now?: () => Date
  nowMs?: () => number
  idFactory?: () => string
  pageLimitPerType?: number
  requestLimitTotal?: number
  objectLimitPerPage?: number
  writeBatchSize?: number
}): Promise<CurrentStateCollectionResult> {
  const state = await getSyncState(options.db)
  if (!state?.epochId) throw new Error('Current-state collection requires an active epoch')
  if (state.status === 'reset_suspected') {
    throw new Error('Current-state collection is blocked while a reset is suspected')
  }
  if (state.latestObservedLedger === null || !state.latestObservedHash) {
    throw new Error('Current-state collection requires a validated ledger observation')
  }

  const endpoint = state.endpoint ?? options.config.xrplRpcUrls[0]
  if (!endpoint) throw new Error('Current-state collection requires an XRPL endpoint')

  const now = options.now ?? (() => new Date())
  const startedAt = now().toISOString()
  const snapshot: CurrentSnapshotIdentity = {
    id: options.idFactory?.() ?? crypto.randomUUID(),
    network: 'devnet',
    epochId: state.epochId,
    ledgerIndex: state.latestObservedLedger,
    ledgerHash: state.latestObservedHash,
    endpoint,
    startedAt,
  }

  await beginCurrentSnapshot(options.db, snapshot)

  try {
    const scan = await scanCurrentState({
      endpoint,
      timeoutMs: options.config.rpcTimeoutMs,
      ledgerHash: snapshot.ledgerHash,
      ledgerIndex: snapshot.ledgerIndex,
      pageLimitPerType: options.pageLimitPerType,
      requestLimitTotal: options.requestLimitTotal,
      objectLimitPerPage: options.objectLimitPerPage,
      fetcher: options.fetcher,
      nowMs: options.nowMs,
    })
    const normalized = normalizeCurrentState(scan)

    await writeCurrentSnapshot({
      db: options.db,
      snapshot,
      state: normalized,
      batchSize: options.writeBatchSize,
    })
    await activateCurrentSnapshot({
      db: options.db,
      snapshot,
      metrics: scan.metrics,
      completedAt: now().toISOString(),
    })

    return {
      snapshot,
      scan,
      counts: {
        vaults: normalized.vaults.length,
        loanBrokers: normalized.loanBrokers.length,
        loans: normalized.loans.length,
      },
    }
  } catch (error) {
    const failure = errorDetails(error)
    await failCurrentSnapshot({
      db: options.db,
      snapshotId: snapshot.id,
      failedAt: now().toISOString(),
      code: failure.code,
      message: failure.message,
    })
    throw error
  }
}
