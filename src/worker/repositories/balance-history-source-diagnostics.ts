import { readContinuationScopeBoundary } from './continuation-scope'

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
  const scope = await readContinuationScopeBoundary(db)
  if (!scope) return { epochId: null, sourceChanges: 0, latestLedger: null }

  const row = await db.prepare(
    `SELECT COUNT(*) AS source_changes,
            MAX(ledger_index) AS latest_ledger
     FROM object_changes
     WHERE network = 'devnet'
       AND epoch_id = ?1
       AND ledger_index > ?2
       AND object_type IN ('Vault', 'LoanBroker')
       AND field_name IN ('DebtTotal', 'DebtMaximum', 'CoverAvailable', 'LossUnrealized')`,
  ).bind(scope.epochId, scope.baseLedgerIndex).first<BalanceSourceRow>()

  return {
    epochId: scope.epochId,
    sourceChanges: numberValue(row?.source_changes),
    latestLedger: row?.latest_ledger ?? null,
  }
}
