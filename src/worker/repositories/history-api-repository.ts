export interface HistoryPageOptions {
  limit: number
}

export interface LoanLifecycleListOptions extends HistoryPageOptions {
  eventType?: string | null
  loanId?: string | null
}

export interface ArchivedObjectListOptions extends HistoryPageOptions {
  objectType?: string | null
  query?: string | null
}

export interface ProtocolEventRecord {
  eventHash: string
  epochId: string
  ledgerIndex: number
  eventIndex: number
  closeTime: number
  eventType: string
  resultCode: string
  payloadRetained: boolean
  sourceJson: unknown | null
  metadataJson: unknown | null
  createdAt: string
}

export interface ObjectChangeRecord {
  transactionHash: string
  epochId: string
  ledgerIndex: number
  transactionIndex: number
  transactionType: string
  resultCode: string
  closeTime: number
  nodeIndex: number
  objectType: string
  objectId: string
  action: 'created' | 'modified' | 'deleted'
  fieldName: string
  beforeJson: unknown | null
  afterJson: unknown | null
  valueType: string
  unsupportedField: boolean
  vaultId: string | null
  loanBrokerId: string | null
  loanId: string | null
  account: string | null
  owner: string | null
  borrower: string | null
  assetKey: string | null
  mptIssuanceId: string | null
  createdAt: string
}

export interface LoanLifecycleRecord {
  loanId: string
  epochId: string
  transactionHash: string
  ledgerIndex: number
  transactionIndex: number
  closeTime: number
  eventType: string
  transactionType: string
  resultCode: string
  statusBefore: string
  statusAfter: string
  principalBefore: string | null
  principalAfter: string | null
  totalValueBefore: string | null
  totalValueAfter: string | null
  paymentRemainingBefore: number | null
  paymentRemainingAfter: number | null
  detailsJson: unknown
  createdAt: string
}

export interface NetworkEpochApiRecord {
  id: string
  status: string
  firstLedgerIndex: number
  firstLedgerHash: string
  lastLedgerIndex: number | null
  lastLedgerHash: string | null
  startedAt: string
  endedAt: string | null
  resetReason: string | null
}

export interface SearchResultRecord {
  kind: 'transaction' | 'object_change' | 'archived_object' | 'loan_lifecycle'
  epochId: string
  ledgerIndex: number | null
  transactionHash: string | null
  objectType: string | null
  objectId: string | null
  loanId: string | null
}

export interface ArchivedObjectRecord {
  epochId: string
  objectType: string
  objectId: string
  deletionTransactionHash: string
  deletionLedgerIndex: number
  deletionTransactionIndex: number
  deletionCloseTime: number
  deletionReason: string
  finalStateJson: unknown
  vaultId: string | null
  loanBrokerId: string | null
  loanId: string | null
  owner: string | null
  account: string | null
  borrower: string | null
  assetKey: string | null
  archivedAt: string
}

