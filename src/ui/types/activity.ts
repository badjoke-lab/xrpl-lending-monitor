import type { Provenance } from './api'

export interface ActivityEvent {
  transaction_hash: string
  epoch_id: string
  ledger_index: number
  event_index: number
  close_time: number
  transaction_type: string
  result_code: string
  payload_retained: boolean
  source_json: Record<string, unknown> | null
  metadata_json: Record<string, unknown> | null
  created_at: string
  provenance: 'indexed'
}

export interface ActivityCollectionResponse {
  network: 'devnet'
  data: ActivityEvent[]
  page: { limit: number; next_cursor: string | null }
}

export interface ObjectChange {
  transaction_hash: string
  epoch_id: string
  ledger_index: number
  transaction_index: number
  transaction_type: string
  result_code: string
  close_time: number
  node_index: number
  object_type: string
  object_id: string
  action: 'created' | 'modified' | 'deleted'
  field_name: string
  before_json: unknown | null
  after_json: unknown | null
  value_type: string
  unsupported_field: boolean
  relationships: {
    vault_id: string | null
    loan_broker_id: string | null
    loan_id: string | null
    account: string | null
    owner: string | null
    borrower: string | null
    asset_key: string | null
    mpt_issuance_id: string | null
  }
  created_at: string
  provenance: Provenance
}

export interface TransactionDetailResponse {
  network: 'devnet'
  transaction_hash: string
  found: boolean
  event: ActivityEvent | null
  object_changes: ObjectChange[]
}
