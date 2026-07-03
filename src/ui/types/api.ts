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

export interface ObjectChangeRecord {
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
  provenance: 'indexed'
}

export interface ObjectHistoryResponse {
  network: 'devnet'
  object_type: string
  object_id: string
  data: ObjectChangeRecord[]
  page: { limit: number; next_cursor: null }
}

export interface LoanLifecycleEvent {
  loan_id: string
  epoch_id: string
  transaction_hash: string
  ledger_index: number
  transaction_index: number
  close_time: number
  event_type: 'created' | 'payment' | 'paid' | 'impaired' | 'unimpaired' | 'defaulted' | 'deleted' | 'updated'
  transaction_type: string
  result_code: string
  status_before: string
  status_after: string
  principal_before: string | null
  principal_after: string | null
  total_value_before: string | null
  total_value_after: string | null
  payment_remaining_before: number | null
  payment_remaining_after: number | null
  details_json: unknown
  created_at: string
  provenance: 'indexed'
}

export interface LoanLifecycleResponse {
  network: 'devnet'
  loan_id: string
  data: LoanLifecycleEvent[]
  page: { limit: number; next_cursor: null }
}

export interface LifecycleExplorerResponse {
  network: 'devnet'
  kind: 'loan_lifecycle'
  data: LoanLifecycleEvent[]
  filters: { event_type: string | null; loan_id: string | null }
  page: { limit: number; next_cursor: null }
  provenance: { collection: Provenance }
}

export interface ArchivedObjectRecord {
  epoch_id: string
  object_type: 'Vault' | 'LoanBroker' | 'Loan'
  object_id: string
  deletion_transaction_hash: string
  deletion_ledger_index: number
  deletion_transaction_index: number
  deletion_close_time: number
  deletion_reason: 'vault_delete' | 'loan_broker_delete' | 'loan_delete' | 'unknown'
  final_state_json: unknown
  relationships: {
    vault_id: string | null
    loan_broker_id: string | null
    loan_id: string | null
    owner: string | null
    account: string | null
    borrower: string | null
    asset_key: string | null
  }
  archived_at: string
  provenance: 'indexed'
}

export interface ArchivedObjectsResponse {
  network: 'devnet'
  kind: 'archived_objects'
  data: ArchivedObjectRecord[]
  filters: { object_type: string | null; query: string | null }
  page: { limit: number; next_cursor: null }
  provenance: { collection: Provenance }
}

export interface ArchivedObjectDetailResponse {
  network: 'devnet'
  kind: 'archived_object'
  object_type: string
  object_id: string
  data: ArchivedObjectRecord | null
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: { object: Provenance }
}

export interface BalanceHistoryRecord {
  epoch_id: string
  subject_type: 'Vault' | 'LoanBroker'
  subject_id: string
  transaction_hash: string
  ledger_index: number
  transaction_index: number
  close_time: number
  metric_type: 'debt_total' | 'debt_maximum' | 'cover_available' | 'loss_unrealized' | 'required_minimum_cover' | 'cover_surplus'
  asset_key: string | null
  before_value: string | null
  after_value: string | null
  formula: string | null
  source_fields_json: unknown
  created_at: string
  provenance: Provenance
}

export interface BalanceHistoryResponse {
  network: 'devnet'
  kind: 'cover_debt_loss'
  data: BalanceHistoryRecord[]
  filters: { metric_type: string | null; subject_type: string | null; subject_id: string | null; asset_key: string | null }
  page: { limit: number; next_cursor: null }
  provenance: { collection: Provenance }
  formulas: {
    required_minimum_cover: string
    cover_surplus: string
  }
}

export interface EpochRecord {
  id: string
  network: 'devnet'
  status: 'current' | 'archived'
  first_ledger_index: number
  first_ledger_hash: string
  last_ledger_index: number | null
  last_ledger_hash: string | null
  started_at: string
  ended_at: string | null
  reset_reason: string | null
  provenance: Provenance
}

export interface EpochsResponse {
  network: 'devnet'
  data: EpochRecord[]
}

export interface EpochDetailResponse {
  network: 'devnet'
  kind: 'epoch'
  epoch_id: string
  data: EpochRecord | null
  scoped_counts: {
    protocol_events: number
    object_changes: number
    archived_objects: number
    loan_lifecycle_events: number
    balance_history_rows: number
    current_objects: null
  } | null
  availability: { state: 'available' | 'unavailable'; reason: string | null; current_objects: string }
  provenance: { epoch: Provenance; scoped_counts: Provenance; current_objects: Provenance }
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

export type LoanOnLedgerStatus = 'active' | 'impaired' | 'defaulted'
export type LoanScheduleStatus = 'current' | 'payment_due' | 'default_eligible' | 'complete' | 'unknown'

export interface LoanRecord {
  id: string
  loan_broker_id: string
  borrower: string
  loan_sequence: number
  asset: CanonicalAssetResponse
  loan_origination_fee: string
  loan_service_fee: string
  late_payment_fee: string
  close_payment_fee: string
  overpayment_fee_rate: number
  interest_rate: number
  late_interest_rate: number
  close_interest_rate: number
  overpayment_interest_rate: number
  start_date_ripple_time: number
  start_date: string | null
  payment_interval_seconds: number
  grace_period_seconds: number
  previous_payment_due_ripple_time: number
  previous_payment_due: string | null
  next_payment_due_ripple_time: number | null
  next_payment_due: string | null
  default_eligible_ripple_time: number | null
  default_eligible_at: string | null
  payment_remaining: number
  principal_outstanding: string
  total_value_outstanding: string
  management_fee_outstanding: string
  periodic_payment: string
  loan_scale: number | null
  on_ledger_status: LoanOnLedgerStatus
  schedule_status: LoanScheduleStatus
  status_source: {
    flags: number
    next_payment_due_ripple_time: number | null
    next_payment_due: string | null
    grace_period_seconds: number
    default_eligible_ripple_time: number | null
    default_eligible_at: string | null
    evaluated_at_ripple_time: number
    evaluated_at: string | null
  }
  supports_overpayment: boolean
  flags: number
  previous_transaction_hash: string
  previous_ledger_index: number
  related_loan_broker: {
    id: string
    vault_id: string
    owner: string
    account: string
  }
  related_vault: {
    id: string
    owner: string
    account: string
    asset: CanonicalAssetResponse
  }
  provenance: {
    object: Provenance
    asset: Provenance
    relationships: Provenance
    on_ledger_status: Provenance
    schedule_status: Provenance
  }
  raw?: Record<string, unknown>
}

export interface LoanCollectionResponse {
  network: 'devnet'
  kind: 'loans'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: LoanRecord[]
  page: {
    limit: number
    next_cursor: string | null
    sort?: 'id_asc' | 'id_desc'
    loan_shards_read?: number
    relation_shards_read?: number
    objects_examined?: number
  }
  filters?: {
    query: string | null
    on_ledger_status: LoanOnLedgerStatus | null
    schedule_status: LoanScheduleStatus | null
  }
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: {
    collection: Provenance
    asset_relationship?: Provenance
    schedule_status?: Provenance
  }
}

export interface LoanDetailResponse {
  network: 'devnet'
  kind: 'loan'
  epoch: { id: string; status: string } | null
  snapshot: SnapshotSummary | null
  data: LoanRecord | null
  availability: { state: 'available' | 'unavailable'; reason: string | null }
  provenance: {
    object: Provenance
    asset_relationship?: Provenance
    schedule_status?: Provenance
  }
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
