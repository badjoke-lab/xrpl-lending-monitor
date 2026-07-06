import { readContinuationScopeBoundary } from './continuation-scope'

interface ManagedTransitionSourceRow {
  impaired: number
  impaired_latest_ledger: number | null
  unimpaired: number
  unimpaired_latest_ledger: number | null
  defaulted: number
  defaulted_latest_ledger: number | null
}

function numberValue(value: number | null | undefined): number {
  return Number(value ?? 0)
}

export interface ManagedTransitionSourceDiagnostics {
  epochId: string | null
  impaired: number
  impairedLatestLedger: number | null
  unimpaired: number
  unimpairedLatestLedger: number | null
  defaulted: number
  defaultedLatestLedger: number | null
}

function empty(): ManagedTransitionSourceDiagnostics {
  return {
    epochId: null,
    impaired: 0,
    impairedLatestLedger: null,
    unimpaired: 0,
    unimpairedLatestLedger: null,
    defaulted: 0,
    defaultedLatestLedger: null,
  }
}

export async function readManagedTransitionSourceDiagnostics(
  db: D1Database,
): Promise<ManagedTransitionSourceDiagnostics> {
  const scope = await readContinuationScopeBoundary(db)
  if (!scope) return empty()

  const row = await db.prepare(
    `WITH flag_changes AS (
       SELECT ledger_index,
              CAST(json_extract(before_json, '$') AS INTEGER) AS before_flags,
              CAST(json_extract(after_json, '$') AS INTEGER) AS after_flags
       FROM object_changes
       WHERE network = 'devnet'
         AND epoch_id = ?1
         AND ledger_index > ?2
         AND transaction_type = 'LoanManage'
         AND object_type = 'Loan'
         AND action = 'modified'
         AND field_name = 'Flags'
         AND before_json IS NOT NULL
         AND after_json IS NOT NULL
     )
     SELECT
       COALESCE(SUM(CASE
         WHEN (after_flags & 65536) = 0
          AND (after_flags & 131072) != 0
          AND NOT ((before_flags & 65536) = 0 AND (before_flags & 131072) != 0)
         THEN 1 ELSE 0 END), 0) AS impaired,
       MAX(CASE
         WHEN (after_flags & 65536) = 0
          AND (after_flags & 131072) != 0
          AND NOT ((before_flags & 65536) = 0 AND (before_flags & 131072) != 0)
         THEN ledger_index END) AS impaired_latest_ledger,
       COALESCE(SUM(CASE
         WHEN (before_flags & 65536) = 0
          AND (before_flags & 131072) != 0
          AND (after_flags & 65536) = 0
          AND (after_flags & 131072) = 0
         THEN 1 ELSE 0 END), 0) AS unimpaired,
       MAX(CASE
         WHEN (before_flags & 65536) = 0
          AND (before_flags & 131072) != 0
          AND (after_flags & 65536) = 0
          AND (after_flags & 131072) = 0
         THEN ledger_index END) AS unimpaired_latest_ledger,
       COALESCE(SUM(CASE
         WHEN (after_flags & 65536) != 0
          AND (before_flags & 65536) = 0
         THEN 1 ELSE 0 END), 0) AS defaulted,
       MAX(CASE
         WHEN (after_flags & 65536) != 0
          AND (before_flags & 65536) = 0
         THEN ledger_index END) AS defaulted_latest_ledger
     FROM flag_changes`,
  ).bind(scope.epochId, scope.baseLedgerIndex).first<ManagedTransitionSourceRow>()

  return {
    epochId: scope.epochId,
    impaired: numberValue(row?.impaired),
    impairedLatestLedger: row?.impaired_latest_ledger ?? null,
    unimpaired: numberValue(row?.unimpaired),
    unimpairedLatestLedger: row?.unimpaired_latest_ledger ?? null,
    defaulted: numberValue(row?.defaulted),
    defaultedLatestLedger: row?.defaulted_latest_ledger ?? null,
  }
}
