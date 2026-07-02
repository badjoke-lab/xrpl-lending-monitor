import {
  compareExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
  parseInteger,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../domain/asset/decimal'
import type { VaultCurrentProjection } from '../../domain/lending/current-projections'
import type { NetworkEpochRecord, StoredSyncState } from '../../domain/network/status'
import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import type { ListCurrentVaultsResult, VaultSort } from '../repositories/current-state-object-reader'

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

function coefficientAtScale(value: ExactDecimal, scale: number): bigint {
  return parseInteger(value.coefficient) * 10n ** BigInt(scale - value.scale)
}

function vaultDerived(vault: VaultCurrentProjection) {
  try {
    const total = parseExactDecimal(vault.assetsTotal)
    const available = parseExactDecimal(vault.assetsAvailable)
    const zero = parseExactDecimal('0')
    const used = subtractExactDecimals(total, available)
    if (compareExactDecimals(total, zero) <= 0 || compareExactDecimals(used, zero) < 0) {
      return {
        used_assets: null,
        utilization_bps: null,
        formula: 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)',
        provenance: 'unavailable',
      }
    }

    const scale = Math.max(total.scale, used.scale)
    const totalInteger = coefficientAtScale(total, scale)
    const usedInteger = coefficientAtScale(used, scale)
    return {
      used_assets: formatExactDecimal(used),
      utilization_bps: Number((usedInteger * 10_000n) / totalInteger),
      formula: 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)',
      provenance: 'derived',
    }
  } catch {
    return {
      used_assets: null,
      utilization_bps: null,
      formula: 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)',
      provenance: 'unavailable',
    }
  }
}

function serializeVault(vault: VaultCurrentProjection, includeRaw = false) {
  return {
    id: vault.id,
    owner: vault.owner,
    account: vault.account,
    asset: vault.asset,
    assets_total: vault.assetsTotal,
    assets_available: vault.assetsAvailable,
    assets_maximum: vault.assetsMaximum,
    loss_unrealized: vault.lossUnrealized,
    share_mpt_id: vault.shareMptId,
    domain_id: vault.domainId,
    withdrawal_policy: vault.withdrawalPolicy,
    scale: vault.scale,
    flags: vault.flags,
    previous_transaction_hash: vault.previousTxHash,
    previous_ledger_index: vault.previousLedgerIndex,
    derived: vaultDerived(vault),
    provenance: {
      object: 'direct',
      derived: vaultDerived(vault).provenance,
    },
    ...(includeRaw ? { raw: vault.raw } : {}),
  }
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

export function serializeAvailableVaultCollection(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  result: ListCurrentVaultsResult
  page: PageOptions
  sort: VaultSort
  query?: string
  hasLoss?: boolean
}) {
  return {
    network: 'devnet',
    kind: 'vaults',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: options.result.data.map((vault) => serializeVault(vault)),
    page: {
      limit: options.page.limit,
      next_cursor: options.result.nextCursor,
      sort: options.sort,
      shards_read: options.result.shardsRead,
      objects_examined: options.result.objectsExamined,
    },
    filters: {
      query: options.query ?? null,
      has_loss: options.hasLoss ?? null,
    },
    availability: {
      state: 'available',
      reason: null,
    },
    provenance: {
      collection: 'direct',
    },
  }
}

export function serializeVaultDetail(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  vault: VaultCurrentProjection
}) {
  return {
    network: 'devnet',
    kind: 'vault',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: serializeVault(options.vault, true),
    availability: {
      state: 'available',
      reason: null,
    },
    provenance: {
      object: 'direct',
    },
  }
}

export function serializeUnavailableEntityCollection(options: {
  kind: EntityCollectionKind
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  page: PageOptions
  reason?: string
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
      reason: options.reason ?? (options.snapshot
        ? 'current object storage binding is not configured for public API reads'
        : 'active current-state snapshot has not been activated'),
    },
    provenance: {
      collection: 'unavailable',
    },
  }
}

export function serializeUnavailableVaultDetail(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  reason?: string
}) {
  return {
    network: 'devnet',
    kind: 'vault',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: null,
    availability: {
      state: 'unavailable',
      reason: options.reason ?? (options.snapshot
        ? 'current object storage binding is not configured for public API reads'
        : 'active current-state snapshot has not been activated'),
    },
    provenance: {
      object: 'unavailable',
    },
  }
}
