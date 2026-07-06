interface ContinuationScopeRow {
  epoch_id: string | null
  base_ledger_index: number | null
}

export interface ContinuationScopeBoundary {
  epochId: string
  baseLedgerIndex: number
}

export async function readContinuationScopeBoundary(
  db: D1Database,
): Promise<ContinuationScopeBoundary | null> {
  const row = await db.prepare(
    `SELECT s.epoch_id,
            o.base_ledger_index
     FROM sync_state s
     LEFT JOIN current_state_overlay_state o
       ON o.network = s.network AND o.epoch_id = s.epoch_id
     WHERE s.network = 'devnet'
     ORDER BY o.updated_at DESC
     LIMIT 1`,
  ).first<ContinuationScopeRow>()

  if (!row?.epoch_id || row.base_ledger_index === null) return null
  return {
    epochId: row.epoch_id,
    baseLedgerIndex: row.base_ledger_index,
  }
}
