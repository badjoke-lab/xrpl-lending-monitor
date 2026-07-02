import type { NetworkEpochRecord, StoredSyncState } from '../../domain/network/status'
import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'

export type EntityCollectionKind = 'vaults' | 'loan_brokers' | 'loans'

export interface PageOptions {
  limit: number
}

function epochSummary(epoch: NetworkEpochRecord | null) {
  return epoch
    ? {
        id: epoch.id,
        status: epoch.status,
      }
    : null
}

function snapshotSummary(snapshot: ActiveSnapshotRecord | null) {
  return snapshot
    ? {
        id: snapshot.id,
        epoch_id: snapshot.epochId,
        ledger_index: snapshot.ledgerIndex,
        ledger_hash: snapshot.ledgerHash,
        completed_at: snapshot.completedAt,
      }
    : null
}

export function serializeOverview(options: {
  state: StoredSyncState | null
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
}) {
  return {
    network: 'devnet',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    freshness: {
      collector_status: options.state?.status ?? 'uninitialized',
      latest_validated_ledger: options.state?.latestObservedLedger ?? null,
      last_processed_ledger: options.state?.lastProcessedLedger ?? null,
      last_success_at: options.state?.lastSuccessAt ?? null,
    },
    counts: {
      vaults: options.snapshot?.vaultCount ?? null,
      loan_brokers: options.snapshot?.loanBrokerCount ?? null,
      loans: options.snapshot?.loanCount ?? null,
      current_objects: options.snapshot?.objectCount ?? null,
    },
    provenance: {
      counts: options.snapshot ? 'direct' : 'unavailable',
      freshness: options.state ? 'direct' : 'unavailable',
    },
    unavailable: options.snapshot
      ? []
      : ['active current-state snapshot has not been activated'],
  }
}

export function serializeUnavailableEntityCollection(options: {
  kind: EntityCollectionKind
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  page: PageOptions
}) {
  return {
    network: 'devnet',
    kind: options.kind,
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: [],
    page: {
      limit: options.page.limit,
      next_cursor: null,
    },
    availability: {
      state: 'unavailable',
      reason: options.snapshot
        ? 'current object shard reader is not configured for public API reads yet'
        : 'active current-state snapshot has not been activated',
    },
    provenance: {
      collection: 'unavailable',
    },
  }
}