interface ProtocolEventRow {
  event_hash: string
  epoch_id: string
  ledger_index: number
  event_index: number
  close_time: number
  event_type: string
  result_code: string
  payload_retained: number
  source_json: string | null
  metadata_json: string | null
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

interface EpochRow {
  id: string
  status: string
  first_ledger_index: number
  first_ledger_hash: string
  last_ledger_index: number | null
  last_ledger_hash: string | null
  started_at: string
  ended_at: string | null
  reset_reason: string | null
}

interface SearchResultRow {
  kind: SearchResultRecord['kind']
  epoch_id: string
  ledger_index: number | null
  transaction_hash: string | null
  object_type: string | null
  object_id: string | null
  loan_id: string | null
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

function parseStoredJson(value: string | null): unknown | null {
  if (value === null) return null
  return JSON.parse(value)
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
    sourceJson: parseStoredJson(row.source_json),
    metadataJson: parseStoredJson(row.metadata_json),
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

function mapLoanLifecycle(row: LoanLifecycleRow): LoanLifecycleRecord {
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

function mapEpoch(row: EpochRow): NetworkEpochApiRecord {
  return {
    id: row.id,
    status: row.status,
    firstLedgerIndex: row.first_ledger_index,
    firstLedgerHash: row.first_ledger_hash,
    lastLedgerIndex: row.last_ledger_index,
    lastLedgerHash: row.last_ledger_hash,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    resetReason: row.reset_reason,
  }
}

function mapArchivedObject(row: ArchivedObjectRow): ArchivedObjectRecord {
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

async function allRows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>()
  return result.results ?? []
}

export async function listActivity(
  db: D1Database,
  options: HistoryPageOptions,
): Promise<ProtocolEventRecord[]> {
  const rows = await allRows<ProtocolEventRow>(
    db
      .prepare(
        `SELECT event_hash, epoch_id, ledger_index, event_index, close_time,
                event_type, result_code, payload_retained,
                NULL AS source_json, NULL AS metadata_json, created_at
         FROM protocol_events
         WHERE network = 'devnet'
         ORDER BY ledger_index DESC, event_index DESC
         LIMIT ?1`,
      )
      .bind(options.limit),
  )
  return rows.map(mapProtocolEvent)
}

export async function getTransactionDetail(
  db: D1Database,
  transactionHash: string,
): Promise<{ event: ProtocolEventRecord | null; changes: ObjectChangeRecord[] }> {
  const [eventRow, changeRows] = await Promise.all([
    db
      .prepare(
        `SELECT event_hash, epoch_id, ledger_index, event_index, close_time,
                event_type, result_code, payload_retained, source_json,
                metadata_json, created_at
         FROM protocol_events
         WHERE network = 'devnet'
           AND event_hash = ?1
         LIMIT 1`,
      )
      .bind(transactionHash)
      .first<ProtocolEventRow>(),
    allRows<ObjectChangeRow>(
      db
        .prepare(
          `SELECT *
           FROM object_changes
           WHERE network = 'devnet'
             AND transaction_hash = ?1
           ORDER BY node_index ASC, field_name ASC
           LIMIT 100`,
        )
        .bind(transactionHash),
    ),
  ])

  return {
    event: eventRow ? mapProtocolEvent(eventRow) : null,
    changes: changeRows.map(mapObjectChange),
  }
}

export async function listEpochs(db: D1Database): Promise<NetworkEpochApiRecord[]> {
  const rows = await allRows<EpochRow>(
    db
      .prepare(
        `SELECT id, status, first_ledger_index, first_ledger_hash,
                last_ledger_index, last_ledger_hash, started_at, ended_at,
                reset_reason
         FROM network_epochs
         WHERE network = 'devnet'
         ORDER BY started_at DESC
         LIMIT 100`,
      ),
  )
  return rows.map(mapEpoch)
}

export async function listObjectHistory(
  db: D1Database,
  objectType: string,
  objectId: string,
  options: HistoryPageOptions,
): Promise<ObjectChangeRecord[]> {
  const rows = await allRows<ObjectChangeRow>(
    db
      .prepare(
        `SELECT *
         FROM object_changes
         WHERE network = 'devnet'
           AND object_type = ?1
           AND object_id = ?2
         ORDER BY ledger_index DESC, transaction_index DESC, node_index ASC
         LIMIT ?3`,
      )
      .bind(objectType, objectId, options.limit),
  )
  return rows.map(mapObjectChange)
}

export async function listLoanLifecycle(
  db: D1Database,
  loanId: string,
  options: HistoryPageOptions,
): Promise<LoanLifecycleRecord[]> {
  const rows = await allRows<LoanLifecycleRow>(
    db
      .prepare(
        `SELECT *
         FROM loan_lifecycle_events
         WHERE network = 'devnet'
           AND loan_id = ?1
         ORDER BY ledger_index ASC, transaction_index ASC
         LIMIT ?2`,
      )
      .bind(loanId, options.limit),
  )
  return rows.map(mapLoanLifecycle)
}

export async function listLoanLifecycleEvents(
  db: D1Database,
  options: LoanLifecycleListOptions,
): Promise<LoanLifecycleRecord[]> {
  const rows = await allRows<LoanLifecycleRow>(
    db
      .prepare(
        `SELECT *
         FROM loan_lifecycle_events
         WHERE network = 'devnet'
           AND (?1 IS NULL OR event_type = ?1)
           AND (?2 IS NULL OR loan_id = ?2)
         ORDER BY ledger_index DESC, transaction_index DESC
         LIMIT ?3`,
      )
      .bind(options.eventType ?? null, options.loanId ?? null, options.limit),
  )
  return rows.map(mapLoanLifecycle)
}

export async function listArchivedObjects(
  db: D1Database,
  options: ArchivedObjectListOptions,
): Promise<ArchivedObjectRecord[]> {
  const rows = await allRows<ArchivedObjectRow>(
    db
      .prepare(
        `SELECT *
         FROM archived_objects
         WHERE network = 'devnet'
           AND (?1 IS NULL OR object_type = ?1)
           AND (
             ?2 IS NULL OR object_id = ?2 OR deletion_transaction_hash = ?2 OR
             vault_id = ?2 OR loan_broker_id = ?2 OR loan_id = ?2 OR
             owner = ?2 OR account = ?2 OR borrower = ?2 OR asset_key = ?2
           )
         ORDER BY deletion_ledger_index DESC, deletion_transaction_index DESC
         LIMIT ?3`,
      )
      .bind(options.objectType ?? null, options.query ?? null, options.limit),
  )
  return rows.map(mapArchivedObject)
}

export async function getArchivedObject(
  db: D1Database,
  objectType: string,
  objectId: string,
): Promise<ArchivedObjectRecord | null> {
  const row = await db
    .prepare(
      `SELECT *
       FROM archived_objects
       WHERE network = 'devnet'
         AND object_type = ?1
         AND object_id = ?2
       LIMIT 1`,
    )
    .bind(objectType, objectId)
    .first<ArchivedObjectRow>()
  return row ? mapArchivedObject(row) : null
}

export async function searchHistory(
  db: D1Database,
  query: string,
  options: HistoryPageOptions,
): Promise<SearchResultRecord[]> {
  const rows = await allRows<SearchResultRow>(
    db
      .prepare(
        `SELECT 'transaction' AS kind, epoch_id, ledger_index,
                event_hash AS transaction_hash,
                NULL AS object_type, NULL AS object_id, NULL AS loan_id
         FROM protocol_events
         WHERE network = 'devnet'
           AND event_hash = ?1
         UNION ALL
         SELECT 'object_change' AS kind, epoch_id, ledger_index,
                transaction_hash, object_type, object_id, loan_id
         FROM object_changes
         WHERE network = 'devnet'
           AND (
             transaction_hash = ?1 OR object_id = ?1 OR vault_id = ?1 OR
             loan_broker_id = ?1 OR loan_id = ?1 OR account = ?1 OR
             owner = ?1 OR borrower = ?1 OR asset_key = ?1 OR
             mpt_issuance_id = ?1
           )
         UNION ALL
         SELECT 'archived_object' AS kind, epoch_id, deletion_ledger_index AS ledger_index,
                deletion_transaction_hash AS transaction_hash,
                object_type, object_id, loan_id
         FROM archived_objects
         WHERE network = 'devnet'
           AND (
             deletion_transaction_hash = ?1 OR object_id = ?1 OR vault_id = ?1 OR
             loan_broker_id = ?1 OR loan_id = ?1 OR account = ?1 OR
             owner = ?1 OR borrower = ?1 OR asset_key = ?1
           )
         UNION ALL
         SELECT 'loan_lifecycle' AS kind, epoch_id, ledger_index,
                transaction_hash, 'Loan' AS object_type, loan_id AS object_id, loan_id
         FROM loan_lifecycle_events
         WHERE network = 'devnet'
           AND (transaction_hash = ?1 OR loan_id = ?1)
         ORDER BY ledger_index DESC
         LIMIT ?2`,
      )
      .bind(query, options.limit),
  )

  return rows.map((row) => ({
    kind: row.kind,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    transactionHash: row.transaction_hash,
    objectType: row.object_type,
    objectId: row.object_id,
    loanId: row.loan_id,
  }))
}
