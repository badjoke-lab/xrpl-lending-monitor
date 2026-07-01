import type { CanonicalAmount, CanonicalAsset } from '../../domain/asset/types'

export interface AssetResponse {
  type: CanonicalAsset['type']
  key: string
  scale: number | null
  symbol?: string
  currency?: string
  issuer?: string | null
  label?: string
  mpt_issuance_id?: string
  ticker?: string | null
  name?: string | null
  metadata_source?: string
  transfer_fee_tenths_basis_points?: number | null
  properties?: {
    globally_locked: boolean
    can_lock: boolean
    requires_authorization: boolean
    can_escrow: boolean
    can_trade: boolean
    can_transfer: boolean
    can_clawback: boolean
  } | null
}

export interface AssetAmountResponse {
  asset: AssetResponse
  amount: {
    raw: string
    display: string
    provenance: CanonicalAmount['provenance']
  }
}

export function serializeAsset(asset: CanonicalAsset): AssetResponse {
  if (asset.type === 'xrp') {
    return {
      type: asset.type,
      key: asset.key,
      symbol: asset.symbol,
      scale: asset.scale,
    }
  }

  if (asset.type === 'iou') {
    return {
      type: asset.type,
      key: asset.key,
      currency: asset.currency,
      issuer: asset.issuer,
      label: asset.label,
      scale: asset.scale,
    }
  }

  return {
    type: asset.type,
    key: asset.key,
    mpt_issuance_id: asset.issuanceId,
    issuer: asset.issuer,
    ticker: asset.ticker,
    name: asset.name,
    scale: asset.scale,
    metadata_source: asset.metadataSource,
    transfer_fee_tenths_basis_points: asset.transferFeeTenthsBasisPoints,
    properties: asset.properties
      ? {
          globally_locked: asset.properties.globallyLocked,
          can_lock: asset.properties.canLock,
          requires_authorization: asset.properties.requiresAuthorization,
          can_escrow: asset.properties.canEscrow,
          can_trade: asset.properties.canTrade,
          can_transfer: asset.properties.canTransfer,
          can_clawback: asset.properties.canClawback,
        }
      : null,
  }
}

export function serializeCanonicalAmount(amount: CanonicalAmount): AssetAmountResponse {
  return {
    asset: serializeAsset(amount.asset),
    amount: {
      raw: amount.raw,
      display: amount.display,
      provenance: amount.provenance,
    },
  }
}
