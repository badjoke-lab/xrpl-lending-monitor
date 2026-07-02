export type Provenance = 'direct' | 'derived' | 'indexed' | 'unavailable'

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
    lending_protocol: { enabled: boolean | null; supported: boolean | null }
    single_asset_vault: { enabled: boolean | null; supported: boolean | null }
  }
  collector: {
    status: string
    last_processed_ledger: number | null
    last_processed_hash: string | null
    last_attempt_at: string | null
    last_success_at: string | null
    data_age_seconds: number | null
    consecutive_failures: number
    reset_reason: string | null
    error: { code: string; message: string } | null
  }
}

export interface SnapshotSummary {
  id: string
  epoch_id: string
  ledger_index: number
  ledger_hash: string
  completed_at: string | null
}

export interface OverviewResponse {
  network: 'devnet'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  freshness: {
    collector_status: string
    latest_validated_ledger: number | null
    last_processed_ledger: number | null
    last_success_at: string | null
  }
  counts: {
    vaults: number | null
    loan_brokers: number | null
    loans: number | null
    current_objects: number | null
  }
  provenance: { counts: Provenance; freshness: Provenance }
  unavailable: string[]
}

export interface ActivityRecord {
  transaction_hash: string
  epoch_id: string
  ledger_index: number
  event_index: number
  close_time: string
  transaction_type: string
  result_code: string
  payload_retained: boolean
  created_at: string
  provenance: 'indexed'
}

export interface ActivityResponse {
  network: 'devnet'
  data: ActivityRecord[]
  page: { limit: number; next_cursor: null }
}

export interface CanonicalAssetResponse {
  type: 'xrp' | 'iou' | 'mpt'
  key: string
  scale: number | null
  symbol?: string
  currency?: string
  issuer?: string | null
  label?: string
  issuanceId?: string
  ticker?: string | null
  name?: string | null
}

export interface VaultRecord {
  id: string
  owner: string
  account: string
  asset: CanonicalAssetResponse
  assets_total: string
  assets_available: string
  assets_maximum: string | null
  loss_unrealized: string
  share_mpt_id: string
  domain_id: string | null
  withdrawal_policy: number
  scale: number
  flags: number
  previous_transaction_hash: string
  previous_ledger_index: number
  derived: {
    used_assets: string | null
    utilization_bps: number | null
    formula: string
    provenance: Provenance
  }
  provenance: { object: Provenance; derived: Provenance }
  raw?: Record<string, unknown>
}

export interface VaultCollectionResponse {
  network: 'devnet'
  kind: 'vaults'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: VaultRecord[]
  page: {
    limit: number
    next_cursor: string | null
    sort?: 'id_asc' | 'id_desc'
    shards_read?: number
    objects_examined?: number
  }
  filters?: { query: string | null; has_loss: boolean | null }
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: { collection: Provenance }
}

export interface VaultDetailResponse {
  network: 'devnet'
  kind: 'vault'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: VaultRecord | null
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: { object: Provenance }
}

export interface LoanBrokerRecord {
  id: string
  vault_id: string
  owner: string
  account: string
  asset: CanonicalAssetResponse
  sequence: number
  loan_sequence: number
  management_fee_rate: number | null
  owner_count: number
  debt_total: string
  debt_maximum: string | null
  cover_available: string
  cover_rate_minimum: number
  cover_rate_liquidation: number
  flags: number
  previous_transaction_hash: string
  previous_ledger_index: number
  related_vault: {
    id: string
    asset: CanonicalAssetResponse
    owner: string
    account: string
  }
  derived: {
    debt_utilization_bps: number | null
    required_minimum_cover: string | null
    cover_surplus: string | null
    cover_ratio_bps: number | null
    formulas: {
      debt_utilization: string
      required_cover: string
      cover_surplus: string
    }
    provenance: Provenance
  }
  provenance: {
    object: Provenance
    asset: Provenance
    relationship: Provenance
    derived: Provenance
  }
  raw?: Record<string, unknown>
}

export interface LoanBrokerCollectionResponse {
  network: 'devnet'
  kind: 'loan_brokers'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: LoanBrokerRecord[]
  page: {
    limit: number
    next_cursor: string | null
    sort?: 'id_asc' | 'id_desc'
    broker_shards_read?: number
    relation_shards_read?: number
    objects_examined?: number
  }
  filters?: { query: string | null }
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: { collection: Provenance; asset_relationship?: Provenance }
}

export interface LoanBrokerDetailResponse {
  network: 'devnet'
  kind: 'loan_broker'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: LoanBrokerRecord | null
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: { object: Provenance; asset_relationship?: Provenance }
}

export type ResourceState<T> =
  | { state: 'loading'; data: null; error: null }
  | { state: 'ready'; data: T; error: null }
  | { state: 'error'; data: null; error: string }

export interface DashboardResources {
  status: ResourceState<NetworkStatusResponse>
  overview: ResourceState<OverviewResponse>
  activity: ResourceState<ActivityResponse>
}
