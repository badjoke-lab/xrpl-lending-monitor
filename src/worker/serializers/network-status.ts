import type {
  NetworkEpochRecord,
  StoredSyncState,
} from '../../domain/network/status'

export interface NetworkStatusResponse {
  network: 'devnet'
  epoch: {
    id: string
    status: 'current' | 'archived'
    first_ledger_index: number
    first_ledger_hash: string
    last_ledger_index: number | null
    last_ledger_hash: string | null
    started_at: string
  } | null
  server: {
    endpoint: string | null
    version: string | null
    state: string | null
    complete_ledgers: string | null
    latest_validated_ledger: number | null
    latest_validated_hash: string | null
    latest_ledger_age_seconds: number | null
  }
  amendments: {
    lending_protocol: {
      enabled: boolean | null
      supported: boolean | null
    }
    single_asset_vault: {
      enabled: boolean | null
      supported: boolean | null
    }
  }
  collector: {
    status: StoredSyncState['status']
    last_processed_ledger: number | null
    last_processed_hash: string | null
    last_attempt_at: string | null
    last_success_at: string | null
    data_age_seconds: number | null
    consecutive_failures: number
    reset_reason: string | null
    error: {
      code: string
      message: string
    } | null
  }
}

function ageSeconds(lastSuccessAt: string | null, evaluatedAt: Date): number | null {
  if (!lastSuccessAt) return null
  const timestamp = Date.parse(lastSuccessAt)
  if (!Number.isFinite(timestamp)) return null
  return Math.max(0, Math.floor((evaluatedAt.getTime() - timestamp) / 1_000))
}

export function serializeNetworkStatus(options: {
  state: StoredSyncState | null
  epoch: NetworkEpochRecord | null
  evaluatedAt?: Date
}): NetworkStatusResponse {
  const evaluatedAt = options.evaluatedAt ?? new Date()
  const state = options.state

  return {
    network: 'devnet',
    epoch: options.epoch
      ? {
          id: options.epoch.id,
          status: options.epoch.status,
          first_ledger_index: options.epoch.firstLedgerIndex,
          first_ledger_hash: options.epoch.firstLedgerHash,
          last_ledger_index: options.epoch.lastLedgerIndex,
          last_ledger_hash: options.epoch.lastLedgerHash,
          started_at: options.epoch.startedAt,
        }
      : null,
    server: {
      endpoint: state?.endpoint ?? null,
      version: state?.serverVersion ?? null,
      state: state?.serverState ?? null,
      complete_ledgers: state?.completeLedgers ?? null,
      latest_validated_ledger: state?.latestObservedLedger ?? null,
      latest_validated_hash: state?.latestObservedHash ?? null,
      latest_ledger_age_seconds: state?.latestLedgerAgeSeconds ?? null,
    },
    amendments: {
      lending_protocol: {
        enabled: state?.lendingProtocolEnabled ?? null,
        supported: state?.lendingProtocolSupported ?? null,
      },
      single_asset_vault: {
        enabled: state?.singleAssetVaultEnabled ?? null,
        supported: state?.singleAssetVaultSupported ?? null,
      },
    },
    collector: {
      status: state?.status ?? 'uninitialized',
      last_processed_ledger: state?.lastProcessedLedger ?? null,
      last_processed_hash: state?.lastProcessedHash ?? null,
      last_attempt_at: state?.lastAttemptAt ?? null,
      last_success_at: state?.lastSuccessAt ?? null,
      data_age_seconds: ageSeconds(state?.lastSuccessAt ?? null, evaluatedAt),
      consecutive_failures: state?.consecutiveFailures ?? 0,
      reset_reason: state?.resetReason ?? null,
      error:
        state?.errorCode && state.errorMessage
          ? {
              code: state.errorCode,
              message: state.errorMessage,
            }
          : null,
    },
  }
}
