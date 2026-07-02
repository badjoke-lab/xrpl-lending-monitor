export interface ActiveSnapshotRecord {
  id: string
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  vaultCount: number
  loanBrokerCount: number
  loanCount: number
  objectCount: number
  completedAt: string | null
}

interface SnapshotRow {
  id: string
  epoch_id: string
  ledger_index: number
  ledger_hash: string
  vault_count: number
  loan_broker_count: number
  loan_count: number
  object_count: number
  completed_at: string | null
}

export async function getActiveSnapshot(db: D1Database): Promise<ActiveSnapshotRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, epoch_id, ledger_index, ledger_hash, vault_count,
              loan_broker_count, loan_count, object_count, completed_at
       FROM current_state_snapshots
       WHERE network = 'devnet'
         AND status = 'active'
       ORDER BY ledger_index DESC
       LIMIT 1`,
    )
    .first<SnapshotRow>()

  if (!row) return null
  return {
    id: row.id,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    ledgerHash: row.ledger_hash,
    vaultCount: row.vault_count,
    loanBrokerCount: row.loan_broker_count,
    loanCount: row.loan_count,
    objectCount: row.object_count,
    completedAt: row.completed_at,
  }
}
