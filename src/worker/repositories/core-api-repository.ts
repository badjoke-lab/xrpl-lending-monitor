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
  manifest_hash: string
  vault_count: number
  loan_broker_count: number
  loan_count: number
  object_count: number
  batch_count: number
  normalized_bytes: number
  completed_at: string | null
}

export async function getActiveSnapshot(db: D1Database): Promise<ActiveSnapshotRecord | null> {
  const row = await db
    .prepare(
      `SELECT snapshot.id, snapshot.epoch_id, snapshot.ledger_index,
              snapshot.ledger_hash, snapshot.manifest_hash,
              snapshot.vault_count, snapshot.loan_broker_count,
              snapshot.loan_count, snapshot.object_count,
              snapshot.batch_count, snapshot.normalized_bytes,
              snapshot.completed_at
       FROM current_state_d1_active_snapshots active
       JOIN current_state_d1_snapshots snapshot
         ON snapshot.id = active.snapshot_id
        AND snapshot.epoch_id = active.epoch_id
       JOIN current_state_d1_snapshot_manifests manifest
         ON manifest.snapshot_id = snapshot.id
        AND manifest.manifest_hash = snapshot.manifest_hash
       WHERE active.network = 'devnet'
         AND snapshot.network = 'devnet'
         AND snapshot.status = 'verified'
       LIMIT 1`,
    )
    .first<SnapshotRow>()

  if (!row) return null
  return {
    id: row.id,
    epochId: row.epoch_id,
    ledgerIndex: row.ledger_index,
    ledgerHash: row.ledger_hash,
    objectPrefix: '',
    manifestKey: null,
    manifestSha256: row.manifest_hash,
    vaultCount: row.vault_count,
    loanBrokerCount: row.loan_broker_count,
    loanCount: row.loan_count,
    objectCount: row.object_count,
    shardCount: row.batch_count,
    compressedBytes: row.normalized_bytes,
    completedAt: row.completed_at,
  }
}
