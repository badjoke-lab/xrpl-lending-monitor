import type { StoredSyncState } from '../../domain/network/status'
import type { CatchUpBaseIdentity } from '../../shared/catch-up-base-identity'
import type { CurrentStateOverlayState } from '../repositories/current-state-overlay'

export interface ReplacementBaseRebaseEvidence {
  sync: StoredSyncState | null
  currentEpochId: string | null
  overlayStates: readonly CurrentStateOverlayState[]
}

export type ReplacementBaseRebasePlan =
  | { action: 'replay' }
  | {
      action: 'rebase'
      previousSnapshotId: string
      previousBaseLedgerIndex: number
      previousBaseLedgerHash: string
      previousCursorLedgerIndex: number
      previousCursorLedgerHash: string
      latestObservedLedger: number
      latestObservedHash: string
    }

function sameBase(state: CurrentStateOverlayState, base: CatchUpBaseIdentity): boolean {
  return state.epochId === base.epochId
    && state.baseSnapshotId === base.snapshotId
    && state.baseLedgerIndex === base.ledgerIndex
    && state.baseLedgerHash === base.ledgerHash
}

function activeOverlayForCursor(options: {
  states: readonly CurrentStateOverlayState[]
  epochId: string
  ledgerIndex: number
  ledgerHash: string
}): CurrentStateOverlayState {
  const matches = options.states.filter((state) =>
    state.epochId === options.epochId
    && state.overlayLedgerIndex === options.ledgerIndex
    && state.overlayLedgerHash === options.ledgerHash)

  if (matches.length !== 1) {
    throw new Error('Replacement-base rebase requires exactly one overlay aligned with the active cursor')
  }
  return matches[0]!
}

export function planReplacementBaseRebase(options: {
  target: CatchUpBaseIdentity
  evidence: ReplacementBaseRebaseEvidence
}): ReplacementBaseRebasePlan {
  const { target, evidence } = options
  const sync = evidence.sync

  if (!sync?.epochId) throw new Error('Replacement-base rebase requires an active sync epoch')
  if (sync.status === 'error') throw new Error('Replacement-base rebase is blocked while network status is error')
  if (sync.status === 'reset_suspected') {
    throw new Error('Replacement-base rebase is blocked while reset is suspected')
  }
  if (sync.epochId !== target.epochId || evidence.currentEpochId !== target.epochId) {
    throw new Error('Replacement-base rebase requires the target to remain in the active epoch')
  }
  if (sync.latestObservedLedger === null || !sync.latestObservedHash) {
    throw new Error('Replacement-base rebase requires a validated observed head')
  }
  if (sync.latestObservedLedger < target.ledgerIndex) {
    throw new Error('Observed validated head is behind the replacement base ledger')
  }
  if (sync.latestObservedLedger === target.ledgerIndex && sync.latestObservedHash !== target.ledgerHash) {
    throw new Error('Observed validated head conflicts with the replacement base ledger')
  }
  if (sync.lastProcessedLedger === null || !sync.lastProcessedHash) {
    throw new Error('Replacement-base rebase requires an existing incremental cursor')
  }

  const targetStates = evidence.overlayStates.filter((state) => sameBase(state, target))

  if (sync.lastProcessedLedger >= target.ledgerIndex && targetStates.length === 1) {
    const targetState = targetStates[0]!
    if (
      targetState.overlayLedgerIndex !== sync.lastProcessedLedger
      || targetState.overlayLedgerHash !== sync.lastProcessedHash
    ) {
      throw new Error('Replayed replacement base target overlay watermark is inconsistent')
    }
    return { action: 'replay' }
  }

  if (sync.lastProcessedLedger >= target.ledgerIndex) {
    throw new Error('Replacement-base rebase refuses to regress or replace a later incremental cursor')
  }
  if (targetStates.length !== 0) {
    throw new Error('Replacement target snapshot already exists without an aligned replay state')
  }

  const active = activeOverlayForCursor({
    states: evidence.overlayStates,
    epochId: target.epochId,
    ledgerIndex: sync.lastProcessedLedger,
    ledgerHash: sync.lastProcessedHash,
  })
  if (active.baseLedgerIndex > sync.lastProcessedLedger) {
    throw new Error('Active overlay base is ahead of the incremental cursor')
  }

  return {
    action: 'rebase',
    previousSnapshotId: active.baseSnapshotId,
    previousBaseLedgerIndex: active.baseLedgerIndex,
    previousBaseLedgerHash: active.baseLedgerHash,
    previousCursorLedgerIndex: sync.lastProcessedLedger,
    previousCursorLedgerHash: sync.lastProcessedHash,
    latestObservedLedger: sync.latestObservedLedger,
    latestObservedHash: sync.latestObservedHash,
  }
}
