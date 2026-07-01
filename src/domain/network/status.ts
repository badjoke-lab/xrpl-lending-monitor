import type { NetworkSnapshot } from '../../collector/network/read-network-snapshot'
import { detectReset, type ResetReason } from '../epoch/reset-detection'

export type SyncHealth =
  | 'uninitialized'
  | 'healthy'
  | 'stale'
  | 'error'
  | 'reset_suspected'

export interface StoredSyncState {
  network: 'devnet'
  epochId: string | null
  lastProcessedLedger: number | null
  lastProcessedHash: string | null
  latestObservedLedger: number | null
  latestObservedHash: string | null
  latestLedgerAgeSeconds: number | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  status: SyncHealth
  consecutiveFailures: number
  endpoint: string | null
  serverVersion: string | null
  serverState: string | null
  completeLedgers: string | null
  lendingProtocolEnabled: boolean | null
  lendingProtocolSupported: boolean | null
  singleAssetVaultEnabled: boolean | null
  singleAssetVaultSupported: boolean | null
  resetReason: ResetReason | null
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface NetworkEpochRecord {
  id: string
  network: 'devnet'
  status: 'current' | 'archived'
  firstLedgerIndex: number
  firstLedgerHash: string
  lastLedgerIndex: number | null
  lastLedgerHash: string | null
  startedAt: string
  endedAt: string | null
  resetReason: string | null
  createdAt: string
  updatedAt: string
}

export interface SuccessfulStatusPlan {
  state: StoredSyncState
  newEpoch: NetworkEpochRecord | null
}

export function buildEpochId(snapshot: NetworkSnapshot): string {
  return `devnet:${snapshot.validatedLedger.index}:${snapshot.validatedLedger.hash
    .slice(0, 16)
    .toLowerCase()}`
}

export function planSuccessfulStatus(options: {
  previous: StoredSyncState | null
  snapshot: NetworkSnapshot
  staleAfterSeconds: number
}): SuccessfulStatusPlan {
  const { previous, snapshot, staleAfterSeconds } = options
  const previousObservation =
    previous?.latestObservedLedger !== null &&
    previous?.latestObservedLedger !== undefined &&
    previous.latestObservedHash
      ? {
          index: previous.latestObservedLedger,
          hash: previous.latestObservedHash,
        }
      : null
  const reset = detectReset(previousObservation, {
    index: snapshot.validatedLedger.index,
    hash: snapshot.validatedLedger.hash,
  })

  const createdAt = previous?.createdAt ?? snapshot.observedAt
  const base = {
    network: 'devnet' as const,
    lastProcessedLedger: previous?.lastProcessedLedger ?? null,
    lastProcessedHash: previous?.lastProcessedHash ?? null,
    latestObservedLedger: snapshot.validatedLedger.index,
    latestObservedHash: snapshot.validatedLedger.hash,
    latestLedgerAgeSeconds: snapshot.validatedLedger.ageSeconds,
    lastAttemptAt: snapshot.observedAt,
    lastSuccessAt: snapshot.observedAt,
    consecutiveFailures: 0,
    endpoint: snapshot.endpoint,
    serverVersion: snapshot.serverVersion,
    serverState: snapshot.serverState,
    completeLedgers: snapshot.completeLedgers,
    lendingProtocolEnabled: snapshot.amendments.lendingProtocol.enabled,
    lendingProtocolSupported: snapshot.amendments.lendingProtocol.supported,
    singleAssetVaultEnabled: snapshot.amendments.singleAssetVault.enabled,
    singleAssetVaultSupported: snapshot.amendments.singleAssetVault.supported,
    errorCode: null,
    errorMessage: null,
    createdAt,
    updatedAt: snapshot.observedAt,
  }

  if (reset.suspected) {
    return {
      state: {
        ...base,
        epochId: previous?.epochId ?? null,
        status: 'reset_suspected',
        resetReason: reset.reason,
      },
      newEpoch: null,
    }
  }

  if (!previous?.epochId) {
    const epochId = buildEpochId(snapshot)
    return {
      state: {
        ...base,
        epochId,
        status:
          snapshot.validatedLedger.ageSeconds > staleAfterSeconds ? 'stale' : 'healthy',
        resetReason: null,
      },
      newEpoch: {
        id: epochId,
        network: 'devnet',
        status: 'current',
        firstLedgerIndex: snapshot.validatedLedger.index,
        firstLedgerHash: snapshot.validatedLedger.hash,
        lastLedgerIndex: null,
        lastLedgerHash: null,
        startedAt: snapshot.observedAt,
        endedAt: null,
        resetReason: null,
        createdAt: snapshot.observedAt,
        updatedAt: snapshot.observedAt,
      },
    }
  }

  return {
    state: {
      ...base,
      epochId: previous.epochId,
      status: snapshot.validatedLedger.ageSeconds > staleAfterSeconds ? 'stale' : 'healthy',
      resetReason: null,
    },
    newEpoch: null,
  }
}

export function planFailedStatus(options: {
  previous: StoredSyncState | null
  attemptedAt: string
  code: string
  message: string
}): StoredSyncState {
  const { previous, attemptedAt, code, message } = options

  return {
    network: 'devnet',
    epochId: previous?.epochId ?? null,
    lastProcessedLedger: previous?.lastProcessedLedger ?? null,
    lastProcessedHash: previous?.lastProcessedHash ?? null,
    latestObservedLedger: previous?.latestObservedLedger ?? null,
    latestObservedHash: previous?.latestObservedHash ?? null,
    latestLedgerAgeSeconds: previous?.latestLedgerAgeSeconds ?? null,
    lastAttemptAt: attemptedAt,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    status: 'error',
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    endpoint: previous?.endpoint ?? null,
    serverVersion: previous?.serverVersion ?? null,
    serverState: previous?.serverState ?? null,
    completeLedgers: previous?.completeLedgers ?? null,
    lendingProtocolEnabled: previous?.lendingProtocolEnabled ?? null,
    lendingProtocolSupported: previous?.lendingProtocolSupported ?? null,
    singleAssetVaultEnabled: previous?.singleAssetVaultEnabled ?? null,
    singleAssetVaultSupported: previous?.singleAssetVaultSupported ?? null,
    resetReason: previous?.resetReason ?? null,
    errorCode: code,
    errorMessage: message,
    createdAt: previous?.createdAt ?? attemptedAt,
    updatedAt: attemptedAt,
  }
}
