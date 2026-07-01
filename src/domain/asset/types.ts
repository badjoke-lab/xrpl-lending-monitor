export type AssetType = 'xrp' | 'iou' | 'mpt'
export type Provenance = 'direct' | 'derived' | 'indexed' | 'unavailable'

export interface XrpAsset {
  type: 'xrp'
  key: 'XRP'
  label: 'XRP'
}

export interface IouAsset {
  type: 'iou'
  key: string
  label: string
  currency: string
  issuer: string
}

export interface MptMetadataUri {
  uri: string
  category: string
  title: string
}

export interface MptMetadata {
  ticker: string | null
  name: string | null
  description: string | null
  icon: string | null
  assetClass: string | null
  assetSubclass: string | null
  issuerName: string | null
  uris: readonly MptMetadataUri[]
  additionalInfo: unknown
  compliant: boolean
  warnings: readonly string[]
}

export interface MptAsset {
  type: 'mpt'
  key: string
  label: string
  issuanceId: string
  issuer: string | null
  scale: number | null
  flags: number | null
  transferFee: number | null
  metadataHex: string | null
  metadata: MptMetadata | null
  metadataSource: 'ledger' | 'none'
}

export type NormalizedAsset = XrpAsset | IouAsset | MptAsset

export interface NormalizedAmount {
  asset: NormalizedAsset
  raw: string
  canonical: string
  display: string
  provenance: Provenance
}
