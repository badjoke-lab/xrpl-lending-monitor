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
    lending_protocol: {
      enabled: boolean | null
      supported: boolean | null
    }
    single_asset_vault: {
      enabled: boolean | null
      supported: boolean | null
    }
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
    error: {
      code: string
      message: string
    } | null
  }
}

export interface OverviewResponse {
  network: 'devnet'
  epoch: {
    id: string
    status: string
  } | null
  snapshot: {
    id: string
    epoch_id: string
    ledger_index: number
    ledger_hash: string
    completed_at: string
  } | null
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
  provenance: {
    counts: Provenance
    freshness: Provenance
  }
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
  page: {
    limit: number
    next_cursor: null
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
