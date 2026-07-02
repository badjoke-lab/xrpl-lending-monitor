export interface ActiveSnapshotRecord {
  id: string
  epochId: string
  ledgerIndex: number
  ledgerHash: string
  objectPrefix: string
  manifestKey: string | null
  manifestSha256: string | null
  vaultCount: number
  loanBrokerCount: number
  loanCount: number
  objectCount: number
  shardCount: number
  compressedBytes: number
  completedAt: string | null
}

interface SnapshotRow {
  id: string
  epoch_id: string
  ledger_index: number
  ledger_hash: string
  object_prefix: string
  manifest_key: string | null
  manifest_hash: string | null
  vault_count: number
  loan_broker_count: number
  loan_count: number
  object_count: number
  shard_count: number
  compressed_bytes: number
  completed_at: string | null
}

export async function getActiveSnapshot(db: D1Database): Promise<ActiveSnapshotRecord | null> {
  const row = await db
    .prepare(
      `SELECT id, epoch_id, ledger_index, ledger_hash, object_prefix,
              manifest_key, manifest_hash, vault_count, loan_broker_count,
              loan_count, object_count, shard_count, compressed_bytes, completed_at
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
    objectPrefix: row.object_prefix,
    manifestKey: row.manifest_key,
    manifestSha256: row.manifest_hash,
    vaultCount: row.vault_count,
    loanBrokerCount: row.loan_broker_count,
    loanCount: row.loan_count,
    objectCount: row.object_count,
    shardCount: row.shard_count,
    compressedBytes: row.compressed_bytes,
    completedAt: row.completed_at,
  }
}
