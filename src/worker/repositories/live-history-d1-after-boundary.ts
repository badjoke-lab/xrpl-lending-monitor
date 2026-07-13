import type {
  ArchivedObjectListOptions,
  ArchivedObjectRecord,
  BalanceHistoryApiRecord,
  BalanceHistoryListOptions,
  HistoryPageOptions,
  LoanLifecycleListOptions,
  LoanLifecycleRecord,
  ObjectChangeRecord,
  ProtocolEventRecord,
} from './history-api-repository'

interface ProtocolEventRow {
  event_hash: string
  epoch_id: string
  ledger_index: number
  event_index: number
  close_time: number
  event_type: string
  result_code: string
  payload_retained: number
  created_at: string
}

interface ObjectChangeRow {
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
  before_json: string | null
  after_json: string | null
  value_type: string
  unsupported_field: number
  vault_id: string | null
  loan_broker_id: string | null
  loan_id: string | null
  account: string | null
  owner: string | null
  borrower: string | null
  asset_key: string | null
  mpt_issuance_id: string | null
  created_at: string
}

interface LoanLifecycleRow {
  loan_id: string
  epoch_id: string
  transaction_hash: string
  ledger_index: number
  transaction_index: number
  close_time: number
  event_type: string
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
  details_json: string
  created_at: string
}

interface ArchivedObjectRow {
  epoch_id: string
  object_type: string
  object_id: string
  deletion_transaction_hash: string
  deletion_ledger_index: number
  deletion_transaction_index: number
  deletion_close_time: number
  deletion_reason: string
  final_state_json: string
  vault_id: string | null
  loan_broker_id: string | null
  loan_id: string | null
  owner: string | null
  account: string | null
  borrower: string | null
  asset_key: string | null
  archived_at: string
}

interface BalanceHistoryRow {
  epoch_id: string
  subject_type: string
  subject_id: string
  transaction_hash: string
  ledger_index: number
  transaction_index: number
  close_time: number
  metric_type: string
  asset_key: string | null
  before_value: string | null
  after_value: string | null
  formula: string | null
  source_fields_json: string
  created_at: string
}

function positiveBoundary(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('History live boundary must be a positive safe integer')
}

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>()
  return result.results ?? []
}

function parseStoredJson(value: string | null): unknown | null {
  return value === null ? null : JSON.parse(value)
}

function mapProtocolEvent(row: ProtocolEventRow): ProtocolEventRecord {
  return {
    eventHash: row.event_hash,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    eventIndex: row.event_index,
    closeTime: row.close_time,
    eventType: row.event_type,
    resultCode: row.result_code,
    payloadRetained: row.payload_retained === 1,
    sourceJson: null,
    metadataJson: null,
    createdAt: row.created_at,
  }
}

function mapObjectChange(row: ObjectChangeRow): ObjectChangeRecord {
  return {
    transactionHash: row.transaction_hash,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    transactionIndex: row.transaction_index,
    transactionType: row.transaction_type,
    resultCode: row.result_code,
    closeTime: row.close_time,
    nodeIndex: row.node_index,
    objectType: row.object_type,
    objectId: row.object_id,
    action: row.action,
    fieldName: row.field_name,
    beforeJson: parseStoredJson(row.before_json),
    afterJson: parseStoredJson(row.after_json),
    valueType: row.value_type,
    unsupportedField: row.unsupported_field === 1,
    vaultId: row.vault_id,
    loanBrokerId: row.loan_broker_id,
    loanId: row.loan_id,
    account: row.account,
    owner: row.owner,
    borrower: row.borrower,
    assetKey: row.asset_key,
    mptIssuanceId: row.mpt_issuance_id,
    createdAt: row.created_at,
  }
}

function mapLifecycle(row: LoanLifecycleRow): LoanLifecycleRecord {
  return {
    loanId: row.loan_id,
    epochId: row.epoch_id,
    transactionHash: row.transaction_hash,
    ledgerIndex: row.ledger_index,
    transactionIndex: row.transaction_index,
    closeTime: row.close_time,
    eventType: row.event_type,
    transactionType: row.transaction_type,
    resultCode: row.result_code,
    statusBefore: row.status_before,
    statusAfter: row.status_after,
    principalBefore: row.principal_before,
    principalAfter: row.principal_after,
    totalValueBefore: row.total_value_before,
    totalValueAfter: row.total_value_after,
    paymentRemainingBefore: row.payment_remaining_before,
    paymentRemainingAfter: row.payment_remaining_after,
    detailsJson: JSON.parse(row.details_json),
    createdAt: row.created_at,
  }
}

function mapArchive(row: ArchivedObjectRow): ArchivedObjectRecord {
  return {
    epochId: row.epoch_id,
    objectType: row.object_type,
    objectId: row.object_id,
    deletionTransactionHash: row.deletion_transaction_hash,
    deletionLedgerIndex: row.deletion_ledger_index,
    deletionTransactionIndex: row.deletion_transaction_index,
    deletionCloseTime: row.deletion_close_time,
    deletionReason: row.deletion_reason,
    finalStateJson: JSON.parse(row.final_state_json),
    vaultId: row.vault_id,
    loanBrokerId: row.loan_broker_id,
    loanId: row.loan_id,
    owner: row.owner,
    account: row.account,
    borrower: row.borrower,
    assetKey: row.asset_key,
    archivedAt: row.archived_at,
  }
}

