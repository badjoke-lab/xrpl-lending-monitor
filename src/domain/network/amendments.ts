export const LENDING_PROTOCOL_ID =
  '565B90CA1AB2B9D42208ED10884188C64F9E19083DECB9634AAF06EB03299509'

export const SINGLE_ASSET_VAULT_ID =
  '81BD2619B6B3C8625AC5D0BC01DE17F06C3F0AB95C7C87C93715B87A4FD240D8'

export interface AmendmentStatus {
  id: string
  name: string
  enabled: boolean
  supported: boolean
}

export interface LendingAmendmentStatus {
  lendingProtocol: AmendmentStatus
  singleAssetVault: AmendmentStatus
}
