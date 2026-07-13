import type { ObjectChangeRecord, ProtocolEventRecord } from './history-api-repository'

interface EventRow {
  event_hash: string; epoch_id: string; ledger_index: number; event_index: number; close_time: number
  event_type: string; result_code: string; payload_retained: number
  source_json: string | null; metadata_json: string | null; created_at: string
}
interface ChangeRow {
  transaction_hash: string; epoch_id: string; ledger_index: number; transaction_index: number
  transaction_type: string; result_code: string; close_time: number; node_index: number
  object_type: string; object_id: string; action: 'created' | 'modified' | 'deleted'; field_name: string
  before_json: string | null; after_json: string | null; value_type: string; unsupported_field: number
  vault_id: string | null; loan_broker_id: string | null; loan_id: string | null
  account: string | null; owner: string | null; borrower: string | null
  asset_key: string | null; mpt_issuance_id: string | null; created_at: string
}

const parse = (value: string | null): unknown | null => value === null ? null : JSON.parse(value)

function event(row: EventRow): ProtocolEventRecord {
  return {
    eventHash: row.event_hash, epochId: row.epoch_id, ledgerIndex: row.ledger_index,
    eventIndex: row.event_index, closeTime: row.close_time, eventType: row.event_type,
    resultCode: row.result_code, payloadRetained: row.payload_retained === 1,
    sourceJson: parse(row.source_json), metadataJson: parse(row.metadata_json), createdAt: row.created_at,
  }
}

function change(row: ChangeRow): ObjectChangeRecord {
  return {
    transactionHash: row.transaction_hash, epochId: row.epoch_id, ledgerIndex: row.ledger_index,
    transactionIndex: row.transaction_index, transactionType: row.transaction_type,
    resultCode: row.result_code, closeTime: row.close_time, nodeIndex: row.node_index,
    objectType: row.object_type, objectId: row.object_id, action: row.action, fieldName: row.field_name,
    beforeJson: parse(row.before_json), afterJson: parse(row.after_json), valueType: row.value_type,
    unsupportedField: row.unsupported_field === 1, vaultId: row.vault_id, loanBrokerId: row.loan_broker_id,
    loanId: row.loan_id, account: row.account, owner: row.owner, borrower: row.borrower,
    assetKey: row.asset_key, mptIssuanceId: row.mpt_issuance_id, createdAt: row.created_at,
  }
}

export async function getLiveTransactionDetailAfterBoundary(options: {
  db: D1Database; boundaryLedgerIndex: number; transactionHash: string
}): Promise<{ event: ProtocolEventRecord | null; changes: ObjectChangeRecord[] }> {
  if (!Number.isSafeInteger(options.boundaryLedgerIndex) || options.boundaryLedgerIndex < 1) {
    throw new Error('History live boundary must be a positive safe integer')
  }
  const [eventRow, changes] = await Promise.all([
    options.db.prepare(
      `SELECT event_hash, epoch_id, ledger_index, event_index, close_time,
              event_type, result_code, payload_retained, source_json, metadata_json, created_at
       FROM protocol_events
       WHERE network = 'devnet' AND event_hash = ?1 AND ledger_index > ?2
       ORDER BY ledger_index DESC, event_index DESC LIMIT 1`,
    ).bind(options.transactionHash, options.boundaryLedgerIndex).first<EventRow>(),
    options.db.prepare(
      `SELECT * FROM object_changes
       WHERE network = 'devnet' AND transaction_hash = ?1 AND ledger_index > ?2
       ORDER BY ledger_index DESC, transaction_index DESC, node_index ASC, field_name ASC LIMIT 100`,
    ).bind(options.transactionHash, options.boundaryLedgerIndex).all<ChangeRow>(),
  ])
  return {
    event: eventRow ? event(eventRow) : null,
    changes: (changes.results ?? []).map(change),
  }
}
