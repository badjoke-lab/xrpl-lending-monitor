import {
  compareExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
  parseInteger,
  subtractExactDecimals,
  type ExactDecimal,
} from '../../domain/asset/decimal'
import type {
  LoanBrokerCurrentProjection,
  VaultCurrentProjection,
} from '../../domain/lending/current-projections'
import type { NetworkEpochRecord, StoredSyncState } from '../../domain/network/status'
import type { ActiveSnapshotRecord } from '../repositories/core-api-repository'
import type {
  ListCurrentLoanBrokersResult,
  LoanBrokerSort,
  CurrentLoanBrokerRecord,
} from '../repositories/current-state-loan-broker-reader'
import type { ListCurrentVaultsResult, VaultSort } from '../repositories/current-state-object-reader'

export type EntityCollectionKind = 'vaults' | 'loan_brokers' | 'loans'

export interface PageOptions {
  limit: number
}

function epochSummary(epoch: NetworkEpochRecord | null) {
  return epoch ? { id: epoch.id, status: epoch.status } : null
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

function ratioBps(numerator: ExactDecimal, denominator: ExactDecimal): number | null {
  const zero = parseExactDecimal('0')
  if (compareExactDecimals(denominator, zero) <= 0 || compareExactDecimals(numerator, zero) < 0) {
    return null
  }
  const scale = Math.max(numerator.scale, denominator.scale)
  const numeratorInteger = coefficientAtScale(numerator, scale)
  const denominatorInteger = coefficientAtScale(denominator, scale)
  return Number((numeratorInteger * 10_000n) / denominatorInteger)
}

function vaultDerived(vault: VaultCurrentProjection) {
  const formula = 'used_assets = AssetsTotal - AssetsAvailable; utilization_bps = floor(used_assets / AssetsTotal * 10000)'
  try {
    const total = parseExactDecimal(vault.assetsTotal)
    const available = parseExactDecimal(vault.assetsAvailable)
    const zero = parseExactDecimal('0')
    const used = subtractExactDecimals(total, available)
    if (compareExactDecimals(total, zero) <= 0 || compareExactDecimals(used, zero) < 0) {
      return { used_assets: null, utilization_bps: null, formula, provenance: 'unavailable' }
    }
    return {
      used_assets: formatExactDecimal(used),
      utilization_bps: ratioBps(used, total),
      formula,
      provenance: 'derived',
    }
  } catch {
    return { used_assets: null, utilization_bps: null, formula, provenance: 'unavailable' }
  }
}

function serializeVault(vault: VaultCurrentProjection, includeRaw = false) {
  const derived = vaultDerived(vault)
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
    derived,
    provenance: { object: 'direct', derived: derived.provenance },
    ...(includeRaw ? { raw: vault.raw } : {}),
  }
}

function scaledRateProduct(value: ExactDecimal, rate: number): ExactDecimal {
  const unnormalized = {
    coefficient: (parseInteger(value.coefficient) * BigInt(rate)).toString(),
    scale: value.scale + 5,
  }
  return parseExactDecimal(formatExactDecimal(unnormalized))
}

function brokerDerived(broker: LoanBrokerCurrentProjection) {
  const formulas = {
    debt_utilization: 'debt_utilization_bps = floor(DebtTotal / DebtMaximum * 10000)',
    required_cover: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
    cover_surplus: 'cover_surplus = CoverAvailable - required_minimum_cover',
  }
  try {
    const debt = parseExactDecimal(broker.debtTotal)
    const cover = parseExactDecimal(broker.coverAvailable)
    const debtMaximum = broker.debtMaximum === null ? null : parseExactDecimal(broker.debtMaximum)
    const required = scaledRateProduct(debt, broker.coverRateMinimum)
    const surplus = subtractExactDecimals(cover, required)
    return {
      debt_utilization_bps: debtMaximum ? ratioBps(debt, debtMaximum) : null,
      required_minimum_cover: formatExactDecimal(required),
      cover_surplus: formatExactDecimal(surplus),
      cover_ratio_bps: ratioBps(cover, required),
      formulas,
      provenance: 'derived',
    }
  } catch {
    return {
      debt_utilization_bps: null,
      required_minimum_cover: null,
      cover_surplus: null,
      cover_ratio_bps: null,
      formulas,
      provenance: 'unavailable',
    }
  }
}

