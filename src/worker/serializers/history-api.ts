import type {
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  EpochStatsRecord,
  LoanLifecycleRecord,
  NetworkEpochApiRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
  SearchResultRecord,
} from '../repositories/history-api-repository'

export interface HistoryPage {
  limit: number
  next_cursor: null
}

function page(limit: number): HistoryPage {
  return { limit, next_cursor: null }
}

function serializeProtocolEvent(event: ProtocolEventRecord) {
  return {
    transaction_hash: event.eventHash,
    epoch_id: event.epochId,
    ledger_index: event.ledgerIndex,
    event_index: event.eventIndex,
    close_time: event.closeTime,
    transaction_type: event.eventType,
    result_code: event.resultCode,
    payload_retained: event.payloadRetained,
    source_json: event.sourceJson,
    metadata_json: event.metadataJson,
    created_at: event.createdAt,
    provenance: 'indexed',
  }
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function serializeObjectChange(change: ObjectChangeRecord) {
  return {
    transaction_hash: change.transactionHash,
    epoch_id: change.epochId,
    ledger_index: change.ledgerIndex,
    transaction_index: change.transactionIndex,
    transaction_type: change.transactionType,
    result_code: change.resultCode,
    close_time: change.closeTime,
    node_index: change.nodeIndex,
    object_type: change.objectType,
    object_id: change.objectId,
    action: change.action,
    field_name: change.fieldName,
    before_json: change.beforeJson,
    after_json: change.afterJson,
    value_type: change.valueType,
    unsupported_field: change.unsupportedField,
    relationships: {
      vault_id: change.vaultId,
      loan_broker_id: change.loanBrokerId,
      loan_id: change.loanId,
      account: change.account,
      owner: change.owner,
      borrower: change.borrower,
      asset_key: change.assetKey,
      mpt_issuance_id: change.mptIssuanceId,
    },
    created_at: change.createdAt,
    provenance: 'indexed',
  }
}

function serializeLoanLifecycle(event: LoanLifecycleRecord) {
  return {
    loan_id: event.loanId,
    epoch_id: event.epochId,
    transaction_hash: event.transactionHash,
    ledger_index: event.ledgerIndex,
    transaction_index: event.transactionIndex,
    close_time: event.closeTime,
    event_type: event.eventType,
    transaction_type: event.transactionType,
    result_code: event.resultCode,
    status_before: event.statusBefore,
    status_after: event.statusAfter,
    principal_before: event.principalBefore,
    principal_after: event.principalAfter,
    total_value_before: event.totalValueBefore,
    total_value_after: event.totalValueAfter,
    payment_remaining_before: event.paymentRemainingBefore,
    payment_remaining_after: event.paymentRemainingAfter,
    details_json: event.detailsJson,
    created_at: event.createdAt,
    provenance: 'indexed',
  }
}

function serializeEpoch(epoch: NetworkEpochApiRecord) {
  return {
    id: epoch.id,
    network: 'devnet',
    status: epoch.status,
    first_ledger_index: epoch.firstLedgerIndex,
    first_ledger_hash: epoch.firstLedgerHash,
    last_ledger_index: epoch.lastLedgerIndex,
    last_ledger_hash: epoch.lastLedgerHash,
    started_at: epoch.startedAt,
    ended_at: epoch.endedAt,
    reset_reason: epoch.resetReason,
    provenance: 'direct',
  }
}

function serializeSearchResult(result: SearchResultRecord) {
  return {
    kind: result.kind,
    epoch_id: result.epochId,
    ledger_index: result.ledgerIndex,
    transaction_hash: result.transactionHash,
    object_type: result.objectType,
    object_id: result.objectId,
    loan_id: result.loanId,
    provenance: 'indexed',
  }
}

function serializeArchivedObject(archive: ArchivedObjectRecord) {
  return {
    epoch_id: archive.epochId,
    object_type: archive.objectType,
    object_id: archive.objectId,
    deletion_transaction_hash: archive.deletionTransactionHash,
    deletion_ledger_index: archive.deletionLedgerIndex,
    deletion_transaction_index: archive.deletionTransactionIndex,
    deletion_close_time: archive.deletionCloseTime,
    deletion_reason: archive.deletionReason,
    final_state_json: archive.finalStateJson,
    relationships: {
      vault_id: archive.vaultId,
      loan_broker_id: archive.loanBrokerId,
      loan_id: archive.loanId,
      owner: archive.owner,
      account: archive.account,
      borrower: archive.borrower,
      asset_key: archive.assetKey,
    },
    archived_at: archive.archivedAt,
    provenance: 'indexed',
  }
}

function serializeBalanceHistory(record: BalanceHistoryApiRecord) {
  return {
    epoch_id: record.epochId,
    subject_type: record.subjectType,
    subject_id: record.subjectId,
    transaction_hash: record.transactionHash,
    ledger_index: record.ledgerIndex,
    transaction_index: record.transactionIndex,
    close_time: record.closeTime,
    metric_type: record.metricType,
    asset_key: record.assetKey,
    before_value: record.beforeValue,
    after_value: record.afterValue,
    formula: record.formula,
    source_fields_json: record.sourceFieldsJson,
    created_at: record.createdAt,
    provenance: record.formula ? 'derived' : 'indexed',
  }
}

export function serializeActivityResponse(events: ProtocolEventRecord[], limit: number) {
  return {
    network: 'devnet',
    data: events.map(serializeProtocolEvent),
    page: page(limit),
  }
}

export function serializeActivityNdjson(events: ProtocolEventRecord[]): string {
  return events.map((event) => JSON.stringify(serializeProtocolEvent(event))).join('\n')
}

export function serializeActivityCsv(events: ProtocolEventRecord[]): string {
  const header = [
    'transaction_hash',
    'epoch_id',
    'ledger_index',
    'event_index',
    'close_time',
    'transaction_type',
    'result_code',
    'payload_retained',
    'created_at',
  ]
  const rows = events.map((event) =>
    [
      event.eventHash,
      event.epochId,
      event.ledgerIndex,
      event.eventIndex,
      event.closeTime,
      event.eventType,
      event.resultCode,
      event.payloadRetained,
      event.createdAt,
    ]
      .map(csvCell)
      .join(','),
  )

  return [header.join(','), ...rows].join('\n')
}

export function serializeTransactionResponse(options: {
  transactionHash: string
  event: ProtocolEventRecord | null
  changes: ObjectChangeRecord[]
}) {
  return {
    network: 'devnet',
    transaction_hash: options.transactionHash,
    found: options.event !== null || options.changes.length > 0,
    event: options.event ? serializeProtocolEvent(options.event) : null,
    object_changes: options.changes.map(serializeObjectChange),
  }
}

export function serializeEpochsResponse(epochs: NetworkEpochApiRecord[]) {
  return {
    network: 'devnet',
    data: epochs.map(serializeEpoch),
  }
}

export function serializeEpochDetailResponse(options: {
  epochId: string
  epoch: NetworkEpochApiRecord | null
  stats: EpochStatsRecord | null
}) {
  return {
    network: 'devnet',
    kind: 'epoch',
    epoch_id: options.epochId,
    data: options.epoch ? serializeEpoch(options.epoch) : null,
    scoped_counts: options.stats ? {
      protocol_events: options.stats.protocolEvents,
      object_changes: options.stats.objectChanges,
      archived_objects: options.stats.archivedObjects,
      loan_lifecycle_events: options.stats.loanLifecycleEvents,
      balance_history_rows: options.stats.balanceHistoryRows,
      current_objects: null,
    } : null,
    availability: options.epoch
      ? {
          state: 'available',
          reason: null,
          current_objects: 'unavailable until a verified active snapshot is activated',
        }
      : { state: 'unavailable', reason: 'epoch was not found in indexed history', current_objects: 'unavailable' },
    provenance: {
      epoch: options.epoch ? 'direct' : 'unavailable',
      scoped_counts: options.stats ? 'indexed' : 'unavailable',
      current_objects: 'unavailable',
    },
  }
}

export function serializeObjectHistoryResponse(options: {
  objectType: string
  objectId: string
  changes: ObjectChangeRecord[]
  limit: number
}) {
  return {
    network: 'devnet',
    object_type: options.objectType,
    object_id: options.objectId,
    data: options.changes.map(serializeObjectChange),
    page: page(options.limit),
  }
}

export function serializeLoanLifecycleResponse(options: {
  loanId: string
  events: LoanLifecycleRecord[]
  limit: number
}) {
  return {
    network: 'devnet',
    loan_id: options.loanId,
    data: options.events.map(serializeLoanLifecycle),
    page: page(options.limit),
  }
}

export function serializeLifecycleExplorerResponse(options: {
  events: LoanLifecycleRecord[]
  limit: number
  filters: {
    eventType: string | null
    loanId: string | null
  }
}) {
  return {
    network: 'devnet',
    kind: 'loan_lifecycle',
    data: options.events.map(serializeLoanLifecycle),
    filters: {
      event_type: options.filters.eventType,
      loan_id: options.filters.loanId,
    },
    page: page(options.limit),
    provenance: { collection: 'indexed' },
  }
}

export function serializeArchivedObjectsResponse(options: {
  archives: ArchivedObjectRecord[]
  limit: number
  filters: { objectType: string | null; query: string | null }
}) {
  return {
    network: 'devnet',
    kind: 'archived_objects',
    data: options.archives.map(serializeArchivedObject),
    filters: {
      object_type: options.filters.objectType,
      query: options.filters.query,
    },
    page: page(options.limit),
    provenance: { collection: 'indexed' },
  }
}

export function serializeArchivedObjectResponse(options: {
  objectType: string
  objectId: string
  archive: ArchivedObjectRecord | null
}) {
  return {
    network: 'devnet',
    kind: 'archived_object',
    object_type: options.objectType,
    object_id: options.objectId,
    data: options.archive ? serializeArchivedObject(options.archive) : null,
    availability: options.archive
      ? { state: 'available', reason: null }
      : { state: 'unavailable', reason: 'archived object was not found in indexed history' },
    provenance: { object: options.archive ? 'indexed' : 'unavailable' },
  }
}

export function serializeBalanceHistoryResponse(options: {
  records: BalanceHistoryApiRecord[]
  filters: {
    metricType: string | null
    subjectType: string | null
    subjectId: string | null
    assetKey: string | null
  }
  limit: number
}) {
  return {
    network: 'devnet',
    kind: 'cover_debt_loss',
    data: options.records.map(serializeBalanceHistory),
    filters: {
      metric_type: options.filters.metricType,
      subject_type: options.filters.subjectType,
      subject_id: options.filters.subjectId,
      asset_key: options.filters.assetKey,
    },
    page: page(options.limit),
    provenance: { collection: 'indexed' },
    formulas: {
      required_minimum_cover: 'required_minimum_cover = DebtTotal * CoverRateMinimum / 100000',
      cover_surplus: 'cover_surplus = CoverAvailable - required_minimum_cover',
    },
  }
}

export function serializeSearchResponse(options: {
  query: string
  results: SearchResultRecord[]
  limit: number
}) {
  return {
    network: 'devnet',
    query: options.query,
    data: options.results.map(serializeSearchResult),
    page: page(options.limit),
  }
}
