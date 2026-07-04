export interface CollectorScopeRow {
  epoch_id: string
  base_snapshot_id: string
  base_ledger_index: number
  base_ledger_hash: string
  overlay_ledger_index: number
  overlay_ledger_hash: string
}

export async function readCollectorScope(db: D1Database, epochId: string): Promise<CollectorScopeRow | null> {
  return db.prepare(
    `SELECT epoch_id, base_snapshot_id, base_ledger_index, base_ledger_hash,
            overlay_ledger_index, overlay_ledger_hash
     FROM current_state_overlay_state
     WHERE network = ?1 AND epoch_id = ?2
     ORDER BY updated_at DESC LIMIT 1`,
  ).bind('devnet', epochId).first<CollectorScopeRow>()
}