function serializeLoanBroker(record: CurrentLoanBrokerRecord, includeRaw = false) {
  const { broker, vault } = record
  const derived = brokerDerived(broker)
  return {
    id: broker.id,
    vault_id: broker.vaultId,
    owner: broker.owner,
    account: broker.account,
    asset: vault.asset,
    sequence: broker.sequence,
    loan_sequence: broker.loanSequence,
    management_fee_rate: broker.managementFeeRate,
    owner_count: broker.ownerCount,
    debt_total: broker.debtTotal,
    debt_maximum: broker.debtMaximum,
    cover_available: broker.coverAvailable,
    cover_rate_minimum: broker.coverRateMinimum,
    cover_rate_liquidation: broker.coverRateLiquidation,
    flags: broker.flags,
    previous_transaction_hash: broker.previousTxHash,
    previous_ledger_index: broker.previousLedgerIndex,
    related_vault: {
      id: vault.id,
      asset: vault.asset,
      owner: vault.owner,
      account: vault.account,
    },
    derived,
    provenance: {
      object: 'direct',
      asset: 'direct',
      relationship: 'direct',
      derived: derived.provenance,
    },
    ...(includeRaw ? { raw: broker.raw } : {}),
  }
}

export function serializeOverview(options: {
  state: StoredSyncState | null
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  overlay?: {
    overlayLedgerIndex: number
    overlayLedgerHash: string
    updatedAt: string
  } | null
}) {
  return {
    network: 'devnet',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    base: snapshotSummary(options.snapshot),
    overlay_watermark: options.overlay
      ? {
          ledger_index: options.overlay.overlayLedgerIndex,
          ledger_hash: options.overlay.overlayLedgerHash,
          updated_at: options.overlay.updatedAt,
        }
      : null,
    freshness: {
      collector_status: options.state?.status ?? 'uninitialized',
      latest_validated_ledger: options.state?.latestObservedLedger ?? null,
      last_processed_ledger: options.state?.lastProcessedLedger ?? null,
      last_processed_hash: options.state?.lastProcessedHash ?? null,
      last_success_at: options.state?.lastSuccessAt ?? null,
      overlay_ledger: options.overlay?.overlayLedgerIndex ?? null,
      overlay_hash: options.overlay?.overlayLedgerHash ?? null,
      overlay_updated_at: options.overlay?.updatedAt ?? null,
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
      overlay_watermark: options.overlay ? 'direct' : 'unavailable',
    },
    unavailable: options.snapshot ? [] : ['active current-state snapshot has not been activated'],
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
    filters: { query: options.query ?? null, has_loss: options.hasLoss ?? null },
    availability: { state: 'available', reason: null },
    provenance: { collection: 'direct' },
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
    availability: { state: 'available', reason: null },
    provenance: { object: 'direct' },
  }
}

export function serializeAvailableLoanBrokerCollection(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  result: ListCurrentLoanBrokersResult
  page: PageOptions
  sort: LoanBrokerSort
  query?: string
}) {
  return {
    network: 'devnet',
    kind: 'loan_brokers',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: options.result.data.map((record) => serializeLoanBroker(record)),
    page: {
      limit: options.page.limit,
      next_cursor: options.result.nextCursor,
      sort: options.sort,
      broker_shards_read: options.result.brokerShardsRead,
      relation_shards_read: options.result.relationShardsRead,
      objects_examined: options.result.objectsExamined,
    },
    filters: { query: options.query ?? null },
    availability: { state: 'available', reason: null },
    provenance: {
      collection: 'direct',
      asset_relationship: 'direct',
    },
  }
}

export function serializeLoanBrokerDetail(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord
  record: CurrentLoanBrokerRecord
}) {
  return {
    network: 'devnet',
    kind: 'loan_broker',
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: serializeLoanBroker(options.record, true),
    availability: { state: 'available', reason: null },
    provenance: { object: 'direct', asset_relationship: 'direct' },
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
    page: { limit: options.page.limit, next_cursor: null },
    availability: {
      state: 'unavailable',
      reason: options.reason ?? (options.snapshot
        ? 'current object storage binding is not configured for public API reads'
        : 'active current-state snapshot has not been activated'),
    },
    provenance: { collection: 'unavailable' },
  }
}

export function serializeUnavailableEntityDetail(options: {
  kind: 'vault' | 'loan_broker' | 'loan'
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  reason?: string
}) {
  return {
    network: 'devnet',
    kind: options.kind,
    epoch: epochSummary(options.epoch),
    snapshot: snapshotSummary(options.snapshot),
    data: null,
    availability: {
      state: 'unavailable',
      reason: options.reason ?? (options.snapshot
        ? 'current object storage binding is not configured for public API reads'
        : 'active current-state snapshot has not been activated'),
    },
    provenance: { object: 'unavailable' },
  }
}

export function serializeUnavailableVaultDetail(options: {
  epoch: NetworkEpochRecord | null
  snapshot: ActiveSnapshotRecord | null
  reason?: string
}) {
  return serializeUnavailableEntityDetail({ kind: 'vault', ...options })
}
