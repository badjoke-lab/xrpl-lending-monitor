interface EpochRow {
  epoch_id: string | null
}

interface BalanceSourceRow {
  source_changes: number
  latest_ledger: number | null
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface BalanceHistorySourceDiagnostics {
  epochId: string | null
  sourceChanges: number
  latestLedger: number | null
}

export async function readBalanceHistorySourceDiagnostics(
  db: D1Database,
): Promise<BalanceHistorySourceDiagnostics> {
  const epoch = await db.prepare(
    `SELECT epoch_id
     FROM sync_state
     WHERE network = 'devnet'
     LIMIT 1`,
  ).first<EpochRow>()
  const epochId = epoch?.epoch_id ?? null

  if (!epochId) {
    return { epochId: null, sourceChanges: 0, latestLedger: null }
  }

  const row = await db.prepare(
    `SELECT COUNT(*) AS source_changes,
            MAX(ledger_index) AS latest_ledger
     FROM object_changes
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND object_type IN ('Vault', 'LoanBroker')
       AND field_name IN ('DebtTotal', 'DebtMaximum', 'CoverAvailable', 'LossUnrealized')`,
  ).bind(epochId).first<BalanceSourceRow>()

  return {
    epochId,
    sourceChanges: numberValue(row?.source_changes),
    latestLedger: row?.latest_ledger ?? null,
  }
}
