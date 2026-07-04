import type { StoredSyncState } from '../../domain/network/status'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'

export interface CatchUpBaseIdentity {
  epochId: string
  snapshotId: string
  ledgerIndex: number
  ledgerHash: string
}

export interface CatchUpInitializationEvidence {
  sync: StoredSyncState | null
  currentEpochId: string | null
  baseEpochExists: boolean
  overlayStates: readonly CurrentStateOverlayState[]
  processedLedgerCount: number
}

export type CatchUpInitializationPlan =
  | {
      action: 'initialize'
      previousEpochId: string
      latestObservedLedger: number
      latestObservedHash: string
    }
  | {
      action: 'replay'
    }

function exactOverlayMatch(
  state: CurrentStateOverlayState,
  base: CatchUpBaseIdentity,
): boolean {
  return state.epochId === base.epochId
    && state.baseSnapshotId === base.snapshotId
    && state.baseLedgerIndex === base.ledgerIndex
    && state.baseLedgerHash === base.ledgerHash
    && state.overlayLedgerIndex === base.ledgerIndex
    && state.overlayLedgerHash === base.ledgerHash
}

export function planCatchUpInitialization(options: {
  base: CatchUpBaseIdentity
  evidence: CatchUpInitializationEvidence
}): CatchUpInitializationPlan {
  const { base, evidence } = options
  const sync = evidence.sync

  if (!sync?.epochId) throw new Error('Catch-up initialization requires an active sync epoch')
  if (sync.status === 'error') throw new Error('Catch-up initialization is blocked while network status is error')
  if (sync.status === 'reset_suspected') {
    throw new Error('Catch-up initialization is blocked while reset is suspected')
  }
  if (sync.latestObservedLedger === null || !sync.latestObservedHash) {
    throw new Error('Catch-up initialization requires a validated observed head')
  }
  if (sync.latestObservedLedger < base.ledgerIndex) {
    throw new Error('Observed validated head is behind the verified base ledger')
  }
  if (
    sync.latestObservedLedger === base.ledgerIndex
    && sync.latestObservedHash !== base.ledgerHash
  ) {
    throw new Error('Observed validated head conflicts with the verified base ledger')
  }

  const exactReplay = sync.epochId === base.epochId
    && sync.lastProcessedLedger === base.ledgerIndex
    && sync.lastProcessedHash === base.ledgerHash
    && evidence.currentEpochId === base.epochId
    && evidence.overlayStates.length === 1
    && exactOverlayMatch(evidence.overlayStates[0]!, base)

  if (exactReplay) return { action: 'replay' }

  if (sync.lastProcessedLedger !== null || sync.lastProcessedHash !== null) {
    throw new Error('Catch-up initialization refuses to replace an existing incremental cursor')
  }
  if (evidence.processedLedgerCount !== 0) {
    throw new Error('Catch-up initialization refuses to rebind existing processed-ledger history')
  }
  if (evidence.overlayStates.length !== 0) {
    throw new Error('Catch-up initialization refuses to replace existing overlay state')
  }
  if (!evidence.currentEpochId || evidence.currentEpochId !== sync.epochId) {
    throw new Error('Current network epoch does not match sync state')
  }
  if (evidence.baseEpochExists) {
    throw new Error('Verified base epoch identity already exists without an exact replay state')
  }

  return {
    action: 'initialize',
    previousEpochId: sync.epochId,
    latestObservedLedger: sync.latestObservedLedger,
    latestObservedHash: sync.latestObservedHash,
  }
}
