import type { SearchResultRecord } from './history-api-repository'

interface Row {
  kind: SearchResultRecord['kind']
  epoch_id: string
  ledger_index: number | null
  transaction_hash: string | null
  object_type: string | null
  object_id: string | null
  loan_id: string | null
}

export async function searchLiveHistoryAfterBoundary(options: {
  db: D1Database
  boundaryLedgerIndex: number
  query: string
  limit: number
}): Promise<SearchResultRecord[]> {
  if (!Number.isSafeInteger(options.boundaryLedgerIndex) || options.boundaryLedgerIndex < 1) {
    throw new Error('History live boundary must be a positive safe integer')
  }
  const result = await options.db.prepare(
    `SELECT 'transaction' AS kind, epoch_id, ledger_index,
            event_hash AS transaction_hash, NULL AS object_type, NULL AS object_id, NULL AS loan_id
     FROM protocol_events
     WHERE network = 'devnet' AND ledger_index > ?2 AND event_hash = ?1
     UNION ALL
     SELECT 'object_change' AS kind, epoch_id, ledger_index,
            transaction_hash, object_type, object_id, loan_id
     FROM object_changes
     WHERE network = 'devnet' AND ledger_index > ?2 AND (
       transaction_hash = ?1 OR object_id = ?1 OR vault_id = ?1 OR loan_broker_id = ?1 OR
       loan_id = ?1 OR account = ?1 OR owner = ?1 OR borrower = ?1 OR asset_key = ?1 OR mpt_issuance_id = ?1
     )
     UNION ALL
     SELECT 'archived_object' AS kind, epoch_id, deletion_ledger_index AS ledger_index,
            deletion_transaction_hash AS transaction_hash, object_type, object_id, loan_id
     FROM archived_objects
     WHERE network = 'devnet' AND deletion_ledger_index > ?2 AND (
       deletion_transaction_hash = ?1 OR object_id = ?1 OR vault_id = ?1 OR loan_broker_id = ?1 OR
       loan_id = ?1 OR account = ?1 OR owner = ?1 OR borrower = ?1 OR asset_key = ?1
     )
     UNION ALL
     SELECT 'loan_lifecycle' AS kind, epoch_id, ledger_index,
            transaction_hash, 'Loan' AS object_type, loan_id AS object_id, loan_id
     FROM loan_lifecycle_events
     WHERE network = 'devnet' AND ledger_index > ?2 AND (transaction_hash = ?1 OR loan_id = ?1)
     ORDER BY ledger_index DESC, kind ASC, transaction_hash ASC, object_id ASC
     LIMIT ?3`,
  ).bind(options.query, options.boundaryLedgerIndex, options.limit).all<Row>()
  return (result.results ?? []).map((row) => ({
    kind: row.kind,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    transactionHash: row.transaction_hash,
    objectType: row.object_type,
    objectId: row.object_id,
    loanId: row.loan_id,
  }))
}
