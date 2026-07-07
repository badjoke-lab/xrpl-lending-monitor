import { readContinuationScopeBoundary } from './continuation-scope'

interface BalanceSourceRow {
  source_changes: number
  latest_ledger: number | null
  source_changes_missing_history: number
  history_rows_missing_source: number
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface BalanceHistorySourceDiagnostics {
  epochId: string | null
  sourceChanges: number
  latestLedger: number | null
  sourceChangesMissingHistory: number
  historyRowsMissingSource: number
}

export async function readBalanceHistorySourceDiagnostics(
  db: D1Database,
): Promise<BalanceHistorySourceDiagnostics> {
  const scope = await readContinuationScopeBoundary(db)
  if (!scope) {
    return {
      epochId: null,
      sourceChanges: 0,
      latestLedger: null,
      sourceChangesMissingHistory: 0,
      historyRowsMissingSource: 0,
    }
  }

  const row = await db.prepare(
    `WITH source AS (
       SELECT
         transaction_hash,
         ledger_index,
         object_type,
         object_id,
         CASE field_name
           WHEN 'DebtTotal' THEN 'debt_total'
           WHEN 'DebtMaximum' THEN 'debt_maximum'
           WHEN 'CoverAvailable' THEN 'cover_available'
           WHEN 'LossUnrealized' THEN 'loss_unrealized'
         END AS metric_type
       FROM object_changes
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND ledger_index > ?2
         AND object_type IN ('Vault', 'LoanBroker')
         AND field_name IN ('DebtTotal', 'DebtMaximum', 'CoverAvailable', 'LossUnrealized')
     ), direct_history AS (
       SELECT transaction_hash, ledger_index, subject_type, subject_id, metric_type
       FROM balance_history
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND ledger_index > ?2
         AND metric_type IN ('debt_total', 'debt_maximum', 'cover_available', 'loss_unrealized')
     )
     SELECT
       (SELECT COUNT(*) FROM source) AS source_changes,
       (SELECT MAX(ledger_index) FROM source) AS latest_ledger,
       (
         SELECT COUNT(*)
         FROM source s
         WHERE NOT EXISTS (
           SELECT 1
           FROM direct_history b
           WHERE b.transaction_hash = s.transaction_hash
             AND b.subject_type = s.object_type
             AND b.subject_id = s.object_id
             AND b.metric_type = s.metric_type
         )
       ) AS source_changes_missing_history,
       (
         SELECT COUNT(*)
         FROM direct_history b
         WHERE NOT EXISTS (
           SELECT 1
           FROM source s
           WHERE s.transaction_hash = b.transaction_hash
             AND s.object_type = b.subject_type
             AND s.object_id = b.subject_id
             AND s.metric_type = b.metric_type
         )
       ) AS history_rows_missing_source`,
  ).bind(scope.epochId, scope.baseLedgerIndex).first<BalanceSourceRow>()

  return {
    epochId: scope.epochId,
    sourceChanges: numberValue(row?.source_changes),
    latestLedger: row?.latest_ledger ?? null,
    sourceChangesMissingHistory: numberValue(row?.source_changes_missing_history),
    historyRowsMissingSource: numberValue(row?.history_rows_missing_source),
  }
}
