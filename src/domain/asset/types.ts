import type { ExactDecimal } from './decimal'

export type AssetType = 'xrp' | 'iou' | 'mpt'
export type AmountProvenance = 'direct' | 'derived' | 'indexed'

export interface XrpAsset {
  type: 'xrp'
  key: 'XRP'
  symbol: 'XRP'
  scale: 6
}

export interface IouAsset {
  type: 'iou'
  key: string
  currency: string
  issuer: string
  label: string
  scale: null
}

export interface MptProperties {
  globallyLocked: boolean
  canLock: boolean
  requiresAuthorization: boolean
  canEscrow: boolean
  canTrade: boolean
  canTransfer: boolean
  canClawback: boolean
}

export type MptMetadataSource = 'ledger' | 'none' | 'invalid'

export interface MptAsset {
  type: 'mpt'
  key: string
  issuanceId: string
  issuer: string | null
  ticker: string | null
  name: string | null
  scale: number
  metadataSource: MptMetadataSource
  transferFeeTenthsBasisPoints: number | null
  properties: MptProperties | null
}

export type CanonicalAsset = XrpAsset | IouAsset | MptAsset

export interface CanonicalAmount {
  asset: CanonicalAsset
  raw: string
  value: ExactDecimal
  display: string
  provenance: AmountProvenance
}

export interface XrplIssuedCurrencyAmount {
  currency: string
  issuer: string
  value: string
}

export interface XrplMptAmount {
  mpt_issuance_id: string
  value: string
}

export type XrplAmount = string | XrplIssuedCurrencyAmount | XrplMptAmount

export interface MptIssuanceLedgerEntry {
  LedgerEntryType?: unknown
  Flags?: unknown
  Issuer?: unknown
  AssetScale?: unknown
  TransferFee?: unknown
  MPTokenMetadata?: unknown
}
