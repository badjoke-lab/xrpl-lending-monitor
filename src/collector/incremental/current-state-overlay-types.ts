export type CurrentStateOverlayObjectType = 'vault' | 'loan_broker' | 'loan'

export interface CurrentStateOverlayRelationships {
  owner?: string | null
  account?: string | null
  borrower?: string | null
  vaultId?: string | null
  loanBrokerId?: string | null
  assetKey?: string | null
  onLedgerStatus?: 'active' | 'impaired' | 'defaulted' | null
}

export type CurrentStateOverlayMutation =
  | {
      operation: 'upsert'
      objectType: CurrentStateOverlayObjectType
      objectId: string
      projectionJson: string
      relationships?: CurrentStateOverlayRelationships
    }
  | {
      operation: 'deleted'
      objectType: CurrentStateOverlayObjectType
      objectId: string
      relationships?: CurrentStateOverlayRelationships
    }