function mapBalance(row: BalanceHistoryRow): BalanceHistoryApiRecord {
  return {
    epochId: row.epoch_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    transactionHash: row.transaction_hash,
    ledgerIndex: row.ledger_index,
    transactionIndex: row.transaction_index,
    closeTime: row.close_time,
    metricType: row.metric_type,
    assetKey: row.asset_key,
    beforeValue: row.before_value,
    afterValue: row.after_value,
    formula: row.formula,
    sourceFieldsJson: JSON.parse(row.source_fields_json),
    createdAt: row.created_at,
  }
}

export async function listLiveActivityAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<ProtocolEventRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<ProtocolEventRow>(db.prepare(
    `SELECT event_hash, epoch_id, ledger_index, event_index, close_time,
            event_type, result_code, payload_retained, created_at
     FROM protocol_events
     WHERE network = 'devnet' AND ledger_index > ?1
     ORDER BY ledger_index DESC, event_index DESC
     LIMIT ?2`,
  ).bind(boundaryLedgerIndex, options.limit))
  return rows.map(mapProtocolEvent)
}

export async function listLiveObjectHistoryAfterBoundary(
  db: D1Database,
  objectType: string,
  objectId: string,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<ObjectChangeRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<ObjectChangeRow>(db.prepare(
    `SELECT * FROM object_changes
     WHERE network = 'devnet' AND object_type = ?1 AND object_id = ?2 AND ledger_index > ?3
     ORDER BY ledger_index DESC, transaction_index DESC, node_index ASC, field_name ASC
     LIMIT ?4`,
  ).bind(objectType, objectId, boundaryLedgerIndex, options.limit))
  return rows.map(mapObjectChange)
}

export async function listLiveLoanLifecycleAfterBoundary(
  db: D1Database,
  loanId: string,
  boundaryLedgerIndex: number,
  options: HistoryPageOptions,
): Promise<LoanLifecycleRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<LoanLifecycleRow>(db.prepare(
    `SELECT * FROM loan_lifecycle_events
     WHERE network = 'devnet' AND loan_id = ?1 AND ledger_index > ?2
     ORDER BY ledger_index ASC, transaction_index ASC
     LIMIT ?3`,
  ).bind(loanId, boundaryLedgerIndex, options.limit))
  return rows.map(mapLifecycle)
}

export async function listLiveLoanLifecycleEventsAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: LoanLifecycleListOptions,
): Promise<LoanLifecycleRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<LoanLifecycleRow>(db.prepare(
    `SELECT * FROM loan_lifecycle_events
     WHERE network = 'devnet' AND ledger_index > ?1
       AND (?2 IS NULL OR event_type = ?2)
       AND (?3 IS NULL OR loan_id = ?3)
     ORDER BY ledger_index DESC, transaction_index DESC
     LIMIT ?4`,
  ).bind(boundaryLedgerIndex, options.eventType ?? null, options.loanId ?? null, options.limit))
  return rows.map(mapLifecycle)
}

export async function listLiveArchivedObjectsAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: ArchivedObjectListOptions,
): Promise<ArchivedObjectRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<ArchivedObjectRow>(db.prepare(
    `SELECT * FROM archived_objects
     WHERE network = 'devnet' AND deletion_ledger_index > ?1
       AND (?2 IS NULL OR object_type = ?2)
       AND (
         ?3 IS NULL OR object_id = ?3 OR deletion_transaction_hash = ?3 OR
         vault_id = ?3 OR loan_broker_id = ?3 OR loan_id = ?3 OR
         owner = ?3 OR account = ?3 OR borrower = ?3 OR asset_key = ?3
       )
     ORDER BY deletion_ledger_index DESC, deletion_transaction_index DESC
     LIMIT ?4`,
  ).bind(boundaryLedgerIndex, options.objectType ?? null, options.query ?? null, options.limit))
  return rows.map(mapArchive)
}

export async function listLiveBalanceHistoryAfterBoundary(
  db: D1Database,
  boundaryLedgerIndex: number,
  options: BalanceHistoryListOptions,
): Promise<BalanceHistoryApiRecord[]> {
  positiveBoundary(boundaryLedgerIndex)
  const rows = await allRows<BalanceHistoryRow>(db.prepare(
    `SELECT * FROM balance_history
     WHERE network = 'devnet' AND ledger_index > ?1
       AND (?2 IS NULL OR metric_type = ?2)
       AND (?3 IS NULL OR subject_type = ?3)
       AND (?4 IS NULL OR subject_id = ?4)
       AND (?5 IS NULL OR asset_key = ?5)
     ORDER BY ledger_index DESC, transaction_index DESC, subject_id ASC, metric_type ASC
     LIMIT ?6`,
  ).bind(
    boundaryLedgerIndex,
    options.metricType ?? null,
    options.subjectType ?? null,
    options.subjectId ?? null,
    options.assetKey ?? null,
    options.limit,
  ))
  return rows.map(mapBalance)
}
