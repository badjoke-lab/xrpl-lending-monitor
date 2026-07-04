import type { StoredSyncState } from '../../domain/network/status'
import type {
  IncrementalCollectorState,
} from '../../worker/repositories/incremental-collector-state'
import { buildCollectorRunState } from './collector-run-record'
import type { CollectorScopeRow } from './collector-scope'

export type CollectorPreflight =
  | { kind: 'stop'; status: 'awaiting_initialization' | 'caught_up' | 'reset_suspected'; lagLedgers: number | null; state: IncrementalCollectorState }
  | { kind: 'run'; lagLedgers: number; scope: CollectorScopeRow }

export function planCollectorPreflight(options: {
  sync: StoredSyncState | null
  scope: CollectorScopeRow | null
  previous: IncrementalCollectorState | null
  now: string
  durationMs: number
}): CollectorPreflight {
  const { sync, scope, previous, now, durationMs } = options

  if (!sync?.epochId || sync.lastProcessedLedger === null || !sync.lastProcessedHash) {
    return {
      kind: 'stop',
      status: 'awaiting_initialization',
      lagLedgers: null,
      state: buildCollectorRunState({
        previous,
        status: 'awaiting_initialization',
        now,
        lag: null,
        endpoint: sync?.endpoint ?? null,
        durationMs,
      }),
    }
  }

  if (sync.status === 'reset_suspected') {
    return {
      kind: 'stop',
      status: 'reset_suspected',
      lagLedgers: null,
      state: buildCollectorRunState({
        previous,
        status: 'reset_suspected',
        now,
        lag: null,
        endpoint: sync.endpoint,
        durationMs,
      }),
    }
  }

  if (sync.status === 'error' || sync.latestObservedLedger === null || !sync.latestObservedHash) {
    throw new Error('Network status is unavailable for incremental collection')
  }

  const lag = Math.max(0, sync.latestObservedLedger - sync.lastProcessedLedger)

  if (!scope) {
    return {
      kind: 'stop',
      status: 'awaiting_initialization',
      lagLedgers: lag,
      state: buildCollectorRunState({
        previous,
        status: 'awaiting_initialization',
        now,
        lag,
        endpoint: sync.endpoint,
        durationMs,
      }),
    }
  }

  if (
    scope.overlay_ledger_index !== sync.lastProcessedLedger
    || scope.overlay_ledger_hash !== sync.lastProcessedHash
  ) {
    throw new Error('Overlay watermark does not match the incremental cursor')
  }
  if (sync.latestObservedLedger < sync.lastProcessedLedger) {
    throw new Error('Observed validated ledger is behind the incremental cursor')
  }

  if (sync.latestObservedLedger === sync.lastProcessedLedger) {
    if (sync.latestObservedHash !== sync.lastProcessedHash) {
      throw new Error('Observed validated ledger hash conflicts with the incremental cursor')
    }
    return {
      kind: 'stop',
      status: 'caught_up',
      lagLedgers: 0,
      state: buildCollectorRunState({
        previous,
        status: 'healthy',
        now,
        lag: 0,
        endpoint: sync.endpoint,
        durationMs,
        success: true,
      }),
    }
  }

  return { kind: 'run', lagLedgers: lag, scope }
}
